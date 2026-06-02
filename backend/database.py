"""
Database engine and session management (SQLAlchemy 2.x).

Default: SQLite file under ``data/v2b_api.db``. Override with ``DATABASE_URL``.

SQLite on Render/free tier: WAL mode, busy timeout, and NullPool avoid lock stalls
when auth routes and background tasks share the same file.
"""

from __future__ import annotations

import logging
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

from backend.config import settings

logger = logging.getLogger(__name__)

Base = declarative_base()

_IS_SQLITE = settings.database_url.startswith("sqlite")


def _sqlite_connect_args() -> dict:
    return {
        "check_same_thread": False,
        # Seconds to wait on locked DB (prevents indefinite hangs on Render + SQLite).
        "timeout": 20,
    }


def _create_engine():
    if _IS_SQLITE:
        return create_engine(
            settings.database_url,
            connect_args=_sqlite_connect_args(),
            poolclass=NullPool,
        )
    return create_engine(
        settings.database_url,
        connect_args={},
        pool_pre_ping=True,
    )


engine = _create_engine()


if _IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=20000")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Create tables if they do not exist (import models first)."""
    from backend import models  # noqa: F401 — register ORM metadata

    if _IS_SQLITE:
        db_path = settings.database_url.replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(bind=engine)
    logger.info("Database initialized: %s", settings.database_url)


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency: yield a DB session and close it after the request.

    Rolls back uncommitted work when the request handler raises.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Context manager for scripts and background tasks — single commit, always closes."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
