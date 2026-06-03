import { memo, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useVisualizationPrefs } from "../../context/VisualizationPrefsContext";
import { useWeather } from "../../context/WeatherContext";
import { getScenePosition, getFocusCameraTarget } from "./sceneLayout";
import CityAsset from "./CityAssets";
import EnergyFlows from "./EnergyFlows";
import CityEnvironment from "./CityEnvironment";
import { useStoryMode } from "../../context/StoryModeContext";
import ExecutiveHUD from "../hud/ExecutiveHUD";

function CameraRig({ focusId, paused, cinematic }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 10, 22));
  const lookAt = useRef(new THREE.Vector3(0, 0, 0));
  const easing = useRef(0);

  useEffect(() => {
    if (!focusId) {
      targetPos.current.set(0, 10, 22);
      lookAt.current.set(0, 0, 0);
      easing.current = 0;
      return;
    }
    const { position, lookAt: la } = getFocusCameraTarget(focusId);
    targetPos.current.set(...position);
    lookAt.current.set(...la);
    easing.current = 0;
  }, [focusId]);

  useFrame((state, delta) => {
    if (paused) return;
    if (cinematic && !focusId) {
      const t = state.clock.elapsedTime * 0.08;
      targetPos.current.set(Math.sin(t) * 3, 11 + Math.sin(t * 0.5) * 0.5, 20 + Math.cos(t) * 2);
      lookAt.current.set(0, 0.5, 0);
    }
    easing.current = Math.min(1, easing.current + delta * (focusId ? 2.5 : 0.8));
    camera.position.lerp(targetPos.current, focusId ? 0.06 : cinematic ? 0.025 : 0.02);
    camera.lookAt(lookAt.current);
  });

  return null;
}

function StressPulse({ active, intensity = 0.5 }) {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (!ref.current || !active) return;
    const s = 1 + Math.sin(clock.elapsedTime * 2) * 0.04;
    ref.current.scale.set(s, 1, s);
    ref.current.material.opacity = 0.08 + intensity * 0.12 + Math.sin(clock.elapsedTime * 3) * 0.03;
  });
  if (!active) return null;
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[6, 14, 48]} />
      <meshBasicMaterial color="#f87171" transparent opacity={0.1} />
    </mesh>
  );
}

function SceneContent({ visible }) {
  const { assets } = useGridSyncState();
  const { effects3d } = useWeather();
  const { storyFlags, active: storyActive } = useStoryMode();
  const {
    paused,
    autoRotate,
    focusNodeId,
    setFocusNodeId,
    quality,
    isLowGraphics,
    showLabels,
  } = useVisualizationPrefs();

  const fxPaused = paused || !visible;
  const sun = effects3d.sunIntensity * (effects3d.night ? 0.2 : effects3d.rain ? 0.5 : 1.1);
  const fogNear = effects3d.fog ? 18 : 28;
  const starCount = quality === "ultra" ? 800 : quality === "high" ? 400 : quality === "medium" ? 200 : 0;

  return (
    <>
      <color attach="background" args={[effects3d.night ? "#020408" : "#050810"]} />
      <fog attach="fog" args={[effects3d.night ? "#020408" : "#050810", fogNear, 58]} />
      <ambientLight intensity={effects3d.night ? 0.2 : 0.35 - effects3d.cloudCover * 0.08} />
      <directionalLight position={[10, 16, 8]} intensity={sun} color={effects3d.night ? "#6366f1" : "#fef3c7"} />
      <directionalLight position={[-8, 6, -6]} intensity={0.25} color="#22d3ee" />

      {!isLowGraphics && starCount > 0 ? (
        <Stars radius={60} depth={30} count={starCount} factor={2} fade speed={0.5} />
      ) : null}

      <CityEnvironment effects={effects3d} quality={quality} paused={fxPaused} storyActive={storyActive} />

      <StressPulse active={storyFlags?.stressGlow} intensity={0.7} />

      {assets.map((asset) => {
        const pos = getScenePosition(asset.id);
        return (
          <CityAsset
            key={asset.id}
            asset={asset}
            position={pos}
            focused={focusNodeId === asset.id}
            onSelect={setFocusNodeId}
            showLabel={showLabels !== false}
          />
        );
      })}

      <EnergyFlows assets={assets} paused={fxPaused} quality={quality} intense={storyFlags?.flowIntense} />
      <CameraRig focusId={focusNodeId} paused={fxPaused} cinematic={storyActive} />

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate={autoRotate && !focusNodeId && !fxPaused}
        autoRotateSpeed={0.25}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={6}
        maxDistance={38}
        enableDamping
        dampingFactor={0.06}
      />
    </>
  );
}

function Twin3DCanvas({ className = "" }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(true);
  const { paused } = useVisualizationPrefs();

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const frameloop = paused || !visible ? "demand" : "always";

  return (
    <div
      ref={containerRef}
      className={[
        "twin-canvas-shell relative overflow-hidden rounded-2xl border border-violet-500/20 shadow-[0_0_50px_rgba(139,92,246,0.08)]",
        className,
      ].join(" ")}
    >
      <ExecutiveHUD compact className="absolute left-1/2 top-3 z-10 -translate-x-1/2" />
      <Canvas
        dpr={[1, 1.75]}
        frameloop={frameloop}
        camera={{ position: [0, 10, 22], fov: 42 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ height: "100%", minHeight: 520, width: "100%", background: "#050810" }}
      >
        <SceneContent visible={visible} />
      </Canvas>
      {!visible ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 text-xs text-slate-500">
          Twin paused (off-screen)
        </div>
      ) : null}
    </div>
  );
}

export default memo(Twin3DCanvas);
