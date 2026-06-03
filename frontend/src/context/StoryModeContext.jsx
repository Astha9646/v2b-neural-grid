import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/** Cinematic AI optimization story timeline phases */
export const STORY_PHASES = Object.freeze([
  { id: "idle", label: "Standby", durationMs: 0 },
  { id: "spike", label: "Stress spike detected", durationMs: 1800 },
  { id: "alert", label: "Regions entering overload", durationMs: 2000 },
  { id: "reroute", label: "AI rerouting power streams", durationMs: 2200 },
  { id: "battery", label: "Battery storage activated", durationMs: 2000 },
  { id: "ev_throttle", label: "EV charging throttled", durationMs: 1800 },
  { id: "renewable", label: "Renewable routing increased", durationMs: 2200 },
  { id: "recover", label: "Grid stress normalizing", durationMs: 2400 },
  { id: "complete", label: "Optimization complete", durationMs: 0 },
]);

const StoryModeContext = createContext(null);

export function StoryModeProvider({ children }) {
  const [active, setActive] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [summary, setSummary] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setActive(false);
    setPhaseIndex(0);
    setSummary(null);
  }, [clearTimer]);

  const advance = useCallback(
    (index) => {
      if (index >= STORY_PHASES.length) {
        setActive(false);
        setSummary(
          "AI optimization complete: stress reduced 34%, renewable mix +18%, battery discharge optimized, EV load shifted 12 min.",
        );
        return;
      }
      setPhaseIndex(index);
      const phase = STORY_PHASES[index];
      if (phase.durationMs > 0) {
        timerRef.current = setTimeout(() => advance(index + 1), phase.durationMs);
      }
    },
    [],
  );

  const startSimulation = useCallback(() => {
    clearTimer();
    setSummary(null);
    setActive(true);
    setPhaseIndex(1);
    timerRef.current = setTimeout(() => advance(2), STORY_PHASES[1].durationMs);
  }, [advance, clearTimer]);

  const phase = STORY_PHASES[phaseIndex] ?? STORY_PHASES[0];

  /** Visual stress overlay 0–1 driven by story phase */
  const storyStress = useMemo(() => {
    if (!active) return null;
    const id = phase.id;
    if (id === "spike" || id === "alert") return 0.88;
    if (id === "reroute" || id === "battery") return 0.72;
    if (id === "ev_throttle") return 0.58;
    if (id === "renewable") return 0.42;
    if (id === "recover") return 0.22;
    return 0.15;
  }, [active, phase.id]);

  const storyFlags = useMemo(
    () => ({
      batteryActive: active && ["battery", "ev_throttle", "renewable", "recover"].includes(phase.id),
      evThrottled: active && ["ev_throttle", "renewable", "recover"].includes(phase.id),
      renewableBoost: active && ["renewable", "recover", "complete"].includes(phase.id),
      stressGlow: active && ["spike", "alert", "reroute"].includes(phase.id),
      flowIntense: active && phaseIndex >= 3 && phaseIndex <= 7,
    }),
    [active, phase.id, phaseIndex],
  );

  const value = useMemo(
    () => ({
      active,
      phase,
      phaseIndex,
      summary,
      storyStress,
      storyFlags,
      startSimulation,
      reset,
    }),
    [active, phase, phaseIndex, summary, storyStress, storyFlags, startSimulation, reset],
  );

  return <StoryModeContext.Provider value={value}>{children}</StoryModeContext.Provider>;
}

export function useStoryMode() {
  const ctx = useContext(StoryModeContext);
  if (!ctx) throw new Error("useStoryMode must be used within StoryModeProvider");
  return ctx;
}

export default StoryModeContext;
