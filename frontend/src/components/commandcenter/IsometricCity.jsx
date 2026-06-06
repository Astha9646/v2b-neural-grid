import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useWeather } from "../../context/WeatherContext";
import { useStoryMode } from "../../context/StoryModeContext";
import { useVisualizationPrefs } from "../../context/VisualizationPrefsContext";

import {
  CITY_ZONES,
  ENERGY_ROUTES,
  ROUTE_COLORS,
  ROAD_PATHS,
  routePath,
  zoneCenter,
  zoneFootprint,
  toIso,
} from "./isometricLayout";

function IsoBuilding({ zone, selected, stressed, solarGlow, onSelect }) {
  const c = zoneCenter(zone);
  const h = zone.height;
  const top = toIso(zone.gx + zone.w / 2, zone.gy + zone.h / 2, h);
  const footprint = zoneFootprint(zone);
  const accent =
    zone.type === "solar"
      ? "#fbbf24"
      : zone.type === "battery"
        ? "#a78bfa"
        : zone.type === "ev_charger"
          ? "#22d3ee"
          : zone.type === "substation"
            ? "#f97316"
            : "#64748b";

  return (
    <g
      className="iso-zone cursor-pointer transition-opacity"
      onClick={() => onSelect(zone.id)}
      opacity={selected ? 1 : 0.92}
    >
      {stressed ? (
        <ellipse cx={c.x} cy={c.y + 8} rx={zone.w * 18} ry={10} fill="rgba(248,113,113,0.15)" className="stress-pulse" />
      ) : null}
      <polygon points={footprint} fill="#0f172a" stroke={selected ? "#22d3ee" : "rgba(255,255,255,0.08)"} strokeWidth={selected ? 2 : 1} />
      <polygon
        points={`${toIso(zone.gx, zone.gy, h).x},${toIso(zone.gx, zone.gy, h).y} ${toIso(zone.gx + zone.w, zone.gy, h).x},${toIso(zone.gx + zone.w, zone.gy, h).y} ${top.x},${top.y} ${toIso(zone.gx, zone.gy + zone.h, h).x},${toIso(zone.gx, zone.gy + zone.h, h).y}`}
        fill={`${accent}33`}
        stroke={accent}
        strokeWidth={0.5}
        style={{ filter: selected ? `drop-shadow(0 0 12px ${accent})` : undefined }}
      />
      {zone.type === "solar" ? (
        <g className={solarGlow > 0.5 ? "solar-shimmer" : ""}>
          {Array.from({ length: zone.panels ?? 4 }, (_, i) => {
            const px = zone.gx + 0.4 + (i % 3) * 0.9;
            const py = zone.gy + 0.5 + Math.floor(i / 3) * 0.7;
            const p = toIso(px, py, h + 0.05);
            return (
              <rect
                key={i}
                x={p.x - 10}
                y={p.y - 4}
                width={18}
                height={8}
                rx={1}
                fill="#fbbf24"
                opacity={0.55 + solarGlow * 0.35}
                transform={`rotate(-30 ${p.x} ${p.y})`}
              />
            );
          })}
        </g>
      ) : null}
      {zone.type === "ev_charger" ? (
        <g>
          {Array.from({ length: zone.bays ?? 3 }, (_, i) => {
            const p = toIso(zone.gx + 0.6 + i * 0.75, zone.gy + zone.h / 2, h + 0.1);
            return (
              <g key={i}>
                <rect x={p.x - 6} y={p.y - 8} width={12} height={16} rx={2} fill="#22d3ee" opacity={0.35} className="charge-pulse" style={{ animationDelay: `${i * 0.4}s` }} />
              </g>
            );
          })}
        </g>
      ) : null}
      {(zone.towers ?? 1) > 0 && zone.type === "building" ? (
        <g>
          {Array.from({ length: zone.towers ?? 1 }, (_, i) => {
            const tx = zone.gx + 0.5 + i * (zone.w / (zone.towers + 0.5));
            const ty = zone.gy + zone.h / 2;
            const th = h * (0.7 + (i % 2) * 0.25);
            const base = toIso(tx, ty, 0);
            const peak = toIso(tx, ty, th);
            return (
              <g key={i}>
                <line x1={base.x} y1={base.y} x2={peak.x} y2={peak.y} stroke="#334155" strokeWidth={8} strokeLinecap="round" />
                <circle cx={peak.x} cy={peak.y} r={3} fill="#22d3ee" opacity={0.5} className="window-blink" style={{ animationDelay: `${i * 0.7}s` }} />
              </g>
            );
          })}
        </g>
      ) : null}
      {zone.type === "substation" ? (
        <g>
          {[0, 1].map((i) => {
            const p = toIso(zone.gx + zone.w / 2 + (i - 0.5) * 0.6, zone.gy + 0.3, h + 0.5);
            return <line key={i} x1={p.x} y1={p.y} x2={p.x} y2={p.y - 22} stroke="#fbbf24" strokeWidth={2} opacity={0.7} />;
          })}
        </g>
      ) : null}
      {zone.type === "battery" ? (
        <rect
          x={c.x - 18}
          y={c.y - h * 8}
          width={36}
          height={12}
          rx={2}
          fill="#a78bfa"
          opacity={0.45}
          className="charge-pulse"
        />
      ) : null}
      <text x={c.x} y={c.y + 22} textAnchor="middle" className="fill-slate-400 text-[9px] pointer-events-none">
        {zone.label}
      </text>
    </g>
  );
}

function EnergyFlows({ routes, loadKw, intense, paused, stressRoute }) {
  const loadFactor = Math.min(2.2, Math.max(0.5, loadKw / 250 || 0.8));

  return (
    <g className="energy-flows">
      {routes.map((route) => {
        const colors = ROUTE_COLORS[route.kind] ?? ROUTE_COLORS.grid;
        const d = routePath(route.from, route.to);
        const w = (intense ? 2.8 : 1.8) * loadFactor;
        return (
          <g key={route.id}>
            <path d={d} fill="none" stroke={colors.glow} strokeWidth={w + 4} opacity={0.12} />
            <path
              d={d}
              fill="none"
              stroke={colors.stroke}
              strokeWidth={w}
              opacity={0.65}
              className={paused ? "" : "flow-dash"}
            />
            {!paused ? (
              <>
                <circle r={3} fill={colors.particle}>
                  <animateMotion dur={`${2.2 / loadFactor}s`} repeatCount="indefinite" path={d} />
                </circle>
                <circle r={2} fill={colors.particle} opacity={0.7}>
                  <animateMotion dur={`${2.8 / loadFactor}s`} repeatCount="indefinite" path={d} begin="0.8s" />
                </circle>
              </>
            ) : null}
          </g>
        );
      })}
      {stressRoute ? (
        <path d={routePath("grid", "downtown")} fill="none" stroke={ROUTE_COLORS.stress.stroke} strokeWidth={3} opacity={0.5} className="stress-pulse" />
      ) : null}
    </g>
  );
}

function Roads({ paused }) {
  return (
    <g className="iso-roads" opacity={0.55}>
      {ROAD_PATHS.map((road) => {
        const pts = road.points.map(([gx, gy]) => {
          const p = toIso(gx, gy, 0.02);
          return `${p.x},${p.y}`;
        });
        return (
          <g key={road.id}>
            <polyline points={pts.join(" ")} fill="none" stroke="#1e3a5f" strokeWidth={5} strokeLinecap="round" />
            <polyline points={pts.join(" ")} fill="none" stroke="#22d3ee" strokeWidth={1} opacity={0.2} strokeDasharray="4 8" className={paused ? "" : "road-pulse"} />
            {!paused ? (
              <circle r={2.5} fill="#67e8f9" opacity={0.8}>
                <animateMotion dur="4s" repeatCount="indefinite" path={`M ${pts[0].replace(",", " ")} L ${pts[1]?.replace(",", " ") ?? pts[0].replace(",", " ")}`} />
              </circle>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function IsometricCity({ selectedZoneId, onSelectZone, className = "" }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(true);
  const { latest, stress } = useGridSyncState();
  const { mapEffects, effects3d } = useWeather();
  const { storyFlags, active: storyActive } = useStoryMode();
  const { paused, quality } = useVisualizationPrefs();

  const loadKw = Number(latest?.grid_load_kw) || 0;
  const solarGlow = (effects3d?.sunIntensity ?? 0.5) * (mapEffects?.solarPenalty ?? 1);
  const fxPaused = paused || !visible || quality === "low";

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.08 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const stressedZones = useMemo(() => {
    if (!storyFlags?.stressGlow && (stress ?? 0) < 0.55) return new Set();
    return new Set(["grid", "downtown", "battery"]);
  }, [storyFlags, stress]);

  return (
    <div
      ref={containerRef}
      className={[
        "iso-city-shell relative overflow-hidden rounded-2xl border border-cyan-500/15 bg-gradient-to-b from-[#050810] via-[#0a1220] to-[#050810]",
        className,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.06)_0%,transparent_65%)]" />
      {mapEffects?.rain ? <div className="iso-rain pointer-events-none absolute inset-0 z-10 opacity-40" /> : null}
      {mapEffects?.fog ? <div className="pointer-events-none absolute inset-0 z-10 bg-slate-900/20 backdrop-blur-[1px]" /> : null}
      {effects3d?.heat ? <div className="pointer-events-none absolute inset-0 z-10 bg-orange-500/[0.04]" /> : null}

      <svg viewBox="0 0 840 520" className="h-full w-full min-h-[480px]" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="iso-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <Roads paused={fxPaused} />

        {CITY_ZONES.map((zone) => (
          <IsoBuilding
            key={zone.id}
            zone={zone}
            selected={selectedZoneId === zone.id}
            stressed={stressedZones.has(zone.id)}
            solarGlow={zone.type === "solar" ? solarGlow : 0}
            onSelect={onSelectZone}
          />
        ))}

        <EnergyFlows
          routes={ENERGY_ROUTES}
          loadKw={loadKw}
          intense={storyFlags?.flowIntense || storyActive}
          paused={fxPaused}
          stressRoute={storyFlags?.stressGlow}
        />

        {quality !== "low" && !fxPaused ? (
          <g className="ambient-particles" opacity={0.35}>
            {Array.from({ length: quality === "ultra" ? 12 : 6 }, (_, i) => (
              <circle key={i} cx={80 + (i * 67) % 680} cy={60 + (i * 43) % 380} r={1} fill="#22d3ee" className="float-particle" style={{ animationDelay: `${i * 0.5}s` }} />
            ))}
          </g>
        ) : null}
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-[10px] text-slate-400 backdrop-blur-md">
        2.5D Isometric · Live telemetry · Click zones for intel
      </div>
    </div>
  );
}

export default memo(IsometricCity);
