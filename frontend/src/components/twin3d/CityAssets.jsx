import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";

const COLORS = {
  solar: "#34d399",
  ev_charger: "#22d3ee",
  building: "#64748b",
  battery: "#a78bfa",
  utility: "#fbbf24",
  substation: "#f97316",
};

function BuildingMesh({ color, height = 3, width = 2, emissive = 0.15 }) {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.material.emissiveIntensity = emissive + Math.sin(clock.elapsedTime * 1.2) * 0.04;
    }
  });
  return (
    <mesh ref={ref} position={[0, height / 2, 0]} castShadow>
      <boxGeometry args={[width, height, width * 0.85]} />
      <meshStandardMaterial color="#1e293b" emissive={color} emissiveIntensity={emissive} metalness={0.4} roughness={0.55} />
      <mesh position={[0, height * 0.35, width * 0.43]}>
        <planeGeometry args={[width * 0.6, height * 0.5]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>
    </mesh>
  );
}

function SolarFarmMesh({ color }) {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = Math.sin(clock.elapsedTime * 0.3) * 0.02;
  });
  return (
    <group ref={ref}>
      {[-1.2, 0, 1.2].map((x) => (
        <mesh key={x} position={[x, 0.35, 0]} rotation={[-Math.PI / 6, 0, 0]}>
          <boxGeometry args={[1.4, 0.06, 0.9]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 0.3, 6]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

function BatteryMesh({ color, soc = 50 }) {
  const fill = Math.min(1, soc / 100);
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[1.6, 1.2, 1]} />
        <meshStandardMaterial color="#1e1b4b" emissive={color} emissiveIntensity={0.2} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.2 + fill * 0.4, 0.51]}>
        <boxGeometry args={[1.2, fill * 0.8, 0.05]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function EVHubMesh({ color, active }) {
  const refA = useRef(null);
  const refB = useRef(null);
  useFrame(({ clock }) => {
    if (!active) return;
    const pulse = 0.35 + Math.sin(clock.elapsedTime * 4) * 0.15;
    if (refA.current) refA.current.emissiveIntensity = pulse;
    if (refB.current) refB.current.emissiveIntensity = pulse * 0.8;
  });
  return (
    <group>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[1.8, 2, 0.2, 8]} />
        <meshStandardMaterial color="#0f172a" emissive={color} emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[-0.8, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.9, 0.35]} />
        <meshStandardMaterial ref={refA} color={color} emissive={color} emissiveIntensity={active ? 0.35 : 0.12} />
      </mesh>
      <mesh position={[0.8, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.9, 0.35]} />
        <meshStandardMaterial ref={refB} color={color} emissive={color} emissiveIntensity={active ? 0.28 : 0.12} />
      </mesh>
    </group>
  );
}

function SubstationMesh({ color }) {
  return (
    <group>
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[1.2, 2.4, 1.2]} />
        <meshStandardMaterial color="#292524" emissive={color} emissiveIntensity={0.25} metalness={0.55} roughness={0.45} />
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 2.8, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 1.2, 6]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function UtilityMesh({ color }) {
  return (
    <mesh position={[0, 0.8, 0]}>
      <octahedronGeometry args={[0.9, 0]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} wireframe={false} metalness={0.6} roughness={0.35} />
    </mesh>
  );
}

function AssetVisual({ asset }) {
  const color = COLORS[asset.type] ?? "#22d3ee";
  switch (asset.type) {
    case "building":
      return <BuildingMesh color={color} height={asset.id === "bld-1" ? 4 : 3.2} />;
    case "solar":
      return <SolarFarmMesh color={color} />;
    case "battery":
      return <BatteryMesh color={color} soc={asset.soc ?? 60} />;
    case "ev_charger":
      return <EVHubMesh color={color} active={asset.status === "ok"} />;
    case "substation":
      return <SubstationMesh color={color} />;
    case "utility":
      return <UtilityMesh color={color} />;
    default:
      return null;
  }
}

function CityAsset({ asset, position, focused, onSelect, showLabel }) {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef(null);

  useFrame(({ clock }) => {
    if (!groupRef.current || !focused) return;
    groupRef.current.position.y = Math.sin(clock.elapsedTime * 2) * 0.03;
  });

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(asset.id);
      }}
    >
      {focused ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[1.4, 1.7, 32]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.45} />
        </mesh>
      ) : null}
      <AssetVisual asset={asset} />
      {(hovered || focused) && showLabel ? (
        <Html distanceFactor={14} position={[0, 2.8, 0]} className="pointer-events-none">
          <div className="twin-label rounded-lg border border-cyan-400/40 bg-black/80 px-2.5 py-1 text-[10px] text-cyan-100 whitespace-nowrap shadow-lg">
            {asset.label}
            <span className="ml-2 text-cyan-400/80">{asset.kw} kW</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

export default memo(CityAsset);
