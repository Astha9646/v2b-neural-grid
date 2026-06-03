import { memo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";

import { ROAD_PATHS } from "./sceneLayout";

function MovingVehicle({ path, speed = 0.15, color = "#22d3ee" }) {
  const ref = useRef(null);
  const tRef = useRef(Math.random());

  useFrame((_, delta) => {
    if (!ref.current) return;
    tRef.current = (tRef.current + delta * speed) % 1;
    const [a, b] = path;
    ref.current.position.set(
      a[0] + (b[0] - a[0]) * tRef.current,
      0.15,
      a[2] + (b[2] - a[2]) * tRef.current,
    );
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.5, 0.2, 0.9]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
    </mesh>
  );
}

function CityEnvironment({ effects, quality, paused, storyActive }) {
  const rainRef = useRef(null);

  useFrame(({ clock }) => {
    if (rainRef.current && effects?.rain && !paused) {
      rainRef.current.position.y = -((clock.elapsedTime * 2) % 4) + 2;
    }
  });

  const showTraffic = quality !== "low" && !paused;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[48, 48]} />
        <meshStandardMaterial
          color={effects?.wetRoads ? "#0c1929" : "#0a1628"}
          metalness={effects?.wetRoads ? 0.45 : 0.25}
          roughness={effects?.wetRoads ? 0.55 : 0.85}
        />
      </mesh>

      {ROAD_PATHS.map((path, i) => (
        <Line
          key={`road-${i}`}
          points={path}
          color="#1e3a5f"
          lineWidth={2}
          opacity={0.6}
        />
      ))}

      {ROAD_PATHS.map((path, i) => (
        <Line
          key={`lane-${i}`}
          points={path.map(([x, y, z]) => [x, y + 0.01, z])}
          color="#22d3ee"
          lineWidth={0.5}
          opacity={0.15}
          dashed
        />
      ))}

      {showTraffic || storyActive ? (
        <>
          <MovingVehicle path={ROAD_PATHS[0]} speed={storyActive ? 0.18 : 0.12} color="#22d3ee" />
          <MovingVehicle path={ROAD_PATHS[1]} speed={0.08} color="#a78bfa" />
          {quality === "ultra" ? (
            <MovingVehicle path={ROAD_PATHS[2]} speed={0.1} color="#fbbf24" />
          ) : null}
        </>
      ) : null}

      {effects?.rain && quality !== "low" && !paused ? (
        <group ref={rainRef}>
          {Array.from({ length: quality === "ultra" ? 16 : 8 }, (_, i) => (
            <mesh key={i} position={[(i % 4) * 3 - 4.5, 3, (i % 5) * 2.5 - 5]}>
              <boxGeometry args={[0.02, 0.6, 0.02]} />
              <meshBasicMaterial color="#93c5fd" transparent opacity={0.25} />
            </mesh>
          ))}
        </group>
      ) : null}
    </group>
  );
}

export default memo(CityEnvironment);
