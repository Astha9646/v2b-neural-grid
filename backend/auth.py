"""
JWT authentication for the V2B smart-grid FastAPI backend.

Uses:
  - ``python-jose`` for JWT encode/decode and expiration validation
  - ``bcrypt`` for password hashing (passlib-compatible ``$2b$`` hashes)
  - ``passlib`` CryptContext for password policy configuration

Endpoints (mounted in ``main.py``):
  POST /signup  — register user, return access token
  POST /login   — verify credentials, return access token
  GET  /me      — current authenticated user profile
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError
from passlib.context import CryptContext
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db, session_scope
from backend.models import User
from backend.schemas import TokenResponse, UserCreate, UserLogin, UserResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Password hashing (bcrypt backend; passlib policy context)
# ---------------------------------------------------------------------------

# passlib 1.7 + bcrypt>=4.1: use bcrypt library directly; hashes remain $2b$-compatible.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _bcrypt_rounds() -> int:
    """Production-friendly default (10); override via BCRYPT_ROUNDS env."""
    return int(settings.bcrypt_rounds)

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/login",
    auto_error=True,
)


def hash_password(password: str) -> str:
    """
    Hash a plaintext password with bcrypt.

    Produces passlib-compatible ``$2b$`` strings for storage in ``users.hashed_password``.
    """
    if not password:
        raise ValueError("Password must not be empty")
    salt = bcrypt.gensalt(rounds=_bcrypt_rounds())
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if ``plain_password`` matches the stored bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    subject: str | int,
    *,
    expires_delta: timedelta | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """
    Create a signed JWT access token.

    Parameters
    ----------
    subject:
        Stored in the ``sub`` claim (user id as string).
    expires_delta:
        Optional lifetime; defaults to ``settings.jwt_access_token_expire_minutes``.
    extra_claims:
        Additional JWT payload fields (must not override ``sub`` or ``exp``).
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.jwt_access_token_expire_minutes)

    expire = _utc_now() + expires_delta
    payload: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        "iat": _utc_now(),
        "type": "access",
    }
    if extra_claims:
        payload.update({k: v for k, v in extra_claims.items() if k not in ("sub", "exp")})

    return jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT (signature + expiration).

    Raises ``HTTPException`` 401 on invalid or expired tokens.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    expired_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token expired",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except ExpiredSignatureError as exc:
        logger.debug("JWT expired: %s", exc)
        raise expired_exception from exc
    except JWTError as exc:
        logger.debug("JWT validation failed: %s", exc)
        raise credentials_exception from exc

    if payload.get("type") != "access":
        raise credentials_exception

    sub = payload.get("sub")
    if sub is None:
        raise credentials_exception

    return payload


def token_expires_in_seconds() -> int:
    return int(settings.jwt_access_token_expire_minutes * 60)


def issue_token_response(user: User) -> TokenResponse:
    """Build OAuth2 bearer token response for a authenticated user."""
    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=token_expires_in_seconds(),
        user=user_to_response(user),
    )


def ensure_default_admin_user() -> None:
    """
    Create the production demo admin user when the users table is empty.

    Credentials:
      email: admin@grid.ai
      password: admin123
    """
    default_email = "admin@grid.ai"
    default_username = "admin"
    default_password = "admin123"

    with session_scope() as db:
        has_users = db.query(User.id).first() is not None
        if has_users:
            return

        admin = User(
            username=default_username,
            email=default_email,
            hashed_password=hash_password(default_password),
            is_active=True,
        )
        db.add(admin)
        logger.info("Default admin user created")


# ---------------------------------------------------------------------------
# User persistence helpers
# ---------------------------------------------------------------------------


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower()).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def _raise_conflict_from_integrity(db: Session, exc: IntegrityError, *, email: str, username: str) -> None:
    """Map SQLite/Postgres integrity errors to HTTP 409."""
    db.rollback()
    if get_user_by_email(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        ) from exc
    if get_user_by_username(db, username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        ) from exc
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="User already exists",
    ) from exc


def register_new_user(
    db: Session,
    *,
    username: str,
    email: str,
    hashed_password: str,
) -> User:
    """
    Insert user with pre-hashed password — single commit, rollback on failure.
    """
    user = User(
        username=username,
        email=email.lower(),
        hashed_password=hashed_password,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        _raise_conflict_from_integrity(db, exc, email=email, username=username)
    except OperationalError as exc:
        db.rollback()
        logger.error("signup DB operational error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database temporarily busy. Please retry in a few seconds.",
        ) from exc
    db.refresh(user)
    return user


def authenticate_user(db: Session, payload: UserLogin) -> User:
    """Verify email/password; raise 401 on failure."""
    user = get_user_by_email(db, str(payload.email))
    if user is None or not verify_password(
        payload.password.get_secret_value(),
        user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )
    return user


def user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        created_at=user.created_at,
    )


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """
    Protected-route dependency: resolve Bearer JWT → ``User`` row.

    Validates token signature, expiration, and active user status.
    """
    payload = decode_access_token(token)
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )
    return user


async def get_current_user_optional(
    token: Annotated[str | None, Depends(OAuth2PasswordBearer(tokenUrl="/login", auto_error=False))],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    """Like ``get_current_user`` but returns None when auth is disabled or token missing."""
    if not settings.require_auth:
        return None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await get_current_user(token=token, db=db)


async def require_authenticated_user(
    current_user: Annotated[User | None, Depends(get_current_user_optional)],
) -> User:
    """
    Enforce JWT on smart-grid routes when ``REQUIRE_AUTH=true``.

    When ``REQUIRE_AUTH=false`` (local dev), returns a synthetic anonymous user.
    """
    if not settings.require_auth:
        # Placeholder for optional dev mode — endpoints stay callable without JWT
        if current_user is not None:
            return current_user
        return User(
            id=0,
            username="dev",
            email="dev@local",
            hashed_password="",
            is_active=True,
            created_at=_utc_now(),
        )
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

auth_router = APIRouter(tags=["authentication"])


@auth_router.post(
    "/signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
async def signup(
    payload: UserCreate,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    """
    Create a new user with a bcrypt-hashed password and return a JWT.

    CPU-heavy hashing runs in a thread pool so the event loop stays responsive
    on Render free tier (SQLite + single worker).
    """
    started = time.perf_counter()
    email = str(payload.email).lower()
    username = payload.username
    logger.info("signup request received email=%s username=%s", email, username)

    if get_user_by_email(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    if get_user_by_username(db, username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )

    logger.info("user creation started email=%s", email)
    try:
        plain_password = payload.password.get_secret_value()
        hashed_password = await asyncio.to_thread(hash_password, plain_password)
    except Exception as exc:
        logger.exception("signup password hashing failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to complete signup. Please try again.",
        ) from exc

    try:
        user = register_new_user(
            db,
            username=username,
            email=email,
            hashed_password=hashed_password,
        )
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("signup failed unexpectedly")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed. Please try again.",
        ) from exc

    elapsed_ms = (time.perf_counter() - started) * 1000.0
    logger.info(
        "DB commit complete user_id=%s email=%s elapsed_ms=%.0f",
        user.id,
        user.email,
        elapsed_ms,
    )
    response = issue_token_response(user)
    logger.info("signup success response user_id=%s", user.id)
    return response


@auth_router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login and obtain JWT",
)
def login(
    payload: UserLogin,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    """Verify credentials and return a bearer access token."""
    logger.info("login request received email=%s", str(payload.email).lower())
    user = authenticate_user(db, payload)
    logger.info("login success user_id=%s", user.id)
    return issue_token_response(user)


@auth_router.get(
    "/me",
    response_model=UserResponse,
    summary="Current authenticated user",
)
def read_current_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    """Return profile information for the JWT subject."""
    return user_to_response(current_user)
