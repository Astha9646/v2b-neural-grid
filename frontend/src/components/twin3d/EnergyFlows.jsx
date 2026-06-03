import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

import { ENERGY_PATHS, getScenePosition } from "./sceneLayout";

function EnergyFlows({ assets, paused, quality, intense = false }) {
  const byId = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const particleRefs = useRef([]);

  const paths = useMemo(
    () =>
      ENERGY_PATHS.map((p) => {
        const a = getScenePosition(p.from);
        const b = getScenePosition(p.to);
        const mid = [(a[0] + b[0]) / 2, 2.5, (a[2] + b[2]) / 2];
        return {
          ...p,
          points: [
            [a[0], 1.2, a[2]],
            mid,
            [b[0], 1.2, b[2]],
          ],
        };
      }),
    [],
  );

  const particleCount = quality === "ultra" ? 3 : quality === "high" ? 2 : 1;

  useFrame(({ clock }) => {
    if (paused) return;
    particleRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const path = paths[i % paths.length];
      if (!path) return;
      const t = (clock.elapsedTime * 0.35 + i * 0.2) % 1;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(...path.points[0]),
        new THREE.Vector3(...path.points[1]),
        new THREE.Vector3(...path.points[2]),
      );
      const pt = curve.getPoint(t);
      mesh.position.copy(pt);
    });
  });

  if (quality === "low") {
    return (
      <>
        {paths.map((path) => (
          <Line key={path.from + path.to} points={path.points} color={path.color} lineWidth={1} opacity={0.35} />
        ))}
      </>
    );
  }

  return (
    <>
      {paths.map((path) => (
        <Line
          key={path.from + path.to}
          points={path.points}
          color={path.color}
          lineWidth={quality === "ultra" ? 2 : 1.2}
          transparent
          opacity={paused ? 0.15 : intense ? 0.9 : 0.7}
          dashed={!paused}
          dashSize={0.5}
          gapSize={0.25}
        />
      ))}
      {!paused &&
        paths.slice(0, 5).flatMap((path, pi) =>
          Array.from({ length: particleCount }, (_, i) => {
            const idx = pi * particleCount + i;
            return (
              <mesh
                key={`particle-${path.from}-${i}`}
                ref={(el) => {
                  particleRefs.current[idx] = el;
                }}
              >
                <sphereGeometry args={[0.08, 8, 8]} />
                <meshBasicMaterial color={path.color} transparent opacity={0.9} />
              </mesh>
            );
          }),
        )}
    </>
  );
}

export default memo(EnergyFlows);
