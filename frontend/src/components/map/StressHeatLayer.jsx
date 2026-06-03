import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

const GRADIENT = {
  0.0: "rgba(34,211,238,0)",
  0.3: "rgba(34,211,238,0.1)",
  0.5: "rgba(52,211,153,0.14)",
  0.65: "rgba(251,191,36,0.2)",
  0.8: "rgba(249,115,22,0.28)",
  1.0: "rgba(248,113,113,0.38)",
};

export default function StressHeatLayer({ points, visible, stress = 0 }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    if (!points?.length) return;

    if (layerRef.current) map.removeLayer(layerRef.current);

    layerRef.current = L.heatLayer(points, {
      radius: 38 + stress * 12,
      blur: 44,
      maxZoom: 16,
      minOpacity: 0.12,
      gradient: GRADIENT,
    });
    layerRef.current.addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, visible, stress]);

  return null;
}
