import { useEffect, useRef, useMemo } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  createSeriesMarkers,
} from "lightweight-charts";
import type { IChartApi, CandlestickData, Time, SeriesMarker, ISeriesApi } from "lightweight-charts";
import { motion } from "framer-motion";
import { OHLCData, TradeEntry } from "@/lib/api";
import { Maximize2, Minimize2 } from "lucide-react";

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
}

const INDICATOR_COLORS: Record<string, string> = {
  SMA: "#f59e0b",
  SMA_14: "#f59e0b",
  SMA_50: "#fb923c",
  EMA: "#8b5cf6",
  EMA_12: "#8b5cf6",
  EMA_26: "#a78bfa",
  RSI: "#ec4899",
  MACD: "#06b6d4",
  BB_upper: "#22c55e",
  BB_middle: "#22c55e",
  BB_lower: "#22c55e",
};

// Normalize datetime to unix seconds to keep full resolution per bar
const toChartTime = (datetime: string): number => Math.floor(new Date(datetime).getTime() / 1000);

// Generate fake SMA data
const generateFakeSMA = (data: OHLCData[], period: number): { time: Time; value: number }[] => {
  const result: { time: Time; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].Close;
    }
    result.push({
      time: toChartTime(data[i].Datetime) as Time,
      value: sum / period,
    });
  }
  return result.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
};

// Generate fake EMA data
const generateFakeEMA = (data: OHLCData[], period: number): { time: Time; value: number }[] => {
  const result: { time: Time; value: number }[] = [];
  const multiplier = 2 / (period + 1);
  let ema = data[0]?.Close || 0;
  
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].Close - ema) * multiplier + ema;
    if (i >= period - 1) {
      result.push({
        time: toChartTime(data[i].Datetime) as Time,
        value: ema,
      });
    }
  }
  return result.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
};

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
}: CandlestickChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Prepare candlestick data
  const chartData = useMemo(() => {
    const normalized = data
      .map((item) => ({
        time: toChartTime(item.Datetime) as Time,
        open: item.Open,
        high: item.High,
        low: item.Low,
        close: item.Close,
      }))
      .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

    return normalized;
  }, [data]);

  // Prepare trade markers
  const tradeMarkers = useMemo((): SeriesMarker<Time>[] => {
    if (!showMarkers) return [];

    const grouped = new Map<
      string,
      {
        time: Time;
        position: SeriesMarker<Time>["position"];
        color: string;
        shape: SeriesMarker<Time>["shape"];
        count: number;
        label: string;
      }
    >();

    trades
      .filter((t) => t.ticker === ticker)
      .forEach((t) => {
        const isBuy = t.type === "BUY" || t.type === "RECURRING_BUY";
        const key = `${t.timestamp}-${isBuy ? "buy" : "sell"}`;
        const time = toChartTime(t.timestamp) as Time;

        let baseLabel: string;
        if (t.type === "RECURRING_BUY") {
          baseLabel = "REC";
        } else if (isBuy) {
          baseLabel = "BUY";
        } else {
          baseLabel = "SELL";
        }

        const existing = grouped.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          grouped.set(key, {
            time,
            position: isBuy ? "belowBar" : "aboveBar",
            color: isBuy ? "#22c55e" : "#ef4444",
            shape: isBuy ? "arrowUp" : "arrowDown",
            count: 1,
            label: baseLabel,
          });
        }
      });

    return Array.from(grouped.values())
      .map((marker) => ({
        time: marker.time,
        position: marker.position,
        color: marker.color,
        shape: marker.shape,
        text: marker.count > 1 ? `${marker.label} x${marker.count}` : marker.label,
        size: 1,
      }) as SeriesMarker<Time>)
      .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
  }, [trades, ticker, showMarkers]);

  // Prepare indicator data (real or fake)
  const indicatorData = useMemo(() => {
    const result: Record<string, { time: Time; value: number }[]> = {};
    
    indicators.forEach((indicator) => {
      // Check if real data exists
        const realData = data
          .filter((item) => item[indicator] !== undefined && item[indicator] !== null)
          .map((item) => ({
            time: toChartTime(item.Datetime) as Time,
            value: Number(item[indicator]),
          }))
          .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

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

  // Get TP/SL boxes from trades (TradingView style)
  const tpslBoxes = useMemo(() => {
    if (!showTPSL) return [];
    
    const boxes: {
      entryPrice: number;
      tpPrice: number | null;
      slPrice: number | null;
      entryTime: string;
      exitTime: string | null;
    }[] = [];
    
    const tickerTrades = trades.filter((t) => t.ticker === ticker);
    const buyTrades = tickerTrades.filter((t) => t.type === "BUY" || t.type === "RECURRING_BUY");
    const sellTrades = tickerTrades.filter((t) => t.type === "SELL");
    
    buyTrades.forEach((buyTrade) => {
      // Find the corresponding sell trade (next sell after this buy)
      const correspondingSell = sellTrades.find(
        (s) => new Date(s.timestamp) > new Date(buyTrade.timestamp)
      );
      
      const entryPrice = buyTrade.price;
      
      // Calculate TP/SL based on mode
      let tpPrice: number | null = null;
      let slPrice: number | null = null;
      
      if (useCustomTPSL) {
        // Custom percentage-based calculation
        tpPrice = entryPrice * (1 + customTPPercent / 100);
        slPrice = entryPrice * (1 - customSLPercent / 100);
      } else {
        // Use actual values from trade
        tpPrice = buyTrade.tp_price && buyTrade.tp_price > 0 ? buyTrade.tp_price : null;
        slPrice = buyTrade.sl_price && buyTrade.sl_price > 0 ? buyTrade.sl_price : null;
      }
      
      // Skip if no TP/SL to show (in actual mode only)
      if (!useCustomTPSL && !tpPrice && !slPrice) return;
      
      boxes.push({
        entryPrice,
        tpPrice,
        slPrice,
        entryTime: buyTrade.timestamp,
        exitTime: correspondingSell?.timestamp || null,
      });
    });
    
    return boxes;
  }, [trades, ticker, showTPSL, useCustomTPSL, customTPPercent, customSLPercent]);

  useEffect(() => {
    if (!chartContainerRef.current || chartData.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "hsl(215, 20%, 55%)",
        fontFamily: "JetBrains Mono, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "hsl(175, 80%, 50%)", labelBackgroundColor: "#1a1a1a" },
        horzLine: { color: "hsl(175, 80%, 50%)", labelBackgroundColor: "#1a1a1a" },
      },
      width: chartContainerRef.current.clientWidth,
      height: isFullscreen ? window.innerHeight - 120 : height,
      timeScale: { borderColor: "rgba(255, 255, 255, 0.1)", timeVisible: true },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.1)" },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    });

    candlestickSeries.setData(chartData as CandlestickData<Time>[]);

    // Add trade markers
    if (tradeMarkers.length > 0) {
      createSeriesMarkers(candlestickSeries, tradeMarkers);
    }

    // Add TP/SL boxes (TradingView style) - only during trade duration
    tpslBoxes.forEach((box) => {
      const entryTime = toChartTime(box.entryTime) as Time;
      const exitTime = box.exitTime ? toChartTime(box.exitTime) as Time : null;
      
      // Filter chart data to only the trade duration
      const tradeData = chartData.filter((d) => {
        const time = d.time as string;
        const isAfterEntry = time >= (entryTime as string);
        const isBeforeExit = exitTime ? time <= (exitTime as string) : true;
        return isAfterEntry && isBeforeExit;
      });
      
      if (tradeData.length === 0) return;
      
      // TP filled box (green zone from entry to TP)
      if (box.tpPrice) {
        // Create filled area from entry price to TP price
        const tpAreaSeries = chart.addSeries(AreaSeries, {
          topColor: "rgba(34, 197, 94, 0.3)",
          bottomColor: "rgba(34, 197, 94, 0.3)",
          lineColor: "rgba(34, 197, 94, 0)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        
        // Draw the TP zone line at TP price level
        const tpZoneData = tradeData.map((d) => ({ 
          time: d.time, 
          value: box.tpPrice! 
        }));
        tpAreaSeries.setData(tpZoneData);
        
        // Add baseline at entry price to create the filled box effect
        tpAreaSeries.applyOptions({
          baseValue: { type: "price", price: box.entryPrice },
        } as any);
      }
      
      // SL filled box (red zone from SL UP to entry - properly clipped)
      if (box.slPrice) {
        const slAreaSeries = chart.addSeries(AreaSeries, {
          topColor: "rgba(239, 68, 68, 0.35)",
          bottomColor: "rgba(239, 68, 68, 0.35)",
          lineColor: "rgba(239, 68, 68, 0)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        
        // Data at SL price (bottom of box) - fill goes UPWARD to baseValue
        const slZoneData = tradeData.map((d) => ({ 
          time: d.time, 
          value: box.slPrice! 
        }));
        slAreaSeries.setData(slZoneData);
        
        // Baseline at ENTRY price - since data is below, fill goes UP to entry
        slAreaSeries.applyOptions({
          baseValue: { type: "price", price: box.entryPrice },
        } as any);
      }
      
      // Entry line (only during trade)
      const entryLineSeries = chart.addSeries(LineSeries, {
        color: "rgba(255, 255, 255, 0.6)",
        lineWidth: 1,
        lineStyle: 2, // Dashed
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      
      const entryLineData = tradeData.map((d) => ({ 
        time: d.time, 
        value: box.entryPrice 
      }));
      entryLineSeries.setData(entryLineData);
    });

    // Add indicator lines
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
        lineSeries.setData(indData);
      }
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: isFullscreen ? window.innerHeight - 120 : height,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [chartData, height, tradeMarkers, indicatorData, tpslBoxes, isFullscreen]);

  const buyCount = trades.filter((t) => t.ticker === ticker && (t.type === "BUY" || t.type === "RECURRING_BUY")).length;
  const sellCount = trades.filter((t) => t.ticker === ticker && t.type === "SELL").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`rounded-xl border border-border overflow-hidden ${isFullscreen ? '' : 'bg-[#0a0a0a]'}`}
      style={{ backgroundColor: '#0a0a0a' }}
    >
      <div className="flex items-center justify-between p-4 border-b border-border/50 bg-[#0f0f0f]">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold font-mono text-foreground">{ticker}</h3>
          <span className="text-sm text-muted-foreground">
            {trades.filter((t) => t.ticker === ticker).length} trades
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-success" />
            <span className="text-muted-foreground">Buy ({buyCount})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[10px] border-l-transparent border-r-transparent border-t-destructive" />
            <span className="text-muted-foreground">Sell ({sellCount})</span>
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
    </motion.div>
  );
};

export default CandlestickChart;
