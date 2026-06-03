import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const VisualizationPrefsContext = createContext(null);

const DEFAULT_PREFS = Object.freeze({
  quality: "medium",
  paused: false,
  autoRotate: true,
  focusNodeId: null,
});

export function VisualizationPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState({ ...DEFAULT_PREFS });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (mobile || coarse) {
      setPrefs((p) => (p.quality === "medium" ? { ...p, quality: "low", autoRotate: false } : p));
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

  const setFocusNodeId = useCallback((focusNodeId) => {
    setPrefs((p) => ({ ...p, focusNodeId }));
  }, []);

  const isLowGraphics = prefs.quality === "low";
  const particleCount = prefs.quality === "high" ? 24 : prefs.quality === "medium" ? 12 : 4;

  const value = useMemo(
    () => ({
      ...prefs,
      isLowGraphics,
      particleCount,
      setQuality,
      togglePaused,
      toggleAutoRotate,
      setFocusNodeId,
    }),
    [prefs, isLowGraphics, particleCount, setQuality, togglePaused, toggleAutoRotate, setFocusNodeId],
  );

  return (
    <VisualizationPrefsContext.Provider value={value}>
      {children}
    </VisualizationPrefsContext.Provider>
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
