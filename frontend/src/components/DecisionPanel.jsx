import { memo, useMemo, useState } from "react";

import { useDecisionsSlice } from "../hooks/useTelemetrySelectors";

import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";



const SEVERITY_STYLES = {

  critical: {

    badge: "bg-rose-500/15 text-rose-300 ring-rose-500/35",

    border: "border-rose-500/25",

    glow: "hover:shadow-[0_0_28px_rgba(244,63,94,0.15)]",

    dot: "bg-rose-400 shadow-[0_0_8px_#fb7185]",

  },

  high: {

    badge: "bg-amber-500/15 text-amber-300 ring-amber-500/35",

    border: "border-amber-500/25",

    glow: "hover:shadow-[0_0_28px_rgba(251,191,36,0.12)]",

    dot: "bg-amber-400 shadow-[0_0_8px_#fbbf24]",

  },

  medium: {

    badge: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/35",

    border: "border-cyan-500/25",

    glow: "hover:shadow-[0_0_28px_rgba(34,211,238,0.14)]",

    dot: "bg-cyan-400 shadow-[0_0_8px_#22d3ee]",

  },

  low: {

    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/35",

    border: "border-emerald-500/25",

    glow: "hover:shadow-[0_0_28px_rgba(52,211,153,0.12)]",

    dot: "bg-emerald-400 shadow-[0_0_8px_#34d399]",

  },

};



const STATUS_STYLES = {

  active: {

    label: "Active",

    text: "text-cyan-300",

    ring: "ring-cyan-500/30",

    pulse: true,

  },

  acknowledged: {

    label: "Acknowledged",

    text: "text-amber-300",

    ring: "ring-amber-500/30",

    pulse: false,

  },

  resolved: {

    label: "Resolved",

    text: "text-emerald-300",

    ring: "ring-emerald-500/30",

    pulse: false,

  },

};



const IMPACT_COLORS = {

  high: "from-rose-500 to-orange-500",

  medium: "from-amber-500 to-yellow-500",

  low: "from-cyan-500 to-blue-500",

  minimal: "from-slate-600 to-slate-500",

};



const SAFETY_SEVERITY = {

  critical: "border-rose-500/30 bg-rose-500/10 text-rose-200",

  high: "border-amber-500/30 bg-amber-500/10 text-amber-200",

  medium: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",

  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",

};



const STAGGER_MS = [0, 60, 120, 180, 240, 300];



function formatTimestamp(iso) {

  try {

    const d = new Date(iso);

    return d.toLocaleString(undefined, {

      month: "short",

      day: "numeric",

      hour: "2-digit",

      minute: "2-digit",

    });

  } catch {

    return iso;

  }

}



function formatFactor(name) {

  return String(name || "")

    .replace(/_/g, " ")

    .replace(/\b\w/g, (c) => c.toUpperCase());

}



function BrainIcon({ className }) {

  return (

    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>

      <path

        d="M12 2a4 4 0 014 4v1h1a3 3 0 013 3v2a3 3 0 01-3 3h-1v1a4 4 0 01-8 0v-1H7a3 3 0 01-3-3v-2a3 3 0 013-3h1V6a4 4 0 014-4z"

        stroke="currentColor"

        strokeWidth="1.5"

      />

      <circle cx="9" cy="10" r="1" fill="currentColor" />

      <circle cx="15" cy="10" r="1" fill="currentColor" />

    </svg>

  );

}



function SparkIcon({ className }) {

  return (

    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>

      <path

        d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"

        stroke="currentColor"

        strokeWidth="1.5"

        strokeLinejoin="round"

      />

    </svg>

  );

}



function SeverityBadge({ severity }) {

  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.medium;

  return (

    <span

      className={[

        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",

        style.badge,

      ].join(" ")}

    >

      {severity}

    </span>

  );

}



const STATUS_DOT = {

  active: "bg-cyan-400 shadow-[0_0_8px_#22d3ee]",

  acknowledged: "bg-amber-400 shadow-[0_0_8px_#fbbf24]",

  resolved: "bg-emerald-400 shadow-[0_0_8px_#34d399]",

};



function StatusIndicator({ status }) {

  const s = STATUS_STYLES[status] ?? STATUS_STYLES.active;

  const dot = STATUS_DOT[status] ?? STATUS_DOT.active;



  return (

    <span

      className={[

        "inline-flex items-center gap-1.5 rounded-md border border-white/5 bg-slate-900/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1",

        s.ring,

        s.text,

      ].join(" ")}

    >

      <span className="relative flex h-2 w-2">

        {s.pulse ? (

          <span

            className={["absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", dot].join(" ")}

          />

        ) : null}

        <span className={["relative inline-flex h-2 w-2 rounded-full", dot].join(" ")} />

      </span>

      {s.label}

    </span>

  );

}



function ConfidenceMeter({ score, reasoning }) {

  const pct = Math.min(100, Math.max(0, (Number(score) || 0) * 100));

  const hue = pct >= 80 ? "cyan" : pct >= 65 ? "emerald" : pct >= 50 ? "amber" : "rose";



  const barClass =

    hue === "cyan"

      ? "bg-gradient-to-r from-cyan-600 to-emerald-500"

      : hue === "emerald"

        ? "bg-gradient-to-r from-emerald-600 to-cyan-500"

        : hue === "amber"

          ? "bg-gradient-to-r from-amber-600 to-yellow-500"

          : "bg-gradient-to-r from-rose-600 to-orange-500";



  return (

    <div className="rounded-xl border border-cyan-500/15 bg-slate-900/40 p-4">

      <div className="flex items-center justify-between gap-2">

        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">

          Policy confidence

        </p>

        <p className="font-mono text-lg font-bold tabular-nums text-cyan-300">{pct.toFixed(1)}%</p>

      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">

        <div

          className={["h-full rounded-full transition-all duration-700", barClass].join(" ")}

          style={{ width: `${pct}%` }}

        />

      </div>

      {reasoning ? (

        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{reasoning}</p>

      ) : null}

    </div>

  );

}



function ContributionBars({ contributions }) {

  if (!contributions?.length) return null;

  const maxScore = Math.max(...contributions.map((c) => c.influence_score ?? 0), 0.01);



  return (

    <div className="rounded-xl border border-white/5 bg-slate-900/30 p-4">

      <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/90">

        Telemetry influence

      </p>

      <ul className="mt-3 space-y-2.5">

        {contributions.map((c) => {

          const width = ((c.influence_score ?? 0) / maxScore) * 100;

          const gradient = IMPACT_COLORS[c.impact] ?? IMPACT_COLORS.minimal;

          return (

            <li key={c.factor}>

              <div className="flex items-center justify-between gap-2 text-[11px]">

                <span className="text-slate-400">{formatFactor(c.factor)}</span>

                <span className="shrink-0 font-mono tabular-nums text-slate-500">

                  {c.value}

                  <span className="ml-1 text-[9px] uppercase text-slate-600">{c.impact}</span>

                </span>

              </div>

              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">

                <div

                  className={["h-full rounded-full bg-gradient-to-r", gradient].join(" ")}

                  style={{ width: `${width}%` }}

                />

              </div>

            </li>

          );

        })}

      </ul>

    </div>

  );

}



function PriorityBadges({ priorities, priorityFactors }) {

  const items = priorities?.length

    ? priorities.filter((p) => p.active).slice(0, 5)

  : (priorityFactors ?? []).map((label, i) => ({ label, priority: i + 1, weight_pct: 0 }));



  if (!items.length) return null;



  return (

    <div className="flex flex-wrap gap-2">

      {items.map((p, i) => (

        <span

          key={p.goal ?? p.label ?? i}

          className={[

            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-semibold",

            i === 0

              ? "border-violet-400/40 bg-violet-500/15 text-violet-200"

              : "border-white/10 bg-slate-900/50 text-slate-400",

          ].join(" ")}

        >

          <span className="font-mono text-[9px] text-slate-500">#{p.priority ?? i + 1}</span>

          {p.label ?? p}

          {p.weight_pct > 0 ? (

            <span className="font-mono text-slate-500">{p.weight_pct}%</span>

          ) : null}

        </span>

      ))}

    </div>

  );

}



function RationaleCards({ xai, inference }) {

  const cards = [

    { title: "Executive summary", body: xai?.summary, accent: "violet" },

    { title: "AI reasoning", body: xai?.reasoning ?? inference?.ai_reasoning, accent: "cyan" },

    { title: "Risk analysis", body: xai?.risk_analysis, accent: "rose" },

    { title: "Renewable strategy", body: xai?.renewable_strategy ?? inference?.renewable_strategy, accent: "emerald" },

    { title: "Battery strategy", body: xai?.battery_strategy ?? inference?.battery_protection_action, accent: "amber" },

    { title: "Peak shaving", body: xai?.peak_shaving_reason ?? inference?.peak_shaving_action, accent: "orange" },

  ].filter((c) => c.body);



  if (!cards.length) return null;



  const accentMap = {

    violet: "border-violet-500/20 bg-violet-500/5",

    cyan: "border-cyan-500/20 bg-cyan-500/5",

    rose: "border-rose-500/20 bg-rose-500/5",

    emerald: "border-emerald-500/20 bg-emerald-500/5",

    amber: "border-amber-500/20 bg-amber-500/5",

    orange: "border-orange-500/20 bg-orange-500/5",

  };



  return (

    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">

      {cards.map((card) => (

        <div

          key={card.title}

          className={["rounded-lg border p-3", accentMap[card.accent] ?? accentMap.cyan].join(" ")}

        >

          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">

            {card.title}

          </p>

          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{card.body}</p>

        </div>

      ))}

    </div>

  );

}



function ActionInterpretations({ interpretations }) {

  if (!interpretations?.length) return null;



  return (

    <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">

      <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/90">

        DDPG action interpretation

      </p>

      <ul className="mt-3 space-y-2">

        {interpretations.map((a) => (

          <li

            key={a.action}

            className="flex flex-col gap-1 rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"

          >

            <span className="text-[10px] font-mono uppercase text-slate-500">{a.action}</span>

            <span className="text-xs text-slate-300">{a.interpretation}</span>

            <span className="shrink-0 font-mono text-[10px] text-cyan-400/80">

              {a.value >= 0 ? "+" : ""}

              {Number(a.value).toFixed(2)}

            </span>

          </li>

        ))}

      </ul>

    </div>

  );

}



function SafetyIndicators({ safety }) {

  const items = safety?.items ?? [];

  if (!items.length) return null;



  return (

    <div className="rounded-xl border border-rose-500/15 bg-rose-500/5 p-4">

      <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/90">

        Safety & risk mitigation

      </p>

      <ul className="mt-3 space-y-2">

        {items.map((item, i) => (

          <li

            key={`${item.category}-${i}`}

            className={[

              "rounded-lg border px-3 py-2 text-xs leading-relaxed",

              SAFETY_SEVERITY[item.severity] ?? SAFETY_SEVERITY.medium,

            ].join(" ")}

          >

            <span className="mr-2 text-[9px] font-bold uppercase opacity-70">

              {item.category?.replace(/_/g, " ")}

            </span>

            {item.explanation}

          </li>

        ))}

      </ul>

    </div>

  );

}



function XAIExplainabilityPanel({ inference }) {

  const xai = inference?.explainability;

  if (!xai && !inference) return null;



  return (

    <div className="relative mb-6 space-y-4 rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-transparent to-cyan-500/5 p-4 sm:p-5">

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div>

          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90">

            Explainable AI · {inference?.policy_source ?? xai?.policy_source ?? "grid intelligence"}

          </p>

          <h3 className="mt-1 font-display text-base font-bold text-white sm:text-lg">

            {inference?.optimization_action?.replace(/_/g, " ") ?? "Optimization cycle"}

          </h3>

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">

            {xai?.summary ?? inference?.ai_recommendation}

          </p>

        </div>

        <ConfidenceMeter

          score={inference?.confidence_score}

          reasoning={xai?.confidence_reasoning}

        />

      </div>



      <PriorityBadges priorities={xai?.priorities} priorityFactors={xai?.priority_factors} />



      <RationaleCards xai={xai} inference={inference} />



      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        <ContributionBars contributions={xai?.contributions} />

        <SafetyIndicators safety={xai?.safety} />

      </div>



      <ActionInterpretations interpretations={xai?.action_interpretations} />



      {xai?.reward_components ? (

        <div className="flex flex-wrap gap-3 border-t border-white/5 pt-3 text-[10px] text-slate-500">

          <span>

            RL reward proxy:{" "}

            <span className="font-mono text-cyan-400/90">

              {Number(xai.reward_components.total ?? 0).toFixed(3)}

            </span>

          </span>

          <span>

            Renewable:{" "}

            <span className="font-mono">{Number(xai.reward_components.r_renewable ?? 0).toFixed(3)}</span>

          </span>

          <span>

            Peak:{" "}

            <span className="font-mono">{Number(xai.reward_components.r_peak ?? 0).toFixed(3)}</span>

          </span>

        </div>

      ) : null}

    </div>

  );

}



function DecisionCard({ decision, index }) {

  const severity = SEVERITY_STYLES[decision.severity] ?? SEVERITY_STYLES.medium;



  return (

    <article

      className={[

        "group relative overflow-hidden rounded-xl border bg-white/[0.03] p-4 backdrop-blur-md sm:p-5",

        "transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-white/[0.05]",

        severity.border,

        severity.glow,

      ].join(" ")}

      style={{

        animationDelay: `${STAGGER_MS[index % STAGGER_MS.length]}ms`,

      }}

    >

      <div

        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-1 ring-inset ring-cyan-400/0 transition-all duration-300 group-hover:opacity-100 group-hover:ring-cyan-400/25"

        aria-hidden

      />

      <div

        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-cyan-500/5 blur-2xl transition-opacity group-hover:opacity-100"

        aria-hidden

      />



      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div className="min-w-0 flex-1">

          <div className="flex flex-wrap items-center gap-2">

            <SeverityBadge severity={decision.severity} />

            <StatusIndicator status={decision.status} />

          </div>

          <h4 className="mt-2 font-display text-sm font-bold text-white sm:text-base">

            {decision.title}

          </h4>

          <p className="mt-1 text-[11px] text-slate-500">

            <time dateTime={decision.timestamp}>{formatTimestamp(decision.timestamp)}</time>

            <span className="mx-2 text-slate-700">·</span>

            <span className="text-cyan-500/70">{decision.source}</span>

          </p>

        </div>

        {typeof decision.confidence === "number" ? (

          <div className="shrink-0 rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-2.5 py-1.5 text-center">

            <p className="text-[9px] uppercase tracking-wider text-slate-500">Confidence</p>

            <p className="font-mono text-sm font-bold tabular-nums text-cyan-300">

              {((Number(decision?.confidence) || 0) * 100).toFixed(0)}%

            </p>

          </div>

        ) : null}

      </div>



      <div className="relative mt-4 rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3">

        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">

          <SparkIcon className="h-3.5 w-3.5" />

          AI Recommendation

        </p>

        <p className="mt-1.5 text-sm leading-relaxed text-slate-300">

          {decision.recommendation}

        </p>

      </div>



      {decision.reasoning ? (

        <p className="relative mt-3 text-xs leading-relaxed text-slate-500">{decision.reasoning}</p>

      ) : null}



      {(decision.charging_strategy || decision.renewable_strategy || decision.risk_level) && (

        <div className="relative mt-3 flex flex-wrap gap-2 text-[10px]">

          {decision.risk_level ? (

            <span className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1 uppercase text-rose-300">

              Risk {decision.risk_level}

            </span>

          ) : null}

          {decision.charging_strategy ? (

            <span className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-300">

              {decision.charging_strategy}

            </span>

          ) : null}

          {decision.renewable_strategy ? (

            <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-300">

              {decision.renewable_strategy}

            </span>

          ) : null}

        </div>

      )}



      {decision.mitigation_actions?.length ? (

        <ul className="relative mt-2 space-y-1 text-[11px] text-slate-500">

          {decision.mitigation_actions.map((action, idx) => (

            <li key={`${action}-${idx}`}>• {action}</li>

          ))}

        </ul>

      ) : null}

    </article>

  );

}



function DecisionPanelInner({ decisions: decisionsProp, className = "" }) {

  const {

    decisions: telemetryDecisions,

    inference,

    loading,

    error,

    isLive,

    lastUpdated,

    refresh,

  } = useDecisionsSlice();

  const [filter, setFilter] = useState("all");



  const decisions = useMemo(

    () => decisionsProp ?? telemetryDecisions ?? [],

    [decisionsProp, telemetryDecisions],

  );



  const filtered = useMemo(() => {

    if (filter === "all") return decisions;

    return decisions.filter((d) => (d?.status ?? "active") === filter);

  }, [decisions, filter]);



  const counts = useMemo(() => {

    return {

      all: decisions.length,

      active: decisions.filter((d) => d.status === "active").length,

      acknowledged: decisions.filter((d) => d.status === "acknowledged").length,

      resolved: decisions.filter((d) => d.status === "resolved").length,

    };

  }, [decisions]);



  if (loading && !decisionsProp) {

    return <PanelSkeleton className={className} rows={6} />;

  }



  if (error && !decisionsProp && !decisions.length) {

    return <TelemetryError message={error} onRetry={refresh} className={className} />;

  }



  return (

    <section

      className={["relative", className].join(" ")}

      aria-labelledby="xai-panel-title"

    >

      <div

        className="pointer-events-none absolute left-1/2 top-0 h-48 w-96 -translate-x-1/2 rounded-full bg-cyan-500/5 blur-[100px]"

        aria-hidden

      />



      <div

        className={[

          "relative overflow-hidden rounded-2xl border border-cyan-500/15",

          "bg-white/[0.02] p-4 backdrop-blur-md sm:p-6",

          "transition-shadow duration-300 hover:shadow-[0_0_48px_rgba(34,211,238,0.08)]",

        ].join(" ")}

      >

        <div

          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-emerald-400/30"

          aria-hidden

        />



        <header className="relative mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

          <div className="flex items-start gap-3">

            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/10 ring-1 ring-cyan-400/30 shadow-neon-cyan">

              <BrainIcon className="h-6 w-6 text-cyan-400" />

            </div>

            <div>

              <p className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-400/80">

                Explainable AI

              </p>

              <h2

                id="xai-panel-title"

                className="font-display text-xl font-bold text-white sm:text-2xl"

              >

                DDPG Decision Intelligence

              </h2>

              <p className="mt-1 max-w-xl text-sm text-slate-400">

                Transparent RL decisions with telemetry contribution analysis, safety

                mitigations, and optimization priorities.

              </p>

            </div>

          </div>



          <div className="flex flex-wrap items-center gap-2">

            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />

            {[

              { key: "all", label: "All" },

              { key: "active", label: "Active" },

              { key: "acknowledged", label: "Ack'd" },

              { key: "resolved", label: "Resolved" },

            ].map(({ key, label }) => (

              <button

                key={key}

                type="button"

                onClick={() => setFilter(key)}

                className={[

                  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200",

                  filter === key

                    ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.15)]"

                    : "border-white/10 bg-slate-900/40 text-slate-400 hover:border-cyan-500/20 hover:text-cyan-200",

                ].join(" ")}

              >

                {label}

                <span className="ml-1.5 tabular-nums text-slate-500">({counts[key]})</span>

              </button>

            ))}

          </div>

        </header>



        {inference ? <XAIExplainabilityPanel inference={inference} /> : null}



        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-2">

          {filtered.length === 0 ? (

            <p className="col-span-full py-12 text-center text-sm text-slate-500">

              No decisions in this category.

            </p>

          ) : (

            filtered.map((decision, index) => (

              <div

                key={decision.id}

                className="animate-fade-in-up opacity-0"

                style={{

                  animationDelay: `${STAGGER_MS[index % STAGGER_MS.length]}ms`,

                  animationFillMode: "forwards",

                }}

              >

                <DecisionCard decision={decision} index={index} />

              </div>

            ))

          )}

        </div>



        <footer className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4 text-[10px] text-slate-600">

          <span>

            Policy: {inference?.policy_source ?? "DDPG telemetry"} · 9-dim state · 5 continuous

            actions

          </span>

          <span className="flex items-center gap-2">

            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />

            Live XAI inference stream

          </span>

        </footer>

      </div>

    </section>

  );

}

const DecisionPanel = memo(DecisionPanelInner);
DecisionPanel.displayName = "DecisionPanel";

export default DecisionPanel;


