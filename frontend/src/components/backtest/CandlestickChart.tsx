import { useEffect, useLayoutEffect, useRef, useMemo } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  createSeriesMarkers,
} from "lightweight-charts";
import type { 
  IChartApi, 
  CandlestickData, 
  LineData,
  Time, 
  SeriesMarker, 
  ISeriesApi,
  ISeriesMarkersPluginApi 
} from "lightweight-charts";
import { OHLCData, TradeEntry } from "@/lib/api";
import { Maximize2, Minimize2 } from "lucide-react";
import { useSettings, type ChartColors, type ChartType } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";

interface CandlestickChartProps {
  data: OHLCData[];
  trades: TradeEntry[];
  ticker: string;
  height?: number;
  showMarkers?: boolean;
  showTPSL?: boolean;
  useCustomTPSL?: boolean;
  customTPPercent?: number;
  customSLPercent?: number;
  indicators?: string[];
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  isReplaying?: boolean;
  isPaused?: boolean;
  replaySpeed?: number;
  // Callback to sync display state (throttled by chart to 10fps)
  onReplayTick?: (index: number, total: number) => void;
  // Called when replay naturally ends
  onReplayEnd?: () => void;
  // Allow external seek (from slider scrub)
  seekToIndex?: number;
}

const COLOR_SCHEMES: Record<string, Record<string, string>> = {
  classic: {
    SMA: "#f59e0b", SMA_14: "#f59e0b", SMA_50: "#fb923c",
    EMA: "#8b5cf6", EMA_12: "#8b5cf6", EMA_26: "#a78bfa",
    RSI: "#ec4899", MACD: "#06b6d4",
    BB_upper: "#22c55e", BB_middle: "#22c55e", BB_lower: "#22c55e",
  },
  neon: {
    SMA: "#00ff87", SMA_14: "#00ff87", SMA_50: "#00e5ff",
    EMA: "#ff00e5", EMA_12: "#ff00e5", EMA_26: "#e040fb",
    RSI: "#ffea00", MACD: "#00e5ff",
    BB_upper: "#76ff03", BB_middle: "#76ff03", BB_lower: "#76ff03",
  },
  muted: {
    SMA: "#a8a29e", SMA_14: "#a8a29e", SMA_50: "#d6d3d1",
    EMA: "#7c8594", EMA_12: "#7c8594", EMA_26: "#9ca3af",
    RSI: "#c4a882", MACD: "#6b9dad",
    BB_upper: "#81a88a", BB_middle: "#81a88a", BB_lower: "#81a88a",
  },
};

type NormalizedCandle = CandlestickData<Time> & { datetime: string };
type PrimarySeriesApi = ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
type AreaOptionsPatch = Parameters<ISeriesApi<"Area">["applyOptions"]>[0];

const toCandleSeriesData = (rows: NormalizedCandle[]): CandlestickData<Time>[] =>
  rows.map(({ datetime, ...rest }) => rest);

const toLineSeriesData = (rows: NormalizedCandle[]): LineData<Time>[] =>
  rows.map(({ time, close }) => ({ time, value: close }));

const setPrimarySeriesData = (
  series: PrimarySeriesApi,
  chartType: ChartType,
  rows: NormalizedCandle[],
) => {
  if (chartType === "candles") {
    (series as ISeriesApi<"Candlestick">).setData(toCandleSeriesData(rows));
  } else if (chartType === "line") {
    (series as ISeriesApi<"Line">).setData(toLineSeriesData(rows));
  } else {
    (series as ISeriesApi<"Area">).setData(toLineSeriesData(rows));
  }
};

const updatePrimarySeriesPoint = (
  series: PrimarySeriesApi,
  chartType: ChartType,
  row: NormalizedCandle,
) => {
  if (chartType === "candles") {
    const { datetime, ...rest } = row;
    (series as ISeriesApi<"Candlestick">).update(rest);
  } else {
    const point = { time: row.time, value: row.close };
    if (chartType === "line") {
      (series as ISeriesApi<"Line">).update(point);
    } else {
      (series as ISeriesApi<"Area">).update(point);
    }
  }
};

const createPrimarySeries = (
  chart: IChartApi,
  chartType: ChartType,
  colors: ChartColors,
): PrimarySeriesApi => {
  if (chartType === "line") {
    return chart.addSeries(LineSeries, {
      color: safeColor(colors.line, "#38bdf8"),
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });
  }

  if (chartType === "area") {
    return chart.addSeries(AreaSeries, {
      topColor: colorWithAlpha(colors.areaTop, 0.35, "#38bdf8"),
      bottomColor: colorWithAlpha(colors.areaBottom, 0.03, "#0f172a"),
      lineColor: safeColor(colors.areaTop, "#38bdf8"),
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });
  }

  return chart.addSeries(CandlestickSeries, {
    upColor: safeColor(colors.candleUp, "#22c55e"),
    downColor: safeColor(colors.candleDown, "#ef4444"),
    borderUpColor: safeColor(colors.candleUp, "#22c55e"),
    borderDownColor: safeColor(colors.candleDown, "#ef4444"),
    wickUpColor: safeColor(colors.wickUp, "#22c55e"),
    wickDownColor: safeColor(colors.wickDown, "#ef4444"),
  });
};

// Convert datetime string to UTC timestamp (seconds since epoch) for Lightweight Charts
// Handles multiple formats including timezone-aware strings like "2025-12-01 14:30:00+00:00"
const toUtcTimestamp = (datetime: string | undefined | null): number => {
  // Guard against undefined/null/empty
  if (!datetime || typeof datetime !== "string") {
    return NaN;
  }

  // IMPORTANT: normalize whitespace/newlines from CSV parsing (e.g. trailing "\r")
  const s = datetime.trim();
  if (s === "") return NaN;

  let d: Date;
  try {
    // Check if datetime already has timezone info (+00:00, -05:00, Z, etc.)
    // Support both "+00:00" and "+0000" offsets.
    const hasTimezone = /([+-]\d{2}:\d{2}|[+-]\d{4}|Z)$/.test(s);
    
    if (s.includes("T")) {
      // ISO format: "2024-01-15T13:00:00" or "2024-01-15T13:00:00Z" or "2024-01-15T13:00:00+00:00"
      d = new Date(s);
    } else if (s.includes(" ")) {
      // Space format: "2024-01-15 13:00:00" or "2024-01-15 13:00:00+00:00"
      if (hasTimezone) {
        // Already has timezone, just replace space with T
        d = new Date(s.replace(" ", "T"));
      } else {
        // No timezone, treat as UTC by adding Z
        d = new Date(s.replace(" ", "T") + "Z");
      }
    } else {
      // Date only: "2024-01-15" → midnight UTC
      d = new Date(s + "T00:00:00Z");
    }
  } catch {
    return NaN;
  }

  const timestamp = d.getTime();
  if (isNaN(timestamp)) {
    return NaN;
  }

  return Math.floor(timestamp / 1000);
};

// Generate fake SMA data
const generateFakeSMA = (data: OHLCData[], period: number): { time: Time; value: number }[] => {
  const result: { time: Time; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const time = toUtcTimestamp(data[i].Datetime);
    if (isNaN(time)) continue; // Skip invalid timestamps
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].Close;
    }
    result.push({
      time: time as Time,
      value: sum / period,
    });
  }
  return result.sort((a, b) => (a.time as number) - (b.time as number));
};

// Generate fake EMA data
const generateFakeEMA = (data: OHLCData[], period: number): { time: Time; value: number }[] => {
  const result: { time: Time; value: number }[] = [];
  const multiplier = 2 / (period + 1);
  let ema = data[0]?.Close || 0;
  
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].Close - ema) * multiplier + ema;
    if (i >= period - 1) {
      const time = toUtcTimestamp(data[i].Datetime);
      if (isNaN(time)) continue; // Skip invalid timestamps
      
      result.push({
        time: time as Time,
        value: ema,
      });
    }
  }
  return result.sort((a, b) => (a.time as number) - (b.time as number));
};

// TP/SL Visual structure for persistent series
interface TpslVisual {
  tpArea: ISeriesApi<"Area"> | null;
  slArea: ISeriesApi<"Area"> | null;
  entryLine: ISeriesApi<"Line">;
  box: {
    entryPrice: number;
    tpPrice: number | null;
    slPrice: number | null;
    entryTime: string;
    exitTime: string | null;
    entryTimeMs: number;
    exitTimeMs: number | null;
  };
}

const CandlestickChart = ({
  data,
  trades,
  ticker,
  height = 400,
  showMarkers = true,
  showTPSL = false,
  useCustomTPSL = false,
  customTPPercent = 10,
  customSLPercent = 5,
  indicators = [],
  isFullscreen = false,
  onToggleFullscreen,
  isReplaying = false,
  isPaused = true,
  replaySpeed = 5,
  onReplayTick,
  onReplayEnd,
  seekToIndex,
}: CandlestickChartProps) => {
  const { settings } = useSettings();
  const chartType = settings.appearance.chartType;
  const chartColors = settings.appearance.chartColors;
  const chartOptions = settings.appearance.chartOptions;
  const INDICATOR_COLORS = COLOR_SCHEMES[settings.appearance.chartColorScheme] || COLOR_SCHEMES.classic;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  // Persistent series references for incremental updates
  const primarySeriesRef = useRef<PrimarySeriesApi | null>(null);
  const indicatorSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  
  // PERSISTENT MARKERS PLUGIN - created ONCE, updated via setMarkers()
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  
  // PERSISTENT TP/SL SERIES - created ONCE per box, updated via setData()
  const tpslVisualsRef = useRef<TpslVisual[]>([]);
  
  // Track last rendered index for incremental updates
  const lastRenderedIndexRef = useRef<number>(-1);
  
  // Frame-skip mechanism for smooth replay at high speeds
  const pendingUpdateRef = useRef<number | null>(null);
  const targetIndexRef = useRef<number>(0);
  
  // INTERNAL REPLAY STATE - managed via refs to avoid React re-renders
  const internalIndexRef = useRef<number>(0);
  const lastSyncTimeRef = useRef<number>(0);

  // Prepare candlestick data (full dataset) - uses numeric timestamps to preserve intraday
  const chartData = useMemo<NormalizedCandle[]>(() => {
    const normalized = data
      .map((item) => ({
        time: toUtcTimestamp(item.Datetime) as Time,
        open: item.Open,
        high: item.High,
        low: item.Low,
        close: item.Close,
        datetime: item.Datetime, // Keep original datetime for replay filtering
      }))
      .filter((item) => !isNaN(item.time as number)) // Remove invalid entries
      .sort((a, b) => (a.time as number) - (b.time as number));

    // Only remove truly identical timestamps (same exact second)
    return normalized.filter((item, i, arr) => 
      i === 0 || (item.time as number) !== (arr[i - 1].time as number)
    );
  }, [data]);

  // Component mount/unmount tracking removed - stable identity now guaranteed by parent key prop

  // IMPORTANT: Parent components may pass new array/object identities on re-render.
  // If we depend on raw arrays in the chart-creation effect, the chart can be torn down and
  // recreated during replay, which looks like "flicker back to 1 candle".
  // These stable keys let us recreate the chart only when the underlying dataset actually changes.
  const dataKey = useMemo(() => {
    const first = data[0]?.Datetime ?? "";
    const last = data[data.length - 1]?.Datetime ?? "";
    return `${data.length}|${first}|${last}`;
  }, [data]);

  const indicatorsKey = useMemo(() => indicators.join("|"), [indicators]);

  const tradesKey = useMemo(() => {
    const first = trades[0]?.timestamp ?? "";
    const last = trades[trades.length - 1]?.timestamp ?? "";
    return `${trades.length}|${first}|${last}`;
  }, [trades]);

  const chartAppearanceKey = useMemo(() => {
    return [
      chartType,
      chartOptions.showGrid ? "grid" : "no-grid",
      chartColors.candleUp,
      chartColors.candleDown,
      chartColors.wickUp,
      chartColors.wickDown,
      chartColors.line,
      chartColors.areaTop,
      chartColors.areaBottom,
      chartColors.background,
      chartColors.grid,
      chartColors.crosshair,
    ].join("|");
  }, [chartColors, chartOptions.showGrid, chartType]);

  // Build key for when we truly need to rebuild the underlying chart instance.
  // Critically, this EXCLUDES transient UI state so replay ticks don't tear down the chart.
  const buildKey = useMemo(() => {
    return [
      dataKey,
      tradesKey,
      indicatorsKey,
      `t=${ticker}`,
      `m=${showMarkers ? 1 : 0}`,
      `tp=${showTPSL ? 1 : 0}`,
      `c=${useCustomTPSL ? 1 : 0}`,
      `ctp=${customTPPercent}`,
      `csl=${customSLPercent}`,
      `style=${chartAppearanceKey}`,
    ].join("::");
  }, [
    dataKey,
    tradesKey,
    indicatorsKey,
    ticker,
    showMarkers,
    showTPSL,
    useCustomTPSL,
    customTPPercent,
    customSLPercent,
    chartAppearanceKey,
  ]);

  // Prepare indicator data (real or fake) - full dataset with numeric timestamps
  const indicatorData = useMemo(() => {
    const result: Record<string, { time: Time; value: number }[]> = {};
    
    indicators.forEach((indicator) => {
      // Check if real data exists
      const realData = data
        .filter((item) => item[indicator] !== undefined && item[indicator] !== null)
        .map((item) => ({
          time: toUtcTimestamp(item.Datetime) as Time,
          value: Number(item[indicator]),
        }))
        .filter((item) => !isNaN(item.time as number)) // Filter invalid timestamps
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (realData.length > 0) {
        result[indicator] = realData;
      } else {
        // Generate fake data for common indicators
        if (indicator === "SMA_14" || indicator === "SMA") {
          result[indicator] = generateFakeSMA(data, 14);
        } else if (indicator === "SMA_50") {
          result[indicator] = generateFakeSMA(data, 50);
        } else if (indicator === "EMA_12" || indicator === "EMA") {
          result[indicator] = generateFakeEMA(data, 12);
        } else if (indicator === "EMA_26") {
          result[indicator] = generateFakeEMA(data, 26);
        }
      }
    });
    return result;
  }, [data, indicators]);

  // Prepare all trade markers (full dataset - filtered during replay) with numeric timestamps
  const allTradeMarkers = useMemo((): (SeriesMarker<Time> & { originalTimestamp: string })[] => {
    if (!showMarkers) return [];

    const filteredTrades = trades.filter((t) => t.ticker === ticker);
    
    // Detect direction for this ticker
    const dir = filteredTrades.length > 0 && filteredTrades[0].type === "SELL" ? "short" : "long";

    return filteredTrades
      .map((t) => {
        const isEntry = dir === "long" ? t.type === "BUY" : t.type === "SELL";
        const time = toUtcTimestamp(t.timestamp);
        
        // Skip invalid timestamps
        if (isNaN(time)) return null;
        
        const label = `${t.type} ${t.shares.toFixed(1)}${!isEntry && t.close_reason ? ` (${t.close_reason})` : ""}`;

        return {
          time: time as Time,
          position: isEntry ? "belowBar" : "aboveBar",
          color: isEntry ? "#22c55e" : "#ef4444",
          shape: isEntry ? "arrowUp" : "arrowDown",
          text: label,
          size: 1,
          originalTimestamp: t.timestamp,
        } as SeriesMarker<Time> & { originalTimestamp: string };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [trades, ticker, showMarkers]);

  // Prepare all TP/SL box data (full dataset - filtered during replay)
  const allTpslBoxes = useMemo(() => {
    if (!showTPSL) return [];
    
    const boxes: {
      entryPrice: number;
      tpPrice: number | null;
      slPrice: number | null;
      entryTime: string;
      exitTime: string | null;
      entryTimeMs: number;
      exitTimeMs: number | null;
    }[] = [];
    
    const tickerTrades = trades.filter((t) => t.ticker === ticker);
    const dir = tickerTrades.length > 0 && tickerTrades[0].type === "SELL" ? "short" : "long";
    const entryTrades = tickerTrades.filter((t) => dir === "long" ? t.type === "BUY" : t.type === "SELL");
    const closeTrades = tickerTrades.filter((t) => dir === "long" ? t.type === "SELL" : t.type === "BUY");
    
    entryTrades.forEach((entryTrade) => {
      // Robust timestamp parsing (handles "YYYY-MM-DD HH:mm:ss+00:00" from CSV and avoids NaN)
      const entryTimeSec = toUtcTimestamp(entryTrade.timestamp);
      if (isNaN(entryTimeSec)) return; // Skip if we can't place the box in time

      const entryTimeMs = entryTimeSec * 1000;

      // Find the corresponding close trade (next close after this entry) using numeric timestamps
      const correspondingSell = closeTrades
        .map((s) => ({ s, ms: toUtcTimestamp(s.timestamp) * 1000 }))
        .filter((x) => !isNaN(x.ms) && x.ms > entryTimeMs)
        .sort((a, b) => a.ms - b.ms)[0]?.s;
      
      const entryPrice = entryTrade.price;
      
      // Calculate TP/SL based on mode
      let tpPrice: number | null = null;
      let slPrice: number | null = null;
      
      if (useCustomTPSL) {
        // Custom percentage-based calculation
        tpPrice = entryPrice * (1 + customTPPercent / 100);
        slPrice = entryPrice * (1 - customSLPercent / 100);
      } else {
        // Use actual values from trade
        tpPrice = entryTrade.tp_price && entryTrade.tp_price > 0 ? entryTrade.tp_price : null;
        slPrice = entryTrade.sl_price && entryTrade.sl_price > 0 ? entryTrade.sl_price : null;
      }
      
      // Skip if no TP/SL to show (in actual mode only)
      if (!useCustomTPSL && !tpPrice && !slPrice) return;
      
      boxes.push({
        entryPrice,
        tpPrice,
        slPrice,
        entryTime: entryTrade.timestamp,
        exitTime: correspondingSell?.timestamp || null,
        entryTimeMs,
        exitTimeMs: correspondingSell ? toUtcTimestamp(correspondingSell.timestamp) * 1000 : null,
      });
    });
    
    return boxes;
  }, [trades, ticker, showTPSL, useCustomTPSL, customTPPercent, customSLPercent]);

  // ===== REFS TO HOLD DATA FOR REPLAY EFFECT =====
  // These refs allow the replay effect to access the latest data without triggering re-runs
  const chartDataRef = useRef(chartData);
  const indicatorDataRef = useRef(indicatorData);
  const allTradeMarkersRef = useRef(allTradeMarkers);
  const allTpslBoxesRef = useRef(allTpslBoxes);
  const showTPSLRef = useRef(showTPSL);
  const isReplayingRef = useRef(isReplaying);

  // Sync refs when values change (these don't trigger the replay effect)
  useEffect(() => { chartDataRef.current = chartData; }, [chartData]);
  useEffect(() => { indicatorDataRef.current = indicatorData; }, [indicatorData]);
  useEffect(() => { allTradeMarkersRef.current = allTradeMarkers; }, [allTradeMarkers]);
  useEffect(() => { allTpslBoxesRef.current = allTpslBoxes; }, [allTpslBoxes]);
  useEffect(() => { showTPSLRef.current = showTPSL; }, [showTPSL]);
  useEffect(() => { isReplayingRef.current = isReplaying; }, [isReplaying]);

  // Helper function to compute TP/SL data for a single box using numeric timestamps
  const computeTpslData = (
    box: TpslVisual['box'],
    visibleData: typeof chartData,
    currentTimeMs: number | null
  ) => {
    // In replay mode, only show boxes where entry time has been reached
    if (currentTimeMs !== null && box.entryTimeMs > currentTimeMs) {
      return { tpData: [], slData: [], entryData: [] };
    }

    const entryTimeSec = Math.floor(box.entryTimeMs / 1000);
    
    // Determine exit time based on replay state
    let effectiveExitTimeSec: number | null = null;
    if (box.exitTime) {
      if (currentTimeMs !== null && box.exitTimeMs && box.exitTimeMs > currentTimeMs) {
        // Trade hasn't closed yet in replay - use current replay position
        effectiveExitTimeSec = null;
      } else {
        effectiveExitTimeSec = Math.floor(box.exitTimeMs! / 1000);
      }
    }
    
    // Filter visible chart data to only the trade duration using NUMERIC comparison
    const tradeData = visibleData.filter((d) => {
      const timeSec = d.time as number;
      const isAfterEntry = timeSec >= entryTimeSec;
      const isBeforeExit = effectiveExitTimeSec ? timeSec <= effectiveExitTimeSec : true;
      return isAfterEntry && isBeforeExit;
    });
    
    if (tradeData.length === 0) {
      return { tpData: [], slData: [], entryData: [] };
    }

    const tpData = box.tpPrice 
      ? tradeData.map((d) => ({ time: d.time, value: box.tpPrice! }))
      : [];
    
    const slData = box.slPrice 
      ? tradeData.map((d) => ({ time: d.time, value: box.slPrice! }))
      : [];
    
    const entryData = tradeData.map((d) => ({ time: d.time, value: box.entryPrice }));

    return { tpData, slData, entryData };
  };

  // ===== EFFECT 1: Chart Creation - runs ONLY when structure changes =====
  // This effect handles chart creation/destruction. It creates PERSISTENT series.
  useEffect(() => {
    if (!chartContainerRef.current || chartData.length === 0) return;

    // Chart rebuild - should only happen when buildKey changes (data/settings), not during replay ticks

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      primarySeriesRef.current = null;
      indicatorSeriesRefs.current.clear();
      markersPluginRef.current = null;
      tpslVisualsRef.current = [];
      lastRenderedIndexRef.current = -1;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: safeColor(chartColors.background, "#0a0a0a") },
        textColor: "hsl(215, 20%, 55%)",
        fontFamily: "JetBrains Mono, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: chartOptions.showGrid ? colorWithAlpha(chartColors.grid, 0.45, "#1f2937") : "rgba(255, 255, 255, 0)" },
        horzLines: { color: chartOptions.showGrid ? colorWithAlpha(chartColors.grid, 0.45, "#1f2937") : "rgba(255, 255, 255, 0)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: safeColor(chartColors.crosshair, "#14b8a6"),
          labelBackgroundColor: safeColor(chartColors.background, "#0a0a0a"),
        },
        horzLine: {
          color: safeColor(chartColors.crosshair, "#14b8a6"),
          labelBackgroundColor: safeColor(chartColors.background, "#0a0a0a"),
        },
      },
      width: chartContainerRef.current.clientWidth,
      height: isFullscreen ? window.innerHeight - 120 : height,
      timeScale: { borderColor: "rgba(255, 255, 255, 0.1)", timeVisible: true },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.1)" },
    });

    chartRef.current = chart;

    // Create primary price series and store reference
    const primarySeries = createPrimarySeries(chart, chartType, chartColors);
    primarySeriesRef.current = primarySeries;

    // Create indicator series and store references
    indicatorSeriesRefs.current.clear();
    Object.entries(indicatorData).forEach(([indicator, indData]) => {
      if (indData.length > 0) {
        const color = INDICATOR_COLORS[indicator] || "#888888";
        const lineSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        indicatorSeriesRefs.current.set(indicator, lineSeries);
      }
    });

    // CREATE PERSISTENT MARKERS PLUGIN (ONCE)
    // Initialize with empty markers - will be populated based on mode
    markersPluginRef.current = createSeriesMarkers(primarySeries, []);

    // CREATE PERSISTENT TP/SL SERIES (ONCE per box)
    tpslVisualsRef.current = [];
    if (showTPSL) {
      allTpslBoxes.forEach((box) => {
        // Create TP area series (if TP exists)
        let tpArea: ISeriesApi<"Area"> | null = null;
        if (box.tpPrice) {
          tpArea = chart.addSeries(AreaSeries, {
            topColor: "rgba(34, 197, 94, 0.3)",
            bottomColor: "rgba(34, 197, 94, 0.3)",
            lineColor: "rgba(34, 197, 94, 0)",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          tpArea.applyOptions({
            baseValue: { type: "price", price: box.entryPrice },
          } as unknown as AreaOptionsPatch);
        }

        // Create SL area series (if SL exists)
        let slArea: ISeriesApi<"Area"> | null = null;
        if (box.slPrice) {
          slArea = chart.addSeries(AreaSeries, {
            topColor: "rgba(239, 68, 68, 0.35)",
            bottomColor: "rgba(239, 68, 68, 0.35)",
            lineColor: "rgba(239, 68, 68, 0)",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          slArea.applyOptions({
            baseValue: { type: "price", price: box.entryPrice },
          } as unknown as AreaOptionsPatch);
        }

        // Create entry line series
        const entryLine = chart.addSeries(LineSeries, {
          color: "rgba(255, 255, 255, 0.6)",
          lineWidth: 1,
          lineStyle: 2, // Dashed
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });

        tpslVisualsRef.current.push({
          tpArea,
          slArea,
          entryLine,
          box,
        });
      });
    }

    // Check if we're starting in replay mode
    if (isReplayingRef.current) {
      // START EMPTY - show just the first candle
      const firstCandle = chartData[0];
      if (firstCandle) {
        setPrimarySeriesData(primarySeries, chartType, [firstCandle]);
        
        // Clear indicators to first point (numeric comparison)
        const firstTime = firstCandle.time as number;
        Object.entries(indicatorData).forEach(([indicator, indData]) => {
          const series = indicatorSeriesRefs.current.get(indicator);
          if (series) {
            const filtered = indData.filter((d) => (d.time as number) <= firstTime);
            series.setData(filtered);
          }
        });

        // Empty markers
        markersPluginRef.current?.setMarkers([]);

        // Empty TP/SL series
        tpslVisualsRef.current.forEach((visual) => {
          visual.tpArea?.setData([]);
          visual.slArea?.setData([]);
          visual.entryLine.setData([]);
        });

        lastRenderedIndexRef.current = 0;
        chart.timeScale().scrollToPosition(-5, false);
      }
    } else {
      // NORMAL MODE - set full data
      setPrimarySeriesData(primarySeries, chartType, chartData);

      // Set indicator data
      Object.entries(indicatorData).forEach(([indicator, indData]) => {
        const series = indicatorSeriesRefs.current.get(indicator);
        if (series) {
          series.setData(indData);
        }
      });

      // Set all markers
      if (allTradeMarkers.length > 0) {
        const markersWithoutTimestamp = allTradeMarkers.map(({ originalTimestamp, ...rest }) => rest as SeriesMarker<Time>);
        markersPluginRef.current?.setMarkers(markersWithoutTimestamp);
      }

      // Set TP/SL data for all boxes
      tpslVisualsRef.current.forEach((visual) => {
        const { tpData, slData, entryData } = computeTpslData(visual.box, chartData, null);
        visual.tpArea?.setData(tpData);
        visual.slArea?.setData(slData);
        visual.entryLine.setData(entryData);
      });

      lastRenderedIndexRef.current = chartData.length - 1;
      chart.timeScale().fitContent();
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      primarySeriesRef.current = null;
      indicatorSeriesRefs.current.clear();
      markersPluginRef.current = null;
      tpslVisualsRef.current = [];
      lastRenderedIndexRef.current = -1;
    };
    // NOTE: isReplaying is NOT a dependency - replay transition effect handles mode switching
  }, [buildKey]);

  // ===== EFFECT 1B: Resize handling (no rebuild) =====
  useEffect(() => {
    const handleResize = () => {
      if (!chartContainerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: isFullscreen ? window.innerHeight - 120 : height,
      });
    };

    // Apply immediately for fullscreen toggles / height changes
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [height, isFullscreen]);

  // ===== EFFECT 2: Replay Transition - runs BEFORE paint when replay mode changes =====
  // useLayoutEffect runs synchronously before browser paint - this prevents the flash
  useLayoutEffect(() => {
    if (!chartRef.current || !primarySeriesRef.current) return;
    
    const chart = chartRef.current;
    const primarySeries = primarySeriesRef.current;
    const currentChartData = chartDataRef.current;
    
    if (isReplaying) {
      // ENTERING REPLAY: Clear everything immediately (before paint)
      // Reset last rendered index for new replay session
      lastRenderedIndexRef.current = 0;
      
      // Show just the first candle (auto-start behavior)
      if (currentChartData.length > 0) {
        const firstCandle = currentChartData[0];
        setPrimarySeriesData(primarySeries, chartType, [firstCandle]);
        
        // Clear indicators to first point (numeric comparison)
        const currentIndicatorData = indicatorDataRef.current;
        const firstTime = firstCandle.time as number;
        indicatorSeriesRefs.current.forEach((series, indicator) => {
          const indData = currentIndicatorData[indicator];
          if (indData && indData.length > 0) {
            const filtered = indData.filter((d) => (d.time as number) <= firstTime);
            series.setData(filtered);
          } else {
            series.setData([]);
          }
        });
        
        // Clear markers using persistent plugin
        markersPluginRef.current?.setMarkers([]);
        
        // Clear TP/SL using persistent series (just setData to empty)
        tpslVisualsRef.current.forEach((visual) => {
          visual.tpArea?.setData([]);
          visual.slArea?.setData([]);
          visual.entryLine.setData([]);
        });
        
        // Position chart to show the first candle
        chart.timeScale().scrollToPosition(-5, false);
      }
    } else {
      // EXITING REPLAY: Restore full data immediately (before paint)
      setPrimarySeriesData(primarySeries, chartType, currentChartData);
      
      // Restore indicators
      const currentIndicatorData = indicatorDataRef.current;
      indicatorSeriesRefs.current.forEach((series, indicator) => {
        const indData = currentIndicatorData[indicator];
        if (indData) {
          series.setData(indData);
        }
      });
      
      // Restore markers using persistent plugin
      const currentMarkers = allTradeMarkersRef.current;
      const markersWithoutTimestamp = currentMarkers.map(({ originalTimestamp, ...rest }) => rest as SeriesMarker<Time>);
      markersPluginRef.current?.setMarkers(markersWithoutTimestamp);
      
      // Restore TP/SL using persistent series
      tpslVisualsRef.current.forEach((visual) => {
        const { tpData, slData, entryData } = computeTpslData(visual.box, currentChartData, null);
        visual.tpArea?.setData(tpData);
        visual.slArea?.setData(slData);
        visual.entryLine.setData(entryData);
      });
      
      lastRenderedIndexRef.current = currentChartData.length - 1;
      chart.timeScale().fitContent();
    }
    
    // Cleanup: Cancel any pending animation frame when mode changes
    return () => {
      if (pendingUpdateRef.current !== null) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, [isReplaying, chartType]);

  // ===== REFS for tracking what's already rendered (prevents redundant setData calls) =====
  const lastMarkerCountRef = useRef(0);
  const lastIndicatorCountsRef = useRef<Map<string, number>>(new Map());

  // ===== HELPER: Update chart to a specific index (no React state) =====
  const updateChartToIndex = (targetIndex: number) => {
    if (!chartRef.current || !primarySeriesRef.current) return;
    
    const currentChartData = chartDataRef.current;
    if (currentChartData.length === 0) return;
    
    const clampedIndex = Math.min(targetIndex, currentChartData.length - 1);
    const prevIndex = lastRenderedIndexRef.current;
    
    // Skip if nothing changed
    if (clampedIndex === prevIndex) return;

    const primarySeries = primarySeriesRef.current;

    // INCREMENTAL UPDATE OPTIMIZATION for price series
    if (clampedIndex === prevIndex + 1) {
      // Sequential tick - use fast update() method (no flicker)
      const nextCandle = currentChartData[clampedIndex];
      updatePrimarySeriesPoint(primarySeries, chartType, nextCandle);
    } else {
      // Jump (scrub or reset or catch-up) - use setData()
      const visibleData = currentChartData.slice(0, clampedIndex + 1);
      setPrimarySeriesData(primarySeries, chartType, visibleData);
    }
    
    lastRenderedIndexRef.current = clampedIndex;

    // Get current replay timestamp for filtering markers/TP-SL
    const lastCandle = currentChartData[clampedIndex];
    const lastVisibleTime = lastCandle.time as number;
    const currentTimeMs = toUtcTimestamp(lastCandle.datetime) * 1000;

    // INCREMENTAL UPDATE for indicators - only setData if count changed
    const currentIndicatorData = indicatorDataRef.current;
    indicatorSeriesRefs.current.forEach((series, indicator) => {
      const indData = currentIndicatorData[indicator];
      if (!indData) return;
      
      const filteredIndData = indData.filter((d) => (d.time as number) <= lastVisibleTime);
      const prevCount = lastIndicatorCountsRef.current.get(indicator) || 0;
      
      // Only update if we have new data points
      if (filteredIndData.length !== prevCount) {
        series.setData(filteredIndData);
        lastIndicatorCountsRef.current.set(indicator, filteredIndData.length);
      }
    });

    // INCREMENTAL UPDATE for markers - only setData if count changed
    const currentMarkers = allTradeMarkersRef.current;
    const visibleMarkers = currentMarkers
      .filter((m) => {
        const markerTimeMs = toUtcTimestamp(m.originalTimestamp) * 1000;
        return !isNaN(markerTimeMs) && markerTimeMs <= currentTimeMs;
      })
      .map(({ originalTimestamp, ...rest }) => rest as SeriesMarker<Time>);
    
    if (visibleMarkers.length !== lastMarkerCountRef.current) {
      markersPluginRef.current?.setMarkers(visibleMarkers);
      lastMarkerCountRef.current = visibleMarkers.length;
    }

    // INCREMENTAL UPDATE for TP/SL - only update boxes that are now visible
    if (showTPSLRef.current && !isNaN(currentTimeMs)) {
      const visibleData = currentChartData.slice(0, clampedIndex + 1);
      tpslVisualsRef.current.forEach((visual) => {
        // Only compute if the trade entry is within visible range
        if (visual.box.entryTimeMs <= currentTimeMs) {
          const { tpData, slData, entryData } = computeTpslData(visual.box, visibleData, currentTimeMs);
          visual.tpArea?.setData(tpData);
          visual.slArea?.setData(slData);
          visual.entryLine.setData(entryData);
        }
      });
    }
  };

  // ===== EFFECT 3A: Internal Replay Timer - runs entirely via refs (no React re-renders) =====
  useEffect(() => {
    if (!isReplaying || isPaused) return;
    
    const currentChartData = chartDataRef.current;
    if (currentChartData.length === 0) return;

    // Guard: if dataset is too small, replay would end immediately
    if (currentChartData.length <= 1) return;
    
    let rafId: number;
    let lastTickTime = performance.now();
    const tickIntervalMs = 1000 / replaySpeed;
    
    const tick = (now: number) => {
      const elapsed = now - lastTickTime;
      
      if (elapsed >= tickIntervalMs) {
        lastTickTime = now - (elapsed % tickIntervalMs);
        
        // Advance internal index
        const newIndex = internalIndexRef.current + 1;
        if (newIndex >= currentChartData.length) {
          onReplayEnd?.();
          return;
        }
        internalIndexRef.current = newIndex;
        
        // Update chart directly (no React)
        updateChartToIndex(newIndex);
        
        // Throttle React sync to 10fps for UI display (every 100ms)
        if (now - lastSyncTimeRef.current > 100) {
          lastSyncTimeRef.current = now;
          onReplayTick?.(newIndex, currentChartData.length);
        }
      }
      
      rafId = requestAnimationFrame(tick);
    };
    
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isReplaying, isPaused, replaySpeed, onReplayTick, onReplayEnd, chartType]);

  // ===== EFFECT 3B: External Seek Handler - responds to slider scrub =====
  // Track last processed seekIndex to prevent re-applying the same seek
  const lastSeekIndexRef = useRef<number | undefined>(undefined);
  
  useEffect(() => {
    if (seekToIndex === undefined) return;
    // Only apply if this is a NEW seek command (different from last processed)
    if (seekToIndex === lastSeekIndexRef.current) return;
    
    lastSeekIndexRef.current = seekToIndex;
    internalIndexRef.current = seekToIndex;
    updateChartToIndex(seekToIndex);
    
    // Sync display immediately on seek (when paused)
    if (isPaused) {
      onReplayTick?.(seekToIndex, chartDataRef.current.length);
    }
  }, [seekToIndex, isPaused, onReplayTick, chartType]);
  
  // Reset lastSeekIndex when exiting replay
  useEffect(() => {
    if (!isReplaying) {
      lastSeekIndexRef.current = undefined;
    }
  }, [isReplaying]);

  // Reset incremental tracking refs when entering/exiting replay
  useEffect(() => {
    if (isReplaying) {
      lastMarkerCountRef.current = 0;
      lastIndicatorCountsRef.current.clear();
      internalIndexRef.current = 0;
      lastSyncTimeRef.current = 0;
    }
  }, [isReplaying]);

  const buyCount = trades.filter((t) => t.ticker === ticker && t.type === "BUY").length;
  const sellCount = trades.filter((t) => t.ticker === ticker && t.type === "SELL").length;

  return (
    <div
      className="rounded-xl border border-border overflow-hidden animate-chart-enter"
      style={{ backgroundColor: safeColor(chartColors.background, "#0a0a0a") }}
    >
      <div
        className="flex items-center justify-between p-4 border-b border-border/50"
        style={{ backgroundColor: colorWithAlpha(chartColors.background, 0.88, "#0a0a0a") }}
      >
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold font-mono text-foreground">{ticker}</h3>
          <span className="text-sm text-muted-foreground">
            {trades.filter((t) => t.ticker === ticker).length} trades
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-success" />
            <span className="text-muted-foreground">Entry ({buyCount})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[10px] border-l-transparent border-r-transparent border-t-destructive" />
            <span className="text-muted-foreground">Exit ({sellCount})</span>
          </div>
          {indicators.length > 0 && (
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              {indicators.map((ind) => (
                <span
                  key={ind}
                  className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: `${INDICATOR_COLORS[ind] || "#888888"}20`,
                    color: INDICATOR_COLORS[ind] || "#888888",
                  }}
                >
                  {ind}
                </span>
              ))}
            </div>
          )}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className="p-2 rounded-md hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
};

export default CandlestickChart;
