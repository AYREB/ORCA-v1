import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BacktestResult } from "@/lib/api";
import CandlestickChart from "./CandlestickChart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { X, Maximize2, TrendingUp, TrendingDown } from "lucide-react";

interface ChartViewProps {
  results: BacktestResult;
}

const FAKE_INDICATORS = [
  { key: "SMA_14", label: "SMA 14", color: "#f59e0b" },
  { key: "SMA_50", label: "SMA 50", color: "#fb923c" },
  { key: "EMA_12", label: "EMA 12", color: "#8b5cf6" },
  { key: "EMA_26", label: "EMA 26", color: "#a78bfa" },
];

const ChartView = ({ results }: ChartViewProps) => {
  const tickers = useMemo(() => Object.keys(results.data), [results.data]);
  const [selectedTicker, setSelectedTicker] = useState(tickers[0] || "");
  const [selectedTimeframe, setSelectedTimeframe] = useState("");
  const [showMarkers, setShowMarkers] = useState(true);
  const [showTPSL, setShowTPSL] = useState(false);
  const [enabledIndicators, setEnabledIndicators] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Extract TP/SL percentages from DSL
  const dslTPSL = useMemo(() => {
    const dsl = results.json_dsl as Record<string, any> | undefined;
    const strategy = dsl?.LONG || dsl?.SHORT;
    const openArgs = strategy?.OPEN?.ARGUMENTS;
    return {
      tp: openArgs?.takeProfitPercent ?? 10,
      sl: openArgs?.stopLossPercent ?? 5,
    };
  }, [results.json_dsl]);

  // Custom TP/SL state
  const [useCustomTPSL, setUseCustomTPSL] = useState(false);
  const [customTPPercent, setCustomTPPercent] = useState(dslTPSL.tp);
  const [customSLPercent, setCustomSLPercent] = useState(dslTPSL.sl);

  // Sync custom values when DSL changes
  useEffect(() => {
    setCustomTPPercent(dslTPSL.tp);
    setCustomSLPercent(dslTPSL.sl);
  }, [dslTPSL.tp, dslTPSL.sl]);

  // Calculate R:R ratio
  const rrRatio = useMemo(() => {
    const tp = useCustomTPSL ? customTPPercent : dslTPSL.tp;
    const sl = useCustomTPSL ? customSLPercent : dslTPSL.sl;
    if (sl === 0) return "∞";
    return (tp / sl).toFixed(2);
  }, [useCustomTPSL, customTPPercent, customSLPercent, dslTPSL]);

  // Get available timeframes for selected ticker
  const availableTimeframes = useMemo(() => {
    if (!selectedTicker || !results.data[selectedTicker]) return [];
    return Object.keys(results.data[selectedTicker]);
  }, [selectedTicker, results.data]);

  // Initialize timeframe when ticker changes
  useEffect(() => {
    if (availableTimeframes.length > 0 && !availableTimeframes.includes(selectedTimeframe)) {
      setSelectedTimeframe(availableTimeframes[0]);
    }
  }, [availableTimeframes, selectedTimeframe]);

  const selectedData = useMemo(() => {
    if (!selectedTicker || !results.data[selectedTicker]) return [];
    const tf = selectedTimeframe || availableTimeframes[0];
    return results.data[selectedTicker][tf] || [];
  }, [selectedTicker, selectedTimeframe, results.data, availableTimeframes]);

  const tickerTrades = useMemo(() => {
    return results.trades.filter((t) => t.ticker === selectedTicker);
  }, [results.trades, selectedTicker]);

  const toggleIndicator = (key: string) => {
    setEnabledIndicators((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // Get available indicator columns from data
  const availableDataIndicators = useMemo(() => {
    if (selectedData.length === 0) return [];
    const firstRow = selectedData[0];
    return Object.keys(firstRow).filter(
      (key) => !["Datetime", "Open", "High", "Low", "Close", "Volume"].includes(key)
    );
  }, [selectedData]);

  // Handle ESC key for fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // Check if any trades have TP/SL defined
  const hasTPSL = useMemo(() => {
    return tickerTrades.some((t) => (t.tp_price && t.tp_price > 0) || (t.sl_price && t.sl_price > 0));
  }, [tickerTrades]);

  const buyCount = tickerTrades.filter((t) => t.type === "BUY" || t.type === "RECURRING_BUY").length;
  const sellCount = tickerTrades.filter((t) => t.type === "SELL").length;

  const ChartContent = ({ fullscreen = false }: { fullscreen?: boolean }) => (
    <div className={fullscreen ? "h-full flex flex-col" : ""}>
      {/* Controls Bar */}
      <div className={`p-4 rounded-xl border border-border bg-card/80 backdrop-blur-sm ${fullscreen ? "mx-4 mt-4" : "mb-4"}`}>
        <div className="flex flex-wrap items-center gap-4">
          {/* Ticker & Timeframe */}
          <div className="flex items-center gap-3">
            <Select value={selectedTicker} onValueChange={setSelectedTicker}>
              <SelectTrigger className="w-28 h-9 bg-secondary/50 border-border font-mono font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tickers.map((ticker) => (
                  <SelectItem key={ticker} value={ticker} className="font-mono">
                    {ticker}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {availableTimeframes.length > 1 && (
              <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe}>
                <SelectTrigger className="w-20 h-9 bg-secondary/50 border-border font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableTimeframes.map((tf) => (
                    <SelectItem key={tf} value={tf} className="font-mono">
                      {tf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Indicator Pills */}
          <div className="flex items-center gap-2">
            {FAKE_INDICATORS.map((ind) => (
              <button
                key={ind.key}
                onClick={() => toggleIndicator(ind.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all ${
                  enabledIndicators.includes(ind.key)
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-secondary/30 text-muted-foreground border border-border hover:border-primary/30"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: enabledIndicators.includes(ind.key) ? ind.color : "transparent", border: `1px solid ${ind.color}` }}
                />
                {ind.label}
              </button>
            ))}
            {availableDataIndicators.map((ind) => (
              <button
                key={ind}
                onClick={() => toggleIndicator(ind)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all ${
                  enabledIndicators.includes(ind)
                    ? "bg-accent/20 text-accent border border-accent/40"
                    : "bg-secondary/30 text-muted-foreground border border-border hover:border-accent/30"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-accent" />
                {ind}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Toggles */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="show-markers"
                checked={showMarkers}
                onCheckedChange={setShowMarkers}
                className="scale-90"
              />
              <Label htmlFor="show-markers" className="text-xs cursor-pointer text-muted-foreground">
                Markers
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="show-tpsl"
                checked={showTPSL}
                onCheckedChange={setShowTPSL}
                className="scale-90"
              />
              <Label htmlFor="show-tpsl" className="text-xs cursor-pointer text-muted-foreground">
                TP/SL
              </Label>
            </div>
          </div>

          {/* Custom TP/SL Controls - Show when TP/SL is enabled */}
          {showTPSL && (
            <>
              <div className="w-px h-6 bg-border" />
              <div className="flex items-center gap-4">
                {/* Mode Toggle */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary/30">
                  <button
                    onClick={() => setUseCustomTPSL(false)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      !useCustomTPSL
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Actual
                  </button>
                  <button
                    onClick={() => setUseCustomTPSL(true)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      useCustomTPSL
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {/* TP Slider */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  <span className="text-xs text-success font-mono">TP</span>
                  <Slider
                    value={[useCustomTPSL ? customTPPercent : dslTPSL.tp]}
                    onValueChange={(v) => {
                      setUseCustomTPSL(true);
                      setCustomTPPercent(v[0]);
                    }}
                    min={1}
                    max={50}
                    step={1}
                    className="w-20"
                  />
                  <span className="text-xs font-mono text-muted-foreground w-8">
                    {useCustomTPSL ? customTPPercent : dslTPSL.tp}%
                  </span>
                </div>

                {/* SL Slider */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  <span className="text-xs text-destructive font-mono">SL</span>
                  <Slider
                    value={[useCustomTPSL ? customSLPercent : dslTPSL.sl]}
                    onValueChange={(v) => {
                      setUseCustomTPSL(true);
                      setCustomSLPercent(v[0]);
                    }}
                    min={1}
                    max={50}
                    step={1}
                    className="w-20"
                  />
                  <span className="text-xs font-mono text-muted-foreground w-8">
                    {useCustomTPSL ? customSLPercent : dslTPSL.sl}%
                  </span>
                </div>

                {/* R:R Badge */}
                <Badge variant="outline" className="bg-secondary/30 border-border font-mono text-xs">
                  R:R {rrRatio}:1
                </Badge>
              </div>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Trade Counts */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-success/10 text-success border-success/30 gap-1">
              <TrendingUp className="w-3 h-3" />
              {buyCount}
            </Badge>
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1">
              <TrendingDown className="w-3 h-3" />
              {sellCount}
            </Badge>
          </div>

          {/* Fullscreen Button */}
          {!fullscreen && (
            <button
              onClick={() => setIsFullscreen(true)}
              className="p-2 rounded-md hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className={fullscreen ? "flex-1 px-4 pb-4" : ""}>
        {selectedData.length > 0 ? (
          <CandlestickChart
            data={selectedData}
            trades={tickerTrades}
            ticker={selectedTicker}
            height={fullscreen ? undefined : 500}
            showMarkers={showMarkers}
            showTPSL={showTPSL}
            useCustomTPSL={useCustomTPSL}
            customTPPercent={customTPPercent}
            customSLPercent={customSLPercent}
            indicators={enabledIndicators}
            isFullscreen={fullscreen}
            onToggleFullscreen={fullscreen ? () => setIsFullscreen(false) : undefined}
          />
        ) : (
          <div className="flex items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-[#0a0a0a]">
            <p className="text-muted-foreground">No chart data available</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <ChartContent />
      </motion.div>

      {/* Fullscreen Modal */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#0a0a0a]"
          >
            {/* Close Button */}
            <button
              onClick={() => setIsFullscreen(false)}
              className="absolute top-4 right-4 z-10 p-2 rounded-md bg-secondary/50 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>

            <ChartContent fullscreen />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ChartView;