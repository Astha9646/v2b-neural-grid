import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    to: "/dashboard",
    icon: DashboardIcon,
    end: true,
  },
  { id: "fleet", label: "Fleet", to: "/fleet", icon: FleetIcon },
  { id: "charging", label: "Charging", to: "/charging", icon: ChargingIcon },
  { id: "energy", label: "Energy", to: "/energy", icon: EnergyIcon },
  { id: "analytics", label: "Analytics", to: "/analytics", icon: AnalyticsIcon },
  {
    id: "ai-decisions",
    label: "AI Decisions",
    to: "/ai-decisions",
    icon: AIIcon,
    badge: "RL",
  },
  { id: "reports", label: "Reports", to: "/reports", icon: ReportsIcon },
  { id: "settings", label: "Settings", to: "/settings", icon: SettingsIcon },
];

function linkClass({ isActive }) {
  const base =
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50";
  if (isActive) {
    return [
      base,
      "bg-cyan-500/15 text-cyan-300 shadow-neon-cyan border border-cyan-400/25",
    ].join(" ");
  }
  return [
    base,
    "text-slate-400 border border-transparent hover:border-cyan-500/20 hover:bg-white/[0.04] hover:text-cyan-200 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)]",
  ].join(" ");
}

function DashboardIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function FleetIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 16h16M6 16l1-5h10l1 5M8 11V8a2 2 0 012-2h4a2 2 0 012 2v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="16" r="1.5" fill="currentColor" />
      <circle cx="17" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ChargingIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </svg>
  );
}

function EnergyIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AnalyticsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M10 19V9M16 19V12M22 19V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AIIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2a4 4 0 014 4v1h1a3 3 0 013 3v2a3 3 0 01-3 3h-1v1a4 4 0 01-8 0v-1H7a3 3 0 01-3-3v-2a3 3 0 013-3h1V6a4 4 0 014-4z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <path d="M9 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReportsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NavItem({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        className={linkClass}
        onClick={onNavigate}
      >
        {({ isActive }) => (
          <>
            <span
              className={[
                "absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] transition-opacity duration-300",
                isActive ? "opacity-100" : "opacity-0",
              ].join(" ")}
              aria-hidden
            />
            <span
              className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/5 transition-all duration-300",
                isActive
                  ? "bg-cyan-500/20 text-cyan-300 ring-cyan-400/40"
                  : "bg-slate-900/60 text-cyan-400/90 group-hover:bg-cyan-500/10 group-hover:ring-cyan-400/30 group-hover:text-cyan-300",
              ].join(" ")}
            >
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge ? (
              <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/30">
                {item.badge}
              </span>
            ) : null}
          </>
        )}
      </NavLink>
    </li>
  );
}

function SidebarPanel({ onNavigate, className = "" }) {
  const { logout } = useAuth();

  const handleLogout = () => {
    onNavigate?.();
    logout();
  };

  return (
    <aside
      className={[
        "relative flex h-full w-72 shrink-0 flex-col border-r border-cyan-500/10 bg-slate-950/40 backdrop-blur-xl",
        className,
      ].join(" ")}
    >
      {/* Edge glow */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-cyan-400/40 to-transparent"
        aria-hidden
      />

      {/* Brand */}
      <div className="relative border-b border-white/5 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 shadow-neon-cyan">
            <ChargingIcon className="h-6 w-6 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-500/80">
              V2B
            </p>
            <h1 className="truncate font-display text-sm font-bold text-white">
              Neural Grid
            </h1>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          </span>
          <span className="text-xs text-emerald-300/90">Grid AI Online</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Command Center
        </p>
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.id} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>

      {/* Footer / logout */}
      <div className="border-t border-white/5 p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-400 transition-all duration-300 hover:border-rose-500/25 hover:bg-rose-500/10 hover:text-rose-300 hover:shadow-[0_0_20px_rgba(244,63,94,0.12)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900/60 ring-1 ring-white/5 transition-all group-hover:bg-rose-500/10 group-hover:ring-rose-500/30">
            <LogoutIcon className="h-[18px] w-[18px]" />
          </span>
          <span>Logout</span>
        </button>
        <p className="mt-3 px-3 text-center text-[10px] text-slate-600">
          DDPG · 23-state · 8 agents
        </p>
      </div>
    </aside>
  );
}

/**
 * Futuristic glass sidebar for the Neural Grid EV smart-grid dashboard.
 *
 * @param {object} [props]
 * @param {boolean} [props.mobileOpen] - Controlled mobile drawer state
 * @param {() => void} [props.onMobileClose]
 * @param {string} [props.className]
 */
export default function Sidebar({
  mobileOpen: controlledOpen,
  onMobileClose,
  className = "",
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const location = useLocation();

  const isControlled = controlledOpen !== undefined;
  const mobileOpen = isControlled ? controlledOpen : internalOpen;

  const closeMobile = useCallback(() => {
    if (isControlled) {
      onMobileClose?.();
    } else {
      setInternalOpen(false);
    }
  }, [isControlled, onMobileClose]);

  const openMobile = useCallback(() => {
    if (!isControlled) setInternalOpen(true);
  }, [isControlled]);

  // Close drawer on route change (mobile)
  useEffect(() => {
    closeMobile();
  }, [location.pathname, closeMobile]);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Mobile menu toggle */}
      <button
        type="button"
        onClick={() => (mobileOpen ? closeMobile() : openMobile())}
        className={[
          "fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-xl",
          "border border-cyan-500/30 bg-slate-950/80 text-cyan-300 backdrop-blur-md",
          "shadow-neon-cyan transition-all duration-300 hover:bg-cyan-500/10 lg:hidden",
          className,
        ].join(" ")}
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
      >
        {mobileOpen ? (
          <CloseIcon className="h-5 w-5" />
        ) : (
          <MenuIcon className="h-5 w-5" />
        )}
      </button>

      {/* Mobile backdrop */}
      <div
        className={[
          "fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        onClick={closeMobile}
        aria-hidden={!mobileOpen}
      />

      {/* Mobile drawer */}
      <div
        className={[
          "fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="relative h-full shadow-[4px_0_40px_rgba(34,211,238,0.08)]">
          <SidebarPanel onNavigate={closeMobile} />
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="relative hidden h-full shrink-0 lg:block">
        <SidebarPanel />
      </div>
    </>
  );
}
