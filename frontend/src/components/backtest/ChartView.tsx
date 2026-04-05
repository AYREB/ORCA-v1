import { useMemo, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BacktestResult, OHLCData, TradeEntry } from "@/lib/api";
import CandlestickChart from "./CandlestickChart";
import ReplayControls from "./ReplayControls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { X, Maximize2, TrendingUp, TrendingDown, Play } from "lucide-react";

// ===== TYPES =====
interface ChartContentProps {
  // Data
  tickers: string[];
  selectedTicker: string;
  availableTimeframes: string[];
  selectedTimeframe: string;
  selectedData: OHLCData[];
  tickerTrades: TradeEntry[];
  availableDataIndicators: string[];
  
  // Settings
  showMarkers: boolean;
  showTPSL: boolean;
  enabledIndicators: string[];
  useCustomTPSL: boolean;
  customTPPercent: number;
  customSLPercent: number;
  dslTPSL: { tp: number; sl: number };
  rrRatio: string;
  
  // Replay state
  isReplaying: boolean;
  isPaused: boolean;
  replaySpeed: number;
  displayIndex: number;
  replayProgress: number;
  currentReplayDate: string;
  seekIndex: number | undefined;
  
  // Trade counts
  buyCount: number;
  sellCount: number;
  
  // Handlers
  onTickerChange: (ticker: string) => void;
  onTimeframeChange: (tf: string) => void;
  onToggleMarkers: (v: boolean) => void;
  onToggleTPSL: (v: boolean) => void;
  onToggleIndicator: (key: string) => void;
  onToggleCustomTPSL: (use: boolean) => void;
  onCustomTPChange: (v: number) => void;
  onCustomSLChange: (v: number) => void;
  onToggleReplay: () => void;
  onPlayPause: () => void;
  onReplayReset: () => void;
  onReplayProgressChange: (progress: number) => void;
  onReplaySpeedChange: (speed: number) => void;
  onReplayTick: (index: number, total: number) => void;
  onReplayEnd: () => void;
  
  // Fullscreen
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const FAKE_INDICATORS = [
  { key: "SMA_14", label: "SMA 14", color: "#f59e0b" },
  { key: "SMA_50", label: "SMA 50", color: "#fb923c" },
  { key: "EMA_12", label: "EMA 12", color: "#8b5cf6" },
  { key: "EMA_26", label: "EMA 26", color: "#a78bfa" },
];

// ===== ChartContent - MODULE-SCOPE COMPONENT =====
// Defined OUTSIDE of ChartView to maintain stable React identity across renders
const ChartContent = ({
  tickers,
  selectedTicker,
  availableTimeframes,
  selectedTimeframe,
  selectedData,
  tickerTrades,
  availableDataIndicators,
  showMarkers,
  showTPSL,
  enabledIndicators,
  useCustomTPSL,
  customTPPercent,
  customSLPercent,
  dslTPSL,
  rrRatio,
  isReplaying,
  isPaused,
  replaySpeed,
  displayIndex,
  replayProgress,
  currentReplayDate,
  seekIndex,
  buyCount,
  sellCount,
  onTickerChange,
  onTimeframeChange,
  onToggleMarkers,
  onToggleTPSL,
  onToggleIndicator,
  onToggleCustomTPSL,
  onCustomTPChange,
  onCustomSLChange,
  onToggleReplay,
  onPlayPause,
  onReplayReset,
  onReplayProgressChange,
  onReplaySpeedChange,
  onReplayTick,
  onReplayEnd,
  fullscreen = false,
  onToggleFullscreen,
}: ChartContentProps) => (
  <div className={fullscreen ? "h-full flex flex-col" : ""}>
    {/* Controls Bar */}
    <div className={`p-4 rounded-xl border border-border bg-card/80 backdrop-blur-sm ${fullscreen ? "mx-4 mt-4" : "mb-4"}`}>
      <div className="flex flex-wrap items-center gap-4">
        {/* Ticker & Timeframe */}
        <div className="flex items-center gap-3">
          <Select value={selectedTicker} onValueChange={onTickerChange}>
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
            <Select value={selectedTimeframe} onValueChange={onTimeframeChange}>
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
              onClick={() => onToggleIndicator(ind.key)}
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
              onClick={() => onToggleIndicator(ind)}
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
              id={`show-markers-${fullscreen ? 'fs' : 'normal'}`}
              checked={showMarkers}
              onCheckedChange={onToggleMarkers}
              className="scale-90"
            />
            <Label htmlFor={`show-markers-${fullscreen ? 'fs' : 'normal'}`} className="text-xs cursor-pointer text-muted-foreground">
              Markers
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id={`show-tpsl-${fullscreen ? 'fs' : 'normal'}`}
              checked={showTPSL}
              onCheckedChange={onToggleTPSL}
              className="scale-90"
            />
            <Label htmlFor={`show-tpsl-${fullscreen ? 'fs' : 'normal'}`} className="text-xs cursor-pointer text-muted-foreground">
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
                  onClick={() => onToggleCustomTPSL(false)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    !useCustomTPSL
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Actual
                </button>
                <button
                  onClick={() => onToggleCustomTPSL(true)}
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
                    onToggleCustomTPSL(true);
                    onCustomTPChange(v[0]);
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
                    onToggleCustomTPSL(true);
                    onCustomSLChange(v[0]);
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

        {/* Replay Button */}
        <button
          onClick={onToggleReplay}
          disabled={selectedData.length <= 1}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            isReplaying
              ? "bg-primary text-primary-foreground"
              : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary/70"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Play className="w-3 h-3" />
          {isReplaying ? "Exit Replay" : "Replay"}
        </button>

        {/* Fullscreen Button */}
        {!fullscreen && onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="p-2 rounded-md hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>

    {/* Replay Controls Bar - shown when replay mode is active */}
    {isReplaying && (
      <div className={fullscreen ? "mx-4" : ""}>
        <ReplayControls
          isPlaying={!isPaused}
          onPlayPause={onPlayPause}
          onReset={onReplayReset}
          speed={replaySpeed}
          onSpeedChange={onReplaySpeedChange}
          progress={replayProgress}
          onProgressChange={onReplayProgressChange}
          currentDate={currentReplayDate}
          totalCandles={selectedData.length}
          currentIndex={displayIndex}
        />
      </div>
    )}

    {/* Chart - STABLE KEY ensures it only remounts when dataset changes */}
    <div className={fullscreen ? "flex-1 px-4 pb-4" : ""}>
      {selectedData.length > 0 ? (
        <CandlestickChart
          key={`${selectedTicker}::${selectedTimeframe}`}
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
          onToggleFullscreen={fullscreen ? onToggleFullscreen : undefined}
          isReplaying={isReplaying}
          isPaused={isPaused}
          replaySpeed={replaySpeed}
          onReplayTick={onReplayTick}
          onReplayEnd={onReplayEnd}
          seekToIndex={isPaused ? seekIndex : undefined}
        />
      ) : (
        <div className="flex items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-[#0a0a0a]">
          <p className="text-muted-foreground">No chart data available</p>
        </div>
      )}
    </div>
  </div>
);

// ===== ChartView - MAIN COMPONENT =====
interface ChartViewProps {
  results: BacktestResult;
}

const ChartView = ({ results }: ChartViewProps) => {
  const tickers = useMemo(() => Object.keys(results.data), [results.data]);
  const [selectedTicker, setSelectedTicker] = useState(tickers[0] || "");
  const [selectedTimeframe, setSelectedTimeframe] = useState("");
  const [showMarkers, setShowMarkers] = useState(true);
  const [showTPSL, setShowTPSL] = useState(false);
  const [enabledIndicators, setEnabledIndicators] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Replay mode state
  const [isReplaying, setIsReplaying] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [replaySpeed, setReplaySpeed] = useState(5);
  
  // UI display state - throttled updates from chart (10fps during playback)
  const [displayIndex, setDisplayIndex] = useState(0);
  // Seek state - for slider scrub
  const [seekIndex, setSeekIndex] = useState<number | undefined>(undefined);

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

  const toggleIndicator = useCallback((key: string) => {
    setEnabledIndicators((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

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

  // Reset replay when ticker or timeframe changes
  useEffect(() => {
    setDisplayIndex(0);
    setSeekIndex(undefined);
    setIsPaused(true);
    setIsReplaying(false);
  }, [selectedTicker, selectedTimeframe]);

  // Replay callbacks from CandlestickChart
  const handleReplayTick = useCallback((index: number, _total: number) => {
    setDisplayIndex(index);
  }, []);

  const handleReplayEnd = useCallback(() => {
    setIsPaused(true);
  }, []);

  // Replay control handlers
  const handleToggleReplay = useCallback(() => {
    if (!isReplaying) {
      setIsReplaying(true);
      setDisplayIndex(0);
      setSeekIndex(undefined);
      setIsPaused(false);
    } else {
      setIsReplaying(false);
      setIsPaused(true);
      setDisplayIndex(0);
      setSeekIndex(undefined);
    }
  }, [isReplaying]);

  const handlePlayPause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const handleReplayReset = useCallback(() => {
    setSeekIndex(0);
    setDisplayIndex(0);
    setIsPaused(true);
  }, []);

  const handleReplayProgressChange = useCallback(
    (progress: number) => {
      const newIndex = Math.floor((progress / 100) * (selectedData.length - 1));
      const clampedIndex = Math.max(0, Math.min(newIndex, selectedData.length - 1));
      setSeekIndex(clampedIndex);
      setDisplayIndex(clampedIndex);
    },
    [selectedData.length]
  );

  const replayProgress = useMemo(() => {
    if (selectedData.length <= 1) return 0;
    return (displayIndex / (selectedData.length - 1)) * 100;
  }, [displayIndex, selectedData.length]);

  const currentReplayDate = useMemo(() => {
    if (selectedData.length === 0 || displayIndex >= selectedData.length) return "";
    const datetime = selectedData[displayIndex]?.Datetime || "";
    try {
      const hasTimezone = /[+-]\d{2}:\d{2}$/.test(datetime) || datetime.endsWith('Z');
      
      let d: Date;
      if (datetime.includes(' ')) {
        if (hasTimezone) {
          d = new Date(datetime.replace(' ', 'T'));
        } else {
          d = new Date(datetime.replace(' ', 'T') + 'Z');
        }
      } else {
        d = new Date(datetime);
      }
      
      if (datetime.includes(' ') || (datetime.includes('T') && datetime.length > 10)) {
        return d.toLocaleString("en-US", { 
          month: "short", 
          day: "numeric", 
          hour: "2-digit", 
          minute: "2-digit",
          timeZone: "UTC"
        });
      }
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
    } catch {
      return datetime.slice(0, 16);
    }
  }, [selectedData, displayIndex]);

  const buyCount = tickerTrades.filter((t) => t.type === "BUY").length;
  const sellCount = tickerTrades.filter((t) => t.type === "SELL").length;

  // Shared props for ChartContent
  const chartContentProps: ChartContentProps = {
    tickers,
    selectedTicker,
    availableTimeframes,
    selectedTimeframe,
    selectedData,
    tickerTrades,
    availableDataIndicators,
    showMarkers,
    showTPSL,
    enabledIndicators,
    useCustomTPSL,
    customTPPercent,
    customSLPercent,
    dslTPSL,
    rrRatio,
    isReplaying,
    isPaused,
    replaySpeed,
    displayIndex,
    replayProgress,
    currentReplayDate,
    seekIndex,
    buyCount,
    sellCount,
    onTickerChange: setSelectedTicker,
    onTimeframeChange: setSelectedTimeframe,
    onToggleMarkers: setShowMarkers,
    onToggleTPSL: setShowTPSL,
    onToggleIndicator: toggleIndicator,
    onToggleCustomTPSL: setUseCustomTPSL,
    onCustomTPChange: setCustomTPPercent,
    onCustomSLChange: setCustomSLPercent,
    onToggleReplay: handleToggleReplay,
    onPlayPause: handlePlayPause,
    onReplayReset: handleReplayReset,
    onReplayProgressChange: handleReplayProgressChange,
    onReplaySpeedChange: setReplaySpeed,
    onReplayTick: handleReplayTick,
    onReplayEnd: handleReplayEnd,
  };

  return (
    <>
      <div className="animate-chart-enter">
        <ChartContent
          {...chartContentProps}
          fullscreen={false}
          onToggleFullscreen={() => setIsFullscreen(true)}
        />
      </div>

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

            <ChartContent
              {...chartContentProps}
              fullscreen={true}
              onToggleFullscreen={() => setIsFullscreen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ChartView;
