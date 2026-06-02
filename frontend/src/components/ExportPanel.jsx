import { memo, useCallback, useState } from "react";

import {
  REPORT_EXPORT_OPTIONS,
  downloadReport,
} from "../services/reportService";

const FORMAT_LABELS = { csv: "CSV", pdf: "PDF" };

function ExportPanel({ className = "", compact = false, onExportComplete }) {
  const [formatByType, setFormatByType] = useState(() =>
    Object.fromEntries(
      REPORT_EXPORT_OPTIONS.map((o) => [o.id, o.defaultFormat])
    )
  );
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [lastExport, setLastExport] = useState(null);

  const setFormat = useCallback((typeId, fmt) => {
    setFormatByType((prev) => ({ ...prev, [typeId]: fmt }));
  }, []);

  const handleExport = useCallback(
    async (option) => {
      const format = formatByType[option.id] || option.defaultFormat;
      setBusyId(option.id);
      setError(null);
      try {
        const result = await downloadReport(option.id, format);
        setLastExport({ ...result, at: Date.now() });
        onExportComplete?.(result);
      } catch (err) {
        const detail =
          err?.response?.data?.detail ||
          err?.message ||
          "Export failed. Check authentication and backend PDF support.";
        setError(typeof detail === "string" ? detail : JSON.stringify(detail));
      } finally {
        setBusyId(null);
      }
    },
    [formatByType, onExportComplete]
  );

  return (
    <section
      className={[
        "panel-shell panel-shell-accent min-w-0",
        compact ? "p-4" : "",
        className,
      ].join(" ")}
      aria-labelledby="export-panel-title"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-violet-500/10 blur-3xl" />

      <header className="relative mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-eyebrow">Enterprise</p>
          <h2 id="export-panel-title" className="section-heading">
            {compact ? "Quick Export" : "Report Exports"}
          </h2>
          {!compact && (
            <p className="section-subheading">
              Telemetry, AI decisions, forecasts, and full executive PDF
            </p>
          )}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 shadow-neon-cyan">
          <DownloadIcon className="h-5 w-5 text-cyan-300" />
        </div>
      </header>

      <ul className="relative space-y-3">
        {REPORT_EXPORT_OPTIONS.map((option) => {
          const busy = busyId === option.id;
          const selectedFormat = formatByType[option.id] || option.defaultFormat;
          return (
            <li
              key={option.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-cyan-500/20"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                  {!compact && (
                    <p className="mt-0.5 text-xs text-slate-500">{option.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <div
                    className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5"
                    role="group"
                    aria-label={`${option.label} format`}
                  >
                    {option.formats.map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        disabled={busy}
                        onClick={() => setFormat(option.id, fmt)}
                        className={[
                          "rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all",
                          selectedFormat === fmt
                            ? "bg-cyan-500/20 text-cyan-200 shadow-neon-cyan"
                            : "text-slate-500 hover:text-slate-300",
                        ].join(" ")}
                      >
                        {FORMAT_LABELS[fmt]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={busy || Boolean(busyId)}
                    onClick={() => handleExport(option)}
                    className={[
                      "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                      "border border-cyan-400/30 bg-gradient-to-r from-cyan-500/20 to-violet-500/10 text-cyan-100",
                      "hover:shadow-neon-button hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
                    ].join(" ")}
                  >
                    {busy ? (
                      <>
                        <Spinner className="h-3.5 w-3.5" />
                        Exporting…
                      </>
                    ) : (
                      <>Download</>
                    )}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="relative mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}
      {lastExport && !error && (
        <p className="relative mt-3 text-xs text-emerald-400/90">
          Saved {lastExport.filename}
        </p>
      )}
    </section>
  );
}

function DownloadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner({ className }) {
  return (
    <svg className={["animate-spin", className].join(" ")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default memo(ExportPanel);
