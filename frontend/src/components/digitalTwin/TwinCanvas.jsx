import { memo, useEffect, useRef } from "react";
import { TWIN_TARGET_FPS } from "../../utils/streamConstants";

const NODE_COLORS = {
  renewable: "#fbbf24",
  grid: "#22d3ee",
  building: "#94a3b8",
  battery: "#34d399",
  charger: "#a78bfa",
  v2b: "#f472b6",
};

const ZONE_FILL = {
  overload: "rgba(244,63,94,0.12)",
  saturation: "rgba(251,191,36,0.1)",
  thermal: "rgba(249,115,22,0.12)",
  renewable: "rgba(52,211,153,0.1)",
  anomaly: "rgba(168,85,247,0.1)",
};

const FRAME_MS = 1000 / TWIN_TARGET_FPS;
const MAX_PARTICLES = 10;

function TwinCanvasInner({
  scene,
  isPaused = false,
  isVisible = true,
  speedMultiplier = 1,
  showStress = true,
  showRenewable = true,
  showAI = true,
  className = "",
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(scene);
  const optionsRef = useRef({ isPaused, isVisible, speedMultiplier, showStress, showRenewable, showAI });
  const particlesRef = useRef([]);
  const curvesRef = useRef([]);
  const phaseRef = useRef(0);
  const rafRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const lastFrameRef = useRef(0);

  sceneRef.current = scene;
  optionsRef.current = { isPaused, isVisible, speedMultiplier, showStress, showRenewable, showAI };

  useEffect(() => {
    const flows = scene?.flows ?? [];
    const particles = [];
    flows.forEach((flow, fi) => {
      if (!flow.active && flow.kw < 0.5) return;
      const count = Math.min(2, Math.max(1, Math.ceil(flow.kw / 25)));
      for (let i = 0; i < count; i += 1) {
        if (particles.length >= MAX_PARTICLES) return;
        particles.push({ flowIndex: fi, t: Math.random(), speed: 0.004 });
      }
    });
    particlesRef.current = particles;
    curvesRef.current = [];
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const onVisibility = () => {
      if (document.hidden) lastFrameRef.current = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(parent.clientWidth);
      const h = Math.floor(parent.clientHeight);
      if (w === sizeRef.current.w && h === sizeRef.current.h && dpr === sizeRef.current.dpr) return;
      sizeRef.current = { w, h, dpr };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const drawFrame = (now) => {
      rafRef.current = requestAnimationFrame(drawFrame);

      const opts = optionsRef.current;
      if (!opts.isVisible || document.hidden) return;

      const elapsed = now - lastFrameRef.current;
      if (elapsed < FRAME_MS) return;
      lastFrameRef.current = now;

      const { w, h, dpr } = sizeRef.current;
      if (w < 10 || h < 10) return;

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;

      if (!opts.isPaused) {
        phaseRef.current += (elapsed / 1000) * speedMultiplier;
      }
      const phase = phaseRef.current;
      const sc = sceneRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, w, h);

      drawGrid(ctx, w, h);

      const flows = (sc?.flows ?? []).filter((f) => opts.showRenewable || f.kind !== "renewable");
      const curves = computeCurves(flows, w, h, phase);
      curvesRef.current = curves;

      if (opts.showStress && sc?.zones?.length) {
        drawStressZones(ctx, sc.zones, w, h);
      }

      drawFlows(ctx, curves);
      if (!opts.isPaused) drawParticles(ctx, curves, particlesRef, opts.speedMultiplier);

      (sc?.nodes ?? []).forEach((node) => drawNode(ctx, node, w, h));
      (sc?.evNodes ?? []).forEach((ev) => drawEvNode(ctx, ev, w, h));

      if (opts.showAI && sc?.aiOverlays?.length) {
        drawAiOverlays(ctx, sc.aiOverlays, w, h);
      }
    };

    rafRef.current = requestAnimationFrame(drawFrame);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={["block h-full w-full", className].join(" ")}
      aria-label="Digital twin grid simulation canvas"
    />
  );
}

function computeCurves(flows, w, h, phase) {
  return flows.map((flow, i) => {
    if (!flow.from || !flow.to) return null;
    const p0 = { x: flow.from.x * w, y: flow.from.y * h };
    const p2 = { x: flow.to.x * w, y: flow.to.y * h };
    const p1 = {
      x: (p0.x + p2.x) / 2,
      y: (p0.y + p2.y) / 2 - 24 - Math.sin(phase + i) * 4,
    };
    return { p0, p1, p2, color: flow.color, kw: flow.kw, active: flow.active };
  }).filter(Boolean);
}

function drawGrid(ctx, w, h) {
  ctx.strokeStyle = "rgba(34,211,238,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawStressZones(ctx, zones, w, h) {
  zones.forEach((zone) => {
    const x = zone.x * w;
    const y = zone.y * h;
    const r = zone.radius * Math.min(w, h);
    ctx.fillStyle = ZONE_FILL[zone.type] ?? ZONE_FILL.overload;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawFlows(ctx, curves) {
  curves.forEach((curve) => {
    const alpha = curve.active ? 0.45 : 0.15;
    const { r, g, b } = hexRgb(curve.color);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = 1 + Math.min(curve.kw / 50, 2);
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.quadraticCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y);
    ctx.stroke();
  });
}

function drawParticles(ctx, curves, particlesRef, speedMul) {
  particlesRef.current.forEach((p) => {
    const curve = curves[p.flowIndex];
    if (!curve) return;
    p.t += p.speed * speedMul;
    if (p.t > 1) p.t -= 1;
    const pt = bezierPoint(curve.p0, curve.p1, curve.p2, p.t);
    const { r, g, b } = hexRgb(curve.color);
    ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawNode(ctx, node, w, h) {
  const x = node.x * w;
  const y = node.y * h;
  const color = NODE_COLORS[node.type] ?? NODE_COLORS.grid;
  const r = 18 + Math.min(node.kw / 8, 10);

  ctx.fillStyle = "rgba(15,23,42,0.85)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (node.stress > 0.55) {
    ctx.strokeStyle = "rgba(244,63,94,0.6)";
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "10px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(node.label ?? node.id, x, y - r - 6);
  ctx.font = "11px ui-monospace,monospace";
  ctx.fillStyle = color;
  ctx.fillText(`${(node.kw ?? 0).toFixed(1)} kW`, x, y + 3);
}

function drawEvNode(ctx, ev, w, h) {
  const x = ev.x * w;
  const y = ev.y * h;
  const r = 6;
  const color = ev.power < -0.5 ? "#f472b6" : ev.power > 0.5 ? "#a78bfa" : "#64748b";
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawAiOverlays(ctx, overlays, w, h) {
  ctx.strokeStyle = "rgba(34,211,238,0.5)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  overlays.forEach((ov) => {
    if (!ov.from || !ov.to) return;
    const x1 = ov.from.x * w;
    const y1 = ov.from.y * h;
    const x2 = ov.to.x * w;
    const y2 = ov.to.y * h;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

function bezierPoint(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function hexRgb(hex) {
  if (!hex?.startsWith?.("#") || hex.length < 7) return { r: 34, g: 211, b: 238 };
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const TwinCanvas = memo(TwinCanvasInner, (prev, next) => {
  if (prev.isPaused !== next.isPaused) return false;
  if (prev.isVisible !== next.isVisible) return false;
  if (prev.speedMultiplier !== next.speedMultiplier) return false;
  if (prev.showStress !== next.showStress) return false;
  if (prev.showRenewable !== next.showRenewable) return false;
  if (prev.showAI !== next.showAI) return false;
  const pm = prev.scene?.metrics;
  const nm = next.scene?.metrics;
  if (pm?.loadKw !== nm?.loadKw) return false;
  if (pm?.stressPct !== nm?.stressPct) return false;
  if (pm?.chargingKw !== nm?.chargingKw) return false;
  if (pm?.renewablePct !== nm?.renewablePct) return false;
  if (prev.scene?.aiOverlays?.length !== next.scene?.aiOverlays?.length) return false;
  return true;
});

TwinCanvas.displayName = "TwinCanvas";

export default TwinCanvas;
