import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const VisualizationPrefsContext = createContext(null);

const DEFAULT_PREFS = Object.freeze({
  quality: "medium",
  paused: false,
  autoRotate: true,
  focusNodeId: null,
  showLabels: true,
});

const QUALITY_PARTICLES = Object.freeze({
  low: 4,
  medium: 12,
  high: 24,
  ultra: 40,
});

export function VisualizationPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState({ ...DEFAULT_PREFS });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (mobile || coarse) {
      setPrefs((p) =>
        p.quality === "medium" ? { ...p, quality: "low", autoRotate: false, showLabels: false } : p,
      );
    }
  }, []);

  const setQuality = useCallback((quality) => {
    setPrefs((p) => ({ ...p, quality }));
  }, []);

  const togglePaused = useCallback(() => {
    setPrefs((p) => ({ ...p, paused: !p.paused }));
  }, []);

  const toggleAutoRotate = useCallback(() => {
    setPrefs((p) => ({ ...p, autoRotate: !p.autoRotate }));
  }, []);

  const toggleShowLabels = useCallback(() => {
    setPrefs((p) => ({ ...p, showLabels: !p.showLabels }));
  }, []);

  const setFocusNodeId = useCallback((focusNodeId) => {
    setPrefs((p) => ({ ...p, focusNodeId }));
  }, []);

  const isLowGraphics = prefs.quality === "low";
  const isUltra = prefs.quality === "ultra";
  const particleCount = QUALITY_PARTICLES[prefs.quality] ?? QUALITY_PARTICLES.medium;

  const value = useMemo(
    () => ({
      ...prefs,
      isLowGraphics,
      isUltra,
      particleCount,
      setQuality,
      togglePaused,
      toggleAutoRotate,
      toggleShowLabels,
      setFocusNodeId,
    }),
    [
      prefs,
      isLowGraphics,
      isUltra,
      particleCount,
      setQuality,
      togglePaused,
      toggleAutoRotate,
      toggleShowLabels,
      setFocusNodeId,
    ],
  );

  return (
    <VisualizationPrefsContext.Provider value={value}>{children}</VisualizationPrefsContext.Provider>
  );
}

export function useVisualizationPrefs() {
  const ctx = useContext(VisualizationPrefsContext);
  if (!ctx) {
    throw new Error("useVisualizationPrefs must be used within VisualizationPrefsProvider");
  }
  return ctx;
}

export default VisualizationPrefsContext;
