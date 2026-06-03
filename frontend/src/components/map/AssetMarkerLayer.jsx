import { memo, useState } from "react";
import { Marker, useMapEvents } from "react-leaflet";

import { createAssetIcon, createClusterIcon, createAlertIcon } from "./mapIcons";
import { clusterAssets } from "./mapUtils";

function AssetMarkerLayer({ assets, filters, selectedId, onSelect, liveMode, zoom }) {
  const visible = assets.filter((a) => filters[a.type] !== false);
  const items = clusterAssets(visible, zoom);

  return items.map((item) => {
    if (item.kind === "cluster") {
      return (
        <ClusterMarker
          key={item.id}
          item={item}
          onSelect={() => {
            if (item.assets?.[0]) onSelect(item.assets[0]);
          }}
        />
      );
    }
    const asset = item.asset;
    return (
      <Marker
        key={asset.id}
        position={[asset.lat, asset.lng]}
        icon={createAssetIcon(asset, { selected: selectedId === asset.id, live: liveMode })}
        eventHandlers={{
          click: () => onSelect(asset),
        }}
        zIndexOffset={selectedId === asset.id ? 500 : 100}
      />
    );
  });
}

const ClusterMarker = memo(function ClusterMarker({ item, onSelect }) {
  return (
    <Marker
      position={[item.lat, item.lng]}
      icon={createClusterIcon(item.count, item.type)}
      eventHandlers={{ click: onSelect }}
    />
  );
});

function AlertMarkerLayer({ alerts, assets }) {
  if (!alerts?.length) return null;
  return alerts.slice(0, 4).map((alert, i) => {
    const anchor = assets[i % assets.length];
    if (!anchor) return null;
    const severity = alert.severity ?? "medium";
    return (
      <Marker
        key={alert.id ?? `alert-${i}`}
        position={[anchor.lat + 0.0005, anchor.lng - 0.0004]}
        icon={createAlertIcon(severity)}
        zIndexOffset={800}
      />
    );
  });
}

function MapZoomTracker({ onZoom }) {
  useMapEvents({
    zoomend: (e) => onZoom(e.target.getZoom()),
    load: (e) => onZoom(e.target.getZoom()),
  });
  return null;
}

export function useMapZoomState() {
  const [zoom, setZoom] = useState(14);
  return { zoom, setZoom, MapZoomTracker };
}

export { AssetMarkerLayer, AlertMarkerLayer };
