function BoltIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  );
}

export default function AuthLoadingScreen({ message = "Restoring secure session…" }) {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black text-white"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-black to-emerald-950 opacity-90" />
      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_40px_rgba(34,211,238,0.35)]">
          <BoltIcon className="h-8 w-8 animate-pulse text-cyan-400" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-400/90">Neural Grid</p>
          <p className="mt-2 text-sm text-slate-400">{message}</p>
        </div>
        <span
          className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400"
          aria-hidden
        />
      </div>
    </div>
  );
}
