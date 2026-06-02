import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useRef,

  useState,

  startTransition,

} from "react";



import { connectGridStreams, requestTelemetryResync } from "../services/socketService";

import { mapForecastBundle } from "../utils/forecastMappers";

import {

  computeTelemetrySummary,

  fetchTelemetry,

  getLatestRow,

} from "../services/telemetryService";

import { asArray } from "../utils/safeTelemetry";

import {

  mapActivitiesFromTelemetry,

  mapAlertsFromTelemetry,

  mapDecisionsFromInference,

  mapFleetFromTelemetry,

} from "../utils/operationsMappers";

import {

  mapBatteryHealthPanel,

  mapChargingChartData,

  mapEnergyFlowPanel,

  mapLoadChartData,

  mapMetricKpis,

  mapOptimizationPanel,

  mapSocChartData,

  mapSolarPanelData,

} from "../utils/telemetryMappers";

import { MAX_TELEMETRY_HISTORY, WS_BATCH_MS } from "../utils/streamConstants";

import { createWsBatcher } from "../utils/wsBatcher";



const EMPTY_CHARTS = Object.freeze({ load: [], soc: [], charging: [] });



export const TelemetryStreamContext = createContext(null);

export const TelemetryChartsContext = createContext(null);

export const TelemetryOpsContext = createContext(null);



function normalizeTelemetryPayload(data) {

  if (Array.isArray(data)) return data;

  if (data?.records) return data.records;

  if (data?.rows) return data.rows;

  return [];

}



function capRows(rows) {

  const arr = asArray(rows);

  if (arr.length <= MAX_TELEMETRY_HISTORY) return arr;

  return arr.slice(-MAX_TELEMETRY_HISTORY);

}



function applyTelemetryMessage(prevRows, message) {

  const data = message?.data;

  if (!data) return prevRows;



  const event = message.event;

  if (event === "snapshot" || event === "connected" || event === "resync") {

    const rows = capRows(data.rows);

    if (rows.length) return rows;

    if (data.latest) return capRows([data.latest]);

    return prevRows;

  }



  if (event === "tick" && data.latest) {

    if (!prevRows.length) {

      return capRows([data.latest]);

    }



    const last = prevRows[prevRows.length - 1];

    const sameReading =

      last?.timestamp &&

      data.latest.timestamp &&

      String(last.timestamp) === String(data.latest.timestamp);



    if (sameReading) {

      const next = prevRows.slice();

      next[next.length - 1] = data.latest;

      return capRows(next);

    }



    return capRows([...prevRows, data.latest]);

  }



  return prevRows;

}



function aiPayloadSignature(data) {

  if (!data) return "";

  const inf = data.inference;

  return [

    inf?.timestamp,

    inf?.optimization_action,

    inf?.confidence_score,

    inf?.risk_level,

    data.fleet?.length,

    data.alerts?.length,

  ].join("|");

}



function rowsSignature(rows) {

  if (!rows?.length) return "0";

  const last = rows[rows.length - 1];

  return `${rows.length}|${last?.timestamp ?? ""}|${last?.grid_load_kw ?? ""}`;

}



async function fetchHttpFallback() {

  return capRows(normalizeTelemetryPayload(await fetchTelemetry()));

}



export function TelemetryProvider({ children }) {

  const [rows, setRows] = useState([]);

  const [inference, setInference] = useState(null);

  const [fleet, setFleet] = useState([]);

  const [alerts, setAlerts] = useState([]);

  const [activities, setActivities] = useState([]);

  const [streamEvents, setStreamEvents] = useState([]);

  const [forecastRaw, setForecastRaw] = useState(null);

  const [forecastLoading, setForecastLoading] = useState(true);

  const [forecastError, setForecastError] = useState(null);

  const [forecastLastUpdated, setForecastLastUpdated] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);

  const [lastUpdated, setLastUpdated] = useState(null);

  const [isStreaming, setIsStreaming] = useState(false);

  const [streamStatus, setStreamStatus] = useState({});



  const mountedRef = useRef(true);

  const wsActiveRef = useRef(false);

  const aiSigRef = useRef("");

  const rowsSigRef = useRef("");



  const applyHttpSnapshot = useCallback(async () => {

    try {

      const data = await fetchHttpFallback();

      if (!mountedRef.current) return;

      startTransition(() => {

        setRows(data);

        setError(null);

        setLastUpdated(new Date());

      });

    } catch (err) {

      if (!mountedRef.current) return;

      setError(err?.message || "Failed to load smart-grid telemetry");

    } finally {

      if (mountedRef.current) setLoading(false);

    }

  }, []);



  useEffect(() => {

    mountedRef.current = true;

    setLoading(true);



    applyHttpSnapshot();



    const batcher = createWsBatcher((batch) => {

      if (!mountedRef.current) return;



      startTransition(() => {

        let dataChanged = false;



        if (batch.telemetry) {

          setRows((prev) => {

            const next = applyTelemetryMessage(prev, batch.telemetry);

            const sig = rowsSignature(next);

            if (sig === rowsSigRef.current) return prev;

            rowsSigRef.current = sig;

            dataChanged = true;

            return next;

          });

          setForecastLoading(false);

          setError(null);

        }



        if (batch.forecast?.data) {

          setForecastRaw(batch.forecast.data);

          setForecastError(null);

          setForecastLastUpdated(new Date());

          setForecastLoading(false);

          dataChanged = true;

        }



        if (batch.ai) {

          const data = batch.ai.data ?? {};

          const sig = aiPayloadSignature(data);

          if (sig !== aiSigRef.current) {

            aiSigRef.current = sig;

            if (data.inference) setInference(data.inference);

            if (Array.isArray(data.fleet)) setFleet(data.fleet);

            if (Array.isArray(data.alerts)) setAlerts(data.alerts);

            if (Array.isArray(data.activities)) setActivities(data.activities);

            if (Array.isArray(data.events)) setStreamEvents(data.events);

            dataChanged = true;

          }

          setLoading(false);

          setError(null);

        }



        if (dataChanged) {

          setLastUpdated(new Date());

        }

      });

    }, WS_BATCH_MS);



    const handleTelemetry = (message) => batcher.pushTelemetry(message);

    const handleForecast = (message) => {

      if (message?.type === "forecast") batcher.pushForecast(message);

    };

    const handleAi = (message) => {

      if (message?.type === "ai") batcher.pushAi(message);

    };



    const handleStatus = (status) => {

      if (!mountedRef.current) return;

      const channel = status.channel;

      const state = status.state;



      setStreamStatus((prev) => {

        if (prev[channel] === state) return prev;

        return { ...prev, [channel]: state };

      });



      if (state === "open") {

        wsActiveRef.current = true;

        setIsStreaming(true);

        setLoading(false);

      } else if (state === "closed" || state === "disconnected" || state === "server_disabled") {

        wsActiveRef.current = false;

        setIsStreaming(false);

      } else if (state === "reconnecting" || state === "connecting") {

        setIsStreaming(false);

      }

    };



    const disconnect = connectGridStreams({

      onTelemetry: handleTelemetry,

      onForecast: handleForecast,

      onAi: handleAi,

      onStatus: handleStatus,

    });



    const fallbackTimer = setTimeout(() => {

      if (!mountedRef.current || wsActiveRef.current) return;

      applyHttpSnapshot();

    }, 4000);



    return () => {

      mountedRef.current = false;

      clearTimeout(fallbackTimer);

      batcher.cancel();

      disconnect();

      wsActiveRef.current = false;

    };

  }, [applyHttpSnapshot]);



  const refresh = useCallback(() => {

    requestTelemetryResync();

    applyHttpSnapshot();

  }, [applyHttpSnapshot]);



  const refreshForecast = useCallback(() => {

    setForecastLoading(true);

  }, []);



  const latest = useMemo(() => getLatestRow(rows), [rows]);

  const chartRows = useMemo(() => capRows(rows), [rows]);



  const forecast = useMemo(

    () => mapForecastBundle(forecastRaw, latest),

    [forecastRaw, latest],

  );



  const summary = useMemo(() => computeTelemetrySummary(chartRows) ?? null, [chartRows]);



  const decisions = useMemo(

    () => asArray(mapDecisionsFromInference(inference)),

    [inference],

  );



  const charts = useMemo(

    () => ({

      load: asArray(mapLoadChartData(chartRows)),

      soc: asArray(mapSocChartData(chartRows)),

      charging: asArray(mapChargingChartData(chartRows)),

    }),

    [chartRows],

  );



  const solar = useMemo(() => mapSolarPanelData(chartRows) ?? null, [chartRows]);

  const battery = useMemo(() => mapBatteryHealthPanel(chartRows) ?? null, [chartRows]);

  const energyFlow = useMemo(() => mapEnergyFlowPanel(chartRows) ?? null, [chartRows]);

  const optimization = useMemo(() => mapOptimizationPanel(chartRows) ?? null, [chartRows]);

  const metricKpis = useMemo(() => asArray(mapMetricKpis(chartRows)), [chartRows]);



  const refreshStable = useRef(refresh);

  refreshStable.current = refresh;

  const refreshForecastStable = useRef(refreshForecast);

  refreshForecastStable.current = refreshForecast;



  const stableRefresh = useCallback(() => refreshStable.current(), []);

  const stableRefreshForecast = useCallback(() => refreshForecastStable.current(), []);



  const isLive = Boolean(isStreaming && !error && chartRows.length > 0);



  const streamValue = useMemo(

    () => ({

      loading: Boolean(loading),

      error: error ?? null,

      isStreaming,

      streamStatus,

      lastUpdated: lastUpdated ?? null,

      isLive,

      refresh: stableRefresh,

    }),

    [loading, error, isStreaming, streamStatus, lastUpdated, isLive, stableRefresh],

  );



  const chartsValue = useMemo(

    () => ({

      rows: chartRows,

      latest: latest ?? null,

      summary,

      charts: charts.load?.length || charts.soc?.length || charts.charging?.length ? charts : EMPTY_CHARTS,

      solar,

      battery,

      energyFlow,

      metricKpis,

    }),

    [chartRows, latest, summary, charts, solar, battery, energyFlow, metricKpis],

  );



  const opsValue = useMemo(

    () => ({

      decisions,

      optimization,

      fleet: asArray(fleet),

      alerts: asArray(alerts),

      activities: asArray(activities),

      streamEvents: asArray(streamEvents),

      inference: inference ?? null,

      forecast,

      forecastLoading: Boolean(forecastLoading),

      forecastError: forecastError ?? null,

      forecastLive: Boolean(isStreaming && !forecastError && forecast?.chartSeries?.length > 0),

      forecastLastUpdated: forecastLastUpdated ?? null,

      refreshForecast: stableRefreshForecast,

    }),

    [

      decisions,

      optimization,

      fleet,

      alerts,

      activities,

      streamEvents,

      inference,

      forecast,

      forecastLoading,

      forecastError,

      isStreaming,

      forecastLastUpdated,

      stableRefreshForecast,

    ],

  );



  return (

    <TelemetryStreamContext.Provider value={streamValue}>

      <TelemetryChartsContext.Provider value={chartsValue}>

        <TelemetryOpsContext.Provider value={opsValue}>{children}</TelemetryOpsContext.Provider>

      </TelemetryChartsContext.Provider>

    </TelemetryStreamContext.Provider>

  );

}



export function useTelemetry() {

  const stream = useContext(TelemetryStreamContext);

  const charts = useContext(TelemetryChartsContext);

  const ops = useContext(TelemetryOpsContext);



  return useMemo(() => {

    if (!stream || !charts || !ops) {

      return {

        rows: [],

        latest: null,

        summary: null,

        loading: true,

        error: null,

        isLive: false,

        isStreaming: false,

        streamStatus: {},

        lastUpdated: null,

        refresh: () => {},

        charts: EMPTY_CHARTS,

        solar: null,

        battery: null,

        energyFlow: null,

        decisions: [],

        optimization: null,

        metricKpis: [],

        fleet: [],

        alerts: [],

        activities: [],

        streamEvents: [],

        inference: null,

        forecast: null,

        forecastLoading: true,

        forecastError: null,

        forecastLive: false,

        forecastLastUpdated: null,

        refreshForecast: () => {},

      };

    }

    return { ...stream, ...charts, ...ops };

  }, [stream, charts, ops]);

}



export default TelemetryStreamContext;


