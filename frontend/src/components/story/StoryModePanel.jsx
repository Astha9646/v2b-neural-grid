import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { useStoryMode } from "../../context/StoryModeContext";

function StoryModePanel({ className = "" }) {
  const { active, phase, summary, startSimulation, reset, storyFlags } = useStoryMode();

  return (
    <div className={["flex flex-wrap items-center gap-3", className].join(" ")}>
      {!active && !summary ? (
        <button
          type="button"
          onClick={startSimulation}
          className="group relative overflow-hidden rounded-xl border border-violet-400/30 bg-violet-500/10 px-5 py-2.5 text-sm font-semibold text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.15)] transition-all hover:border-violet-300/50 hover:shadow-[0_0_32px_rgba(139,92,246,0.25)]"
        >
          <span className="relative z-10">Run AI Optimization</span>
          <span className="absolute inset-0 bg-gradient-to-r from-violet-600/0 via-violet-400/10 to-cyan-400/0 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ) : null}

      <AnimatePresence mode="wait">
        {active ? (
          <motion.div
            key="active"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-2"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-amber-300/80">Story Mode</p>
              <p className="text-sm font-medium text-amber-100">{phase.label}</p>
            </div>
            {storyFlags?.stressGlow ? (
              <span className="rounded-md border border-red-400/30 px-2 py-0.5 text-[10px] text-red-300">Stress surge</span>
            ) : null}
            {storyFlags?.batteryActive ? (
              <span className="rounded-md border border-purple-400/30 px-2 py-0.5 text-[10px] text-purple-300">BESS active</span>
            ) : null}
            <button type="button" onClick={reset} className="text-[10px] text-slate-400 hover:text-white">
              Abort
            </button>
          </motion.div>
        ) : summary ? (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-viz max-w-2xl rounded-xl border border-emerald-400/20 px-4 py-3"
          >
            <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">AI Executive Summary</p>
            <p className="text-sm text-slate-200">{summary}</p>
            <button type="button" onClick={reset} className="mt-2 text-[10px] text-cyan-400 hover:underline">
              Dismiss
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default memo(StoryModePanel);
