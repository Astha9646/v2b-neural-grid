/**
 * Enterprise report export API — CSV/PDF downloads and preview bundle.
 */

import api from "./api";

const EXPORT_TYPES = {
  telemetry: "/reports/export/telemetry",
  decisions: "/reports/export/decisions",
  forecast: "/reports/export/forecast",
  enterprise: "/reports/export/enterprise",
};

function parseFilename(contentDisposition, fallback) {
  if (!contentDisposition) return fallback;
  const match = /filename="?([^";\n]+)"?/i.exec(contentDisposition);
  return match?.[1]?.trim() || fallback;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {"telemetry"|"decisions"|"forecast"|"enterprise"} reportType
 * @param {"csv"|"pdf"} format
 */
export async function downloadReport(reportType, format = "csv") {
  const path = EXPORT_TYPES[reportType];
  if (!path) {
    throw new Error(`Unknown report type: ${reportType}`);
  }

  const response = await api.get(path, {
    params: { format },
    responseType: "blob",
  });

  const fallback = `v2b_${reportType}.${format === "pdf" ? "pdf" : "csv"}`;
  const filename = parseFilename(response.headers["content-disposition"], fallback);
  triggerBlobDownload(response.data, filename);
  return { filename, reportType, format };
}

export async function fetchReportPreview() {
  const response = await api.get("/reports/preview");
  return response.data;
}

export const REPORT_EXPORT_OPTIONS = [
  {
    id: "telemetry",
    label: "Telemetry",
    description: "Grid load, SOC, charging, stress, and anomaly history",
    defaultFormat: "csv",
    formats: ["csv", "pdf"],
  },
  {
    id: "decisions",
    label: "AI Decisions",
    description: "Optimization actions, RL policy outputs, and decision log",
    defaultFormat: "csv",
    formats: ["csv", "pdf"],
  },
  {
    id: "forecast",
    label: "Forecast",
    description: "Horizon projections for load, peak, renewable, and SOC",
    defaultFormat: "csv",
    formats: ["csv", "pdf"],
  },
  {
    id: "enterprise",
    label: "Full Enterprise",
    description: "RL metrics, explainability, renewable/battery analytics, optimization",
    defaultFormat: "pdf",
    formats: ["csv", "pdf"],
  },
];
