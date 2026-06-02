/**
 * Transform GET /ai/forecast JSON into dashboard-ready predictive intelligence.
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function padSeries(arr, len, fill = 0) {
  const out = [...asArray(arr)];
  while (out.length < len) out.push(fill);
  return out.slice(0, len);
}

function formatStepLabel(index, horizon) {
  return `T+${index + 1}h`;
}

function deriveStress(loadKw, peakKw, stressSeries, index) {
  if (stressSeries?.[index] != null && Number.isFinite(Number(stressSeries[index]))) {
    return clamp(num(stressSeries[index]), 0, 1);
  }
  const peak = Math.max(num(peakKw), 1);
  return clamp(num(loadKw) / peak, 0, 1);
}

/**
 * @param {object|null} raw - API forecast bundle
 * @param {object|null} latestRow - latest telemetry for context
 */
export function mapForecastBundle(raw, latestRow = null) {
  if (!raw || typeof raw !== "object") {
    return emptyForecastView();
  }

  const horizon = Math.max(1, num(raw.horizon, 6));
  const window = num(raw.window, 24);

  const loadKw = padSeries(raw.load_kw, horizon);
  const peakKw = padSeries(raw.peak_demand_kw, horizon);
  const chargingKw = padSeries(raw.charging_demand_kw, horizon);
  const socPct = padSeries(raw.soc_percent, horizon);
  const renewableKw = padSeries(raw.renewable_kw, horizon);
  const stressIdx = padSeries(raw.grid_stress_index, horizon);

  const chartSeries = loadKw.map((load, i) => ({
    step: i + 1,
    label: formatStepLabel(i, horizon),
    load_kw: Math.round(num(load) * 10) / 10,
    charging_demand_kw: Math.round(num(chargingKw[i]) * 10) / 10,
    soc_percent: Math.round(clamp(num(socPct[i]), 0, 100) * 10) / 10,
    stress: Math.round(deriveStress(load, peakKw[i], stressIdx, i) * 1000) / 1000,
    peak_demand_kw: Math.round(num(peakKw[i]) * 10) / 10,
    renewable_kw: Math.round(num(renewableKw[i]) * 10) / 10,
  }));

  const peakPrediction = mapPeakPrediction(chartSeries, peakKw, loadKw, latestRow);
  const renewable = mapRenewableForecast(chartSeries, renewableKw, latestRow);
  const insights = generateForecastInsights(chartSeries, peakPrediction, renewable, latestRow, raw.summary);
  const confidence = computeForecastConfidence(chartSeries, window, latestRow);

  return {
    chartSeries,
    peakPrediction,
    renewable,
    insights,
    confidence,
    meta: {
      horizon,
      window,
      summary: raw.summary ?? {},
    },
  };
}

function emptyForecastView() {
  return {
    chartSeries: [],
    peakPrediction: mapPeakPrediction([], [], [], null),
    renewable: mapRenewableForecast([], [], null),
    insights: ["Awaiting forecast telemetry from /ai/forecast."],
    confidence: 0,
    meta: { horizon: 0, window: 0, summary: {} },
  };
}

export function mapPeakPrediction(chartSeries, peakKw, loadKw, latestRow) {
  const series = asArray(chartSeries);
  const peaks = series.length ? series : peakKw.map((p, i) => ({
    peak_demand_kw: num(p),
    load_kw: num(loadKw[i]),
    stress: deriveStress(loadKw[i], p, null, i),
    label: formatStepLabel(i, peakKw.length),
  }));

  if (!peaks.length) {
    return {
      predictedPeakKw: 0,
      predictedPeakStep: "—",
      overloadProbability: 0,
      maxStress: 0,
      severity: "low",
      timeline: [],
      mitigations: ["Monitor grid load until forecast data is available."],
    };
  }

  const peakEntry = peaks.reduce(
    (best, row) => (num(row.peak_demand_kw ?? row.load_kw) > num(best.peak_demand_kw ?? best.load_kw) ? row : best),
    peaks[0],
  );

  const maxStress = Math.max(...peaks.map((r) => num(r.stress)), 0);
  const overloadProbability = clamp(maxStress * 0.65 + (maxStress > 0.7 ? 0.25 : 0), 0, 0.99);

  let severity = "low";
  if (maxStress >= 0.75 || overloadProbability >= 0.72) severity = "critical";
  else if (maxStress >= 0.58 || overloadProbability >= 0.5) severity = "high";
  else if (maxStress >= 0.4) severity = "medium";

  const mitigations = [];
  if (severity === "critical" || severity === "high") {
    mitigations.push("Activate V2B peak shaving and cap aggregate charging before demand crest.");
    mitigations.push("Defer discretionary DC-fast sessions by 60–90 minutes.");
  }
  if (maxStress > 0.5) {
    mitigations.push("Enable load-shift masks across heterogeneous charger fleet.");
  }
  if (!mitigations.length) {
    mitigations.push("Maintain predictive tracking — no acute peak intervention required.");
  }

  const timeline = peaks.map((row, i) => ({
    step: i + 1,
    label: row.label ?? formatStepLabel(i, peaks.length),
    loadKw: num(row.load_kw),
    peakKw: num(row.peak_demand_kw, row.load_kw),
    stress: num(row.stress),
    risk: num(row.stress) >= 0.65 ? "high" : num(row.stress) >= 0.45 ? "medium" : "low",
  }));

  return {
    predictedPeakKw: Math.round(num(peakEntry.peak_demand_kw, peakEntry.load_kw)),
    predictedPeakStep: peakEntry.label ?? "T+1h",
    overloadProbability: Math.round(overloadProbability * 100),
    maxStress: Math.round(maxStress * 100),
    severity,
    timeline,
    mitigations,
  };
}

export function mapRenewableForecast(chartSeries, renewableKw, latestRow) {
  const series = asArray(chartSeries);
  const latestRenewableRatio = num(latestRow?.renewable_ratio, 0.25);
  const latestCarbon = num(latestRow?.carbon_savings_kg, 0);

  const hourlyCards = series.map((row, i) => {
    const solarKw = num(row.renewable_kw);
    const loadKw = Math.max(num(row.load_kw), 1);
    const contributionPct = clamp((solarKw / loadKw) * 100, 0, 100);
    const isWindow = contributionPct >= 35 || solarKw >= 15;

    return {
      step: row.step ?? i + 1,
      label: row.label ?? formatStepLabel(i, series.length),
      solarKw: Math.round(solarKw * 10) / 10,
      contributionPct: Math.round(contributionPct),
      isAvailabilityWindow: isWindow,
      confidence: clamp(0.55 + contributionPct / 200, 0.5, 0.95),
    };
  });

  const peakCard = hourlyCards.length
    ? hourlyCards.reduce((a, b) => (b.solarKw > a.solarKw ? b : a), hourlyCards[0])
    : null;

  const avgContribution = hourlyCards.length
    ? hourlyCards.reduce((s, c) => s + c.contributionPct, 0) / hourlyCards.length
    : latestRenewableRatio * 100;

  const projectedCarbon = Math.round(
    latestCarbon + hourlyCards.reduce((s, c) => s + c.solarKw * 0.12, 0),
  );

  return {
    hourlyCards,
    peakSolarKw: peakCard?.solarKw ?? 0,
    peakSolarStep: peakCard?.label ?? "—",
    avgContributionPct: Math.round(avgContribution),
    projectedContributionPct: Math.round(
      hourlyCards.length
        ? hourlyCards[hourlyCards.length - 1].contributionPct
        : avgContribution,
    ),
    projectedCarbonKg: projectedCarbon,
    confidence: hourlyCards.length
      ? hourlyCards.reduce((s, c) => s + c.confidence, 0) / hourlyCards.length
      : 0.65,
    insight:
      peakCard && peakCard.solarKw > 10
        ? `Solar peak projected at ${peakCard.label} (${peakCard.solarKw} kW).`
        : "Limited solar generation in forecast window — prioritize stored energy.",
  };
}

export function generateForecastInsights(chartSeries, peakPrediction, renewable, latestRow, summary) {
  const insights = [];
  const series = asArray(chartSeries);

  if (!series.length) {
    return ["Forecast model warming up — insufficient telemetry history."];
  }

  const firstStress = series[0]?.stress ?? 0;
  const lastStress = series[series.length - 1]?.stress ?? 0;
  const stressRising = lastStress > firstStress + 0.08;

  const peakStep = peakPrediction?.predictedPeakStep ?? "T+3h";
  const peakKw = peakPrediction?.predictedPeakKw ?? 0;

  if (peakKw > 0) {
    const minutesAhead = (series.findIndex((r) => r.label === peakStep) + 1) * 60 || 60;
    insights.push(
      `Peak demand expected near ${peakStep} (~${peakKw} kW) within ${minutesAhead} minutes.`,
    );
  }

  const projectedRenewable = renewable?.projectedContributionPct ?? 0;
  if (projectedRenewable > 0) {
    insights.push(
      `Renewable contribution projected to reach ${projectedRenewable}% in the forecast window.`,
    );
  }

  if (stressRising) {
    insights.push(
      "Charging stress forecast rising during evening demand surge — enable preemptive peak shaving.",
    );
  } else if (lastStress < 0.4) {
    insights.push("Grid stress trajectory stable — RL policy can maintain steady-state tracking.");
  }

  const trend = num(summary?.load_trend_1h, 0);
  if (trend > 5) {
    insights.push(`Load trending up ${trend.toFixed(1)} kW/h — review fleet dispatch weights.`);
  } else if (trend < -5) {
    insights.push(`Load trending down ${Math.abs(trend).toFixed(1)} kW/h — opportunity for renewable absorption.`);
  }

  const anomaly = num(latestRow?.anomaly_score, 0);
  if (anomaly > 1.5) {
    insights.push(`Elevated anomaly score (${anomaly.toFixed(2)}) — validate forecast against live SCADA.`);
  }

  return insights.slice(0, 5);
}

function computeForecastConfidence(chartSeries, window, latestRow) {
  const n = asArray(chartSeries).length;
  if (!n) return 0;

  let score = 0.62 + Math.min(window, 48) / 120;
  const stressSpread = Math.max(...chartSeries.map((r) => num(r.stress))) -
    Math.min(...chartSeries.map((r) => num(r.stress)));
  if (stressSpread > 0.35) score -= 0.08;
  if (num(latestRow?.anomaly_score) > 2) score -= 0.1;
  if (n >= 4) score += 0.05;

  return Math.round(clamp(score, 0.45, 0.96) * 1000) / 1000;
}
