import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  CandlestickChart as CandlestickIcon,
  LineChart as LineChartIcon,
  Loader2,
  Search,
  TrendingUp,
} from "lucide-react";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import RiskDisclaimer from "@/components/RiskDisclaimer";
import CandlestickChart from "@/components/backtest/CandlestickChart";
import { Input } from "@/components/ui/input";
import { api, ChartDataResponse, OHLCData } from "@/lib/api";
import { useRegistry, availableTimeframesFor } from "@/context/RegistryContext";
import type { ChartType } from "@/hooks/useSettings";

const CHART_TYPES: { value: ChartType; label: string; icon: typeof CandlestickIcon }[] = [
  { value: "candles", label: "Candles", icon: CandlestickIcon },
  { value: "line", label: "Line", icon: LineChartIcon },
  { value: "area", label: "Area", icon: AreaChart },
];

const formatPrice = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Charts = () => {
  const { tickers, timeframes } = useRegistry();
  const tickerSymbols = useMemo(() => Object.keys(tickers), [tickers]);

  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [timeframe, setTimeframe] = useState<string>("1D");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ChartDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick a sensible default ticker once the registry resolves.
  useEffect(() => {
    if (!selectedTicker && tickerSymbols.length > 0) {
      setSelectedTicker(tickerSymbols.includes("AAPL") ? "AAPL" : tickerSymbols[0]);
    }
  }, [tickerSymbols, selectedTicker]);

  const allTimeframes = useMemo(
    () => (Object.keys(timeframes).length ? Object.keys(timeframes) : ["1D", "1h", "4h", "1wk", "1mo"]),
    [timeframes],
  );

  // Timeframes available for the currently selected ticker. A typed ticker that
  // isn't in the registry falls back to all timeframes so it can still be
  // fetched from Yahoo Finance.
  const availableTimeframes = useMemo(() => {
    if (!selectedTicker || !tickers[selectedTicker]) return allTimeframes;
    return availableTimeframesFor([selectedTicker], tickers, timeframes);
  }, [selectedTicker, tickers, timeframes, allTimeframes]);

  // Keep the selected timeframe valid when switching tickers.
  useEffect(() => {
    if (availableTimeframes.length > 0 && !availableTimeframes.includes(timeframe)) {
      setTimeframe(availableTimeframes.includes("1D") ? "1D" : availableTimeframes[0]);
    }
  }, [availableTimeframes, timeframe]);

  // Fetch candles whenever the ticker or timeframe changes.
  useEffect(() => {
    if (!selectedTicker || !availableTimeframes.includes(timeframe)) return;

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.getChartData({ ticker: selectedTicker, timeframe });
        if (!cancelled) setData(response);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chart data");
          setData(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedTicker, timeframe, availableTimeframes]);

  const candles: OHLCData[] = data?.candles ?? [];

  // Last price + period change derived from the loaded series.
  const priceStats = useMemo(() => {
    if (candles.length === 0) return null;
    const last = candles[candles.length - 1];
    const prev = candles.length > 1 ? candles[candles.length - 2] : last;
    const change = last.Close - prev.Close;
    const changePct = prev.Close !== 0 ? (change / prev.Close) * 100 : 0;
    const high = Math.max(...candles.map((c) => c.High));
    const low = Math.min(...candles.map((c) => c.Low));
    return { last: last.Close, change, changePct, high, low };
  }, [candles]);

  const filteredTickers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tickerSymbols;
    return tickerSymbols.filter(
      (symbol) =>
        symbol.toLowerCase().includes(query) ||
        (tickers[symbol]?.name || "").toLowerCase().includes(query)
    );
  }, [tickerSymbols, tickers, search]);

  const isPositive = (priceStats?.change ?? 0) >= 0;

  return (
    <DashboardLayout
      title="Charts"
      metaDescription="Browse live price charts for any tracked ticker across timeframes."
      maxWidth="max-w-[1600px]"
    >
      <PageHeader
        icon={TrendingUp}
        eyebrow="Market viewer"
        title="Charts"
        description="Pick a ticker and timeframe to study price action — candles, line, or area."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Watchlist */}
        <div className="glass-card flex max-h-[760px] flex-col overflow-hidden p-0">
          <div className="border-b border-border/60 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const typed = search.trim().toUpperCase();
                    if (typed) {
                      setSelectedTicker(typed);
                      setSearch("");
                    }
                  }
                }}
                placeholder="Type a ticker (e.g. TSLA, BTC-USD)…"
                className="h-9 border-border bg-secondary/60 pl-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {(() => {
              const typed = search.trim().toUpperCase();
              const showLoadTyped = typed.length > 0 && !tickerSymbols.includes(typed);
              if (!showLoadTyped) return null;
              return (
                <button
                  onClick={() => {
                    setSelectedTicker(typed);
                    setSearch("");
                  }}
                  className="mb-2 flex w-full items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5 text-left transition-all hover:bg-primary/15"
                >
                  <Search className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">Load {typed}</p>
                    <p className="truncate text-xs text-muted-foreground">Fetch from Yahoo Finance</p>
                  </div>
                </button>
              );
            })()}
            {filteredTickers.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {search.trim() ? "Press Enter to load this ticker from Yahoo Finance." : "No tickers match."}
              </p>
            ) : (
              filteredTickers.map((symbol) => {
                const isSelected = symbol === selectedTicker;
                return (
                  <button
                    key={symbol}
                    onClick={() => setSelectedTicker(symbol)}
                    className={`mb-1 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-all ${
                      isSelected
                        ? "border-primary/40 bg-primary/10 shadow-[0_0_16px_-8px_hsl(var(--primary)/0.5)]"
                        : "border-transparent hover:border-border/60 hover:bg-background/50"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">{symbol}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tickers[symbol]?.name || symbol}
                      </p>
                    </div>
                    {isSelected && priceStats && (
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-xs font-medium">{formatPrice(priceStats.last)}</p>
                        <p
                          className={`font-mono text-[11px] ${
                            isPositive ? "text-success" : "text-destructive"
                          }`}
                        >
                          {isPositive ? "+" : ""}
                          {priceStats.changePct.toFixed(2)}%
                        </p>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chart panel */}
        <div className="glass-card flex flex-col gap-4 p-4">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="font-mono text-2xl font-bold">{selectedTicker || "—"}</h2>
              {data?.name && <span className="text-sm text-muted-foreground">{data.name}</span>}
              {priceStats && (
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-lg font-semibold">{formatPrice(priceStats.last)}</span>
                  <span
                    className={`font-mono text-sm ${isPositive ? "text-success" : "text-destructive"}`}
                  >
                    {isPositive ? "+" : ""}
                    {formatPrice(priceStats.change)} ({isPositive ? "+" : ""}
                    {priceStats.changePct.toFixed(2)}%)
                  </span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Timeframe pills */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 p-1">
                {availableTimeframes.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      timeframe === tf
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              {/* Chart type toggle */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 p-1">
                {CHART_TYPES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setChartType(value)}
                    title={label}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      chartType === value
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Day range strip */}
          {priceStats && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                Range High <span className="font-mono text-foreground">{formatPrice(priceStats.high)}</span>
              </span>
              <span>
                Range Low <span className="font-mono text-foreground">{formatPrice(priceStats.low)}</span>
              </span>
              <span>
                Bars <span className="font-mono text-foreground">{candles.length}</span>
              </span>
              <span>
                {timeframes[timeframe] || timeframe}
              </span>
            </div>
          )}

          {/* Chart area */}
          <div className="relative min-h-[460px]">
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/40 backdrop-blur-sm">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}

            {error ? (
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-destructive/40 bg-destructive/5 text-sm text-destructive">
                {error}
              </div>
            ) : !isLoading && candles.length === 0 ? (
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                {selectedTicker ? "No data for this selection." : "Select a ticker to load its chart."}
              </div>
            ) : candles.length > 0 ? (
              <motion.div
                key={`${selectedTicker}-${timeframe}-${chartType}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
              >
                <CandlestickChart
                  data={candles}
                  trades={[]}
                  ticker={selectedTicker}
                  height={500}
                  chartTypeOverride={chartType}
                  showMarkers={false}
                />
              </motion.div>
            ) : (
              <div className="h-[460px]" />
            )}
          </div>
        </div>
      </div>
      <RiskDisclaimer variant="inline" className="pt-2" />
    </DashboardLayout>
  );
};

export default Charts;
