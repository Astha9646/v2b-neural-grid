import { memo, useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ExportPanel from "../components/ExportPanel";
import { fetchReportPreview } from "../services/reportService";
import { RECHARTS_PERF } from "../utils/chartUtils";

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-1 text-cyan-200">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function PreviewChart({ title, data, dataKey, color, unit }) {
  if (!data?.length) {
    return (
      <div className="panel-shell min-h-[200px] flex items-center justify-center text-xs text-slate-500">
        No chart data in preview
      </div>
    );
  }

  const chartData = data.map((d, i) => ({
    label: (d.time || `#${i + 1}`).slice(-8),
    value: Number(d[dataKey] ?? d.load_kw ?? d.soc ?? d.renewable_ratio ?? 0),
  }));

  return (
    <div className="panel-shell min-h-[220px] min-w-0">
      <p className="section-eyebrow mb-1">{title}</p>
      <div className="h-[180px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              contentStyle={{
                background: "rgba(5,8,16,0.95)",
                border: "1px solid rgba(34,211,238,0.2)",
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, title]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              fill={`url(#grad-${dataKey})`}
              strokeWidth={2}
              isAnimationActive={RECHARTS_PERF.isAnimationActive}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ReportCenter() {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchReportPreview();
      setPreview(data);
    } catch (err) {
      setLoadError(err?.message || "Could not load report preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const telemetry = preview?.telemetry_summary || {};
  const loadStats = telemetry.grid_load_kw || {};
  const socStats = telemetry.soc_percent || telemetry.soc || {};
  const renewable = preview?.renewable?.renewable_ratio || {};
  const battery = preview?.battery?.battery_health_percent || {};

  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">Enterprise</p>
        <h1 className="font-display text-2xl font-bold text-white">Report Center</h1>
        <p className="section-subheading">
          Export telemetry, AI decisions, forecasts, and full executive summaries
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <section className="panel-shell panel-shell-accent">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="section-eyebrow">Live snapshot</p>
                <h2 className="section-heading">Report Preview</h2>
              </div>
              <button
                type="button"
                onClick={loadPreview}
                disabled={loading}
                className="rounded-lg border border-cyan-400/25 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            {loading && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
                ))}
              </div>
            )}

            {loadError && (
              <p className="text-sm text-rose-300">{loadError}</p>
            )}

            {preview && !loading && (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  Generated {preview.meta?.generated_at} · {preview.meta?.row_count} telemetry rows ·{" "}
                  {preview.meta?.model_loaded ? "RL model active" : "heuristic fallback"}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile
                    label="Grid load"
                    value={`${loadStats.latest ?? "—"} kW`}
                    sub={`avg ${loadStats.avg ?? "—"}`}
                  />
                  <StatTile
                    label="SOC"
                    value={`${socStats.latest ?? "—"}%`}
                    sub={`min ${socStats.min ?? "—"}`}
                  />
                  <StatTile
                    label="Renewable ratio"
                    value={
                      renewable.latest != null
                        ? `${renewable.latest <= 1 ? (renewable.latest * 100).toFixed(0) : renewable.latest}%`
                        : "—"
                    }
                    sub="utilization index"
                  />
                  <StatTile
                    label="Battery health"
                    value={`${battery.latest ?? "—"}%`}
                    sub={preview.optimization?.risk_level ? `risk ${preview.optimization.risk_level}` : undefined}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">
                      Optimization
                    </p>
                    <p className="mt-1 text-sm text-slate-200">
                      {preview.optimization?.optimization_action || "—"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {preview.optimization?.charging_strategy} · confidence{" "}
                      {Math.round((preview.optimization?.confidence_score ?? 0) * 100)}%
                    </p>
                  </div>
                  <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/80">
                      Explainability
                    </p>
                    <p className="mt-1 line-clamp-3 text-xs text-slate-300">
                      {preview.explainability_summary || "No summary available"}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-500">
                      {preview.decision_count} decisions · forecast horizon {preview.forecast_horizon ?? "—"} · RL{" "}
                      {preview.rl_available ? "metrics included" : "metrics N/A"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <PreviewChart
              title="Load trend"
              data={preview?.chart_series?.load}
              dataKey="load_kw"
              color="#22d3ee"
              unit="kW"
            />
            <PreviewChart
              title="SOC trend"
              data={preview?.chart_series?.soc}
              dataKey="soc"
              color="#a78bfa"
              unit="%"
            />
            <PreviewChart
              title="Renewable"
              data={preview?.chart_series?.renewable}
              dataKey="renewable_ratio"
              color="#34d399"
              unit=""
            />
          </div>
        </div>

        <div className="xl:col-span-1">
          <ExportPanel onExportComplete={loadPreview} />
        </div>
      </div>

      <section className="panel-shell">
        <p className="section-eyebrow mb-2">Included in enterprise export</p>
        <ul className="grid grid-cols-1 gap-2 text-sm text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "Telemetry charts & summaries",
            "RL evaluation metrics",
            "Explainability narratives",
            "Renewable analytics",
            "Battery health analytics",
            "Optimization & peak-shaving summaries",
            "Multi-horizon forecast tables",
            "AI decision log",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="glow-dot-cyan h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default memo(ReportCenter);
