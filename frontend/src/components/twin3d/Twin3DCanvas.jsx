import { memo, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Line, Stars } from "@react-three/drei";
import * as THREE from "three";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useVisualizationPrefs } from "../../context/VisualizationPrefsContext";
import { useWeather } from "../../context/WeatherContext";
import { GRID_GEO_ASSETS } from "../../data/gridGeoAssets";

const NODE_COLORS = {
  solar: "#34d399",
  ev_charger: "#22d3ee",
  building: "#94a3b8",
  battery: "#a78bfa",
  utility: "#fbbf24",
  substation: "#f97316",
};

/** Normalized 3D positions from geo assets */
function toScenePos(asset, index) {
  const base = GRID_GEO_ASSETS[0];
  const x = (asset.lng - base.lng) * 800;
  const z = -(asset.lat - base.lat) * 800;
  const y = asset.type === "solar" ? 1.2 : asset.type === "utility" ? 3 : 0.6;
  return [x + (index % 3) * 0.2, y, z];
}

function CityNode({ asset, position, onSelect, focused }) {
  const meshRef = useRef(null);
  const color = NODE_COLORS[asset.type] ?? "#22d3ee";
  const scale = asset.type === "building" ? [1.2, 2.4, 1.2] : asset.type === "solar" ? [2, 0.15, 1.2] : [0.8, 1, 0.8];

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.material.emissiveIntensity =
      0.15 + Math.sin(t * 2 + position[0]) * 0.08 + (focused ? 0.35 : 0);
  });

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        scale={scale}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(asset.id);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={focused ? 0.5 : 0.2}
          metalness={0.35}
          roughness={0.45}
        />
      </mesh>
      <Html distanceFactor={12} position={[0, scale[1] + 0.6, 0]} className="pointer-events-none">
        <div className="rounded-md border border-cyan-400/30 bg-black/75 px-2 py-0.5 text-[9px] text-cyan-100 whitespace-nowrap">
          {asset.label} · {asset.kw} kW
        </div>
      </Html>
    </group>
  );
}

function EnergyLines({ assets, paused, lowGraphics }) {
  if (lowGraphics) return null;
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const lines = [
    ["solar-1", "bld-1"],
    ["bat-1", "ev-1"],
    ["ev-4", "util-2"],
    ["sub-1", "bld-2"],
  ];
  return lines.map(([from, to], i) => {
    const a = byId[from];
    const b = byId[to];
    if (!a || !b) return null;
    const p1 = toScenePos(a, i);
    const p2 = toScenePos(b, i + 1);
    return (
      <Line
        key={`${from}-${to}`}
        points={[p1, p2]}
        color="#22d3ee"
        lineWidth={1}
        transparent
        opacity={paused ? 0.2 : 0.65}
        dashed
        dashSize={0.4}
        gapSize={0.2}
      />
    );
  });
}

function CameraFocus({ focusId, assets }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 2, 12));

  useEffect(() => {
    const asset = assets.find((a) => a.id === focusId);
    if (!asset) return;
    const idx = assets.indexOf(asset);
    const [x, y, z] = toScenePos(asset, idx);
    target.current.set(x, y + 1, z + 6);
  }, [focusId, assets]);

  useFrame(() => {
    if (!focusId) return;
    camera.position.lerp(target.current, 0.04);
    camera.lookAt(
      target.current.x,
      target.current.y - 1,
      target.current.z - 6,
    );
  });
  return null;
}

function WeatherFX({ effects, paused, lowGraphics }) {
  if (lowGraphics || paused || !effects?.rain) return null;
  return (
    <group>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[(i % 4) * 4 - 6, 4 + (i % 3), (i % 5) * 3 - 6]}>
          <boxGeometry args={[0.02, 0.8, 0.02]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function SceneContent() {
  const { assets } = useGridSyncState();
  const { effects3d } = useWeather();
  const { paused, autoRotate, focusNodeId, setFocusNodeId, isLowGraphics, particleCount } =
    useVisualizationPrefs();

  const sunIntensity = effects3d.sunIntensity * (effects3d.night ? 0.15 : 1.2);

  return (
    <>
      <color attach="background" args={[effects3d.night ? "#030508" : "#050810"]} />
      <fog attach="fog" args={[effects3d.night ? "#030508" : "#050810", 25, 55]} />
      <ambientLight intensity={effects3d.night ? 0.25 : 0.45 + effects3d.cloudCover * -0.1} />
      <directionalLight position={[8, 12, 6]} intensity={sunIntensity} color="#22d3ee" />
      {!isLowGraphics && <Stars radius={80} depth={40} count={particleCount * 20} factor={2} fade />}

      {assets.map((asset, i) => (
        <CityNode
          key={asset.id}
          asset={asset}
          position={toScenePos(asset, i)}
          focused={focusNodeId === asset.id}
          onSelect={setFocusNodeId}
        />
      ))}

      <EnergyLines assets={assets} paused={paused} lowGraphics={isLowGraphics} />
      <WeatherFX effects={effects3d} paused={paused} lowGraphics={isLowGraphics} />
      <CameraFocus focusId={focusNodeId} assets={assets} />

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate={autoRotate && !focusNodeId && !paused}
        autoRotateSpeed={0.35}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={4}
        maxDistance={45}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#0a1628" metalness={0.2} roughness={0.9} />
      </mesh>
    </>
  );
}

function Twin3DCanvas({ className = "" }) {
  return (
    <div className={["relative overflow-hidden rounded-2xl border border-violet-500/15 bg-[#050810]", className].join(" ")}>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 8, 18], fov: 45 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ height: "100%", minHeight: 480, width: "100%" }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}

export default memo(Twin3DCanvas);
