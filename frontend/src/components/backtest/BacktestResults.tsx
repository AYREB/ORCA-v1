import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  Wallet,
  Percent,
  Scale,
  CheckCircle,
  XCircle,
  ArrowLeftRight,
  FolderOpen,
  Filter,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { BacktestResult } from "@/lib/api";
import { detectDirection, isEntryTrade, isExitTrade, buildDailyEquityCurve } from "@/lib/tradeUtils";
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";
import TradesTable from "./TradesTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BacktestResultsProps {
  results: BacktestResult;
}

const BacktestResults = ({ results }: BacktestResultsProps) => {
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;
  const [selectedTicker, setSelectedTicker] = useState<string>("all");

  const equitySeries = useMemo(() => {
    if (results.trades.length === 0) return null;
    const startEquity = results.total_portfolio / (1 + results.pct_change / 100);
    const points = buildDailyEquityCurve(results.trades, startEquity);
    return { points, startEquity };
  }, [results.trades, results.total_portfolio, results.pct_change]);

  // Extract unique tickers
  const availableTickers = useMemo(() => {
    return [...new Set(results.trades.map(t => t.ticker))];
  }, [results.trades]);

  // Filter trades by selected ticker
  const filteredTrades = useMemo(() => {
    if (selectedTicker === "all") return results.trades;
    return results.trades.filter(t => t.ticker === selectedTicker);
  }, [results.trades, selectedTicker]);

  // Calculate detailed win/loss analytics
  const detailedMetrics = useMemo(() => {
    const completedTrades: { entryPrice: number; exitPrice: number; shares: number; direction: "long" | "short" }[] = [];
    const openPositions: Map<string, { price: number; shares: number }[]> = new Map();
    const directions = detectDirection(filteredTrades);
    
    let entries = 0;
    let exits = 0;

    for (const trade of filteredTrades) {
      const dir = directions.get(trade.ticker) || "long";
      if (isEntryTrade(trade, dir)) {
        entries++;
        const positions = openPositions.get(trade.ticker) || [];
        positions.push({ price: trade.price, shares: trade.shares });
        openPositions.set(trade.ticker, positions);
      } else if (isExitTrade(trade, dir)) {
        exits++;
        const positions = openPositions.get(trade.ticker) || [];
        if (positions.length > 0) {
          const entry = positions.shift()!;
          completedTrades.push({
            entryPrice: entry.price,
            exitPrice: trade.price,
            shares: Math.min(entry.shares, trade.shares),
            direction: dir,
          });
          openPositions.set(trade.ticker, positions);
        }
      }
    }

    // Count remaining open positions
    let openCount = 0;
    openPositions.forEach(positions => {
      openCount += positions.length;
    });

    const wins = completedTrades.filter(t => 
      t.direction === "long" ? t.exitPrice > t.entryPrice : t.exitPrice < t.entryPrice
    );
    const losses = completedTrades.filter(t => 
      t.direction === "long" ? t.exitPrice <= t.entryPrice : t.exitPrice >= t.entryPrice
    );

    const winRate = completedTrades.length > 0 
      ? (wins.length / completedTrades.length) * 100 
      : 0;

    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100, 0) / wins.length
      : 0;

    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100, 0) / losses.length
      : 0;

    const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0;

    return {
      completedTrades: completedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      entries,
      exits,
      openPositions: openCount,
    };
  }, [filteredTrades]);

  const metrics = useMemo(() => {
    return [
      // Row 1: Portfolio Overview (Global)
      {
        icon: Wallet,
        label: "Total Portfolio",
        value: `$${results.total_portfolio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        color: "text-primary",
      },
      {
        icon: TrendingUp,
        label: "Total Return",
        value: `${results.pct_change >= 0 ? "+" : ""}${results.pct_change.toFixed(2)}%`,
        color: results.pct_change >= 0 ? "text-success" : "text-destructive",
      },
      {
        icon: DollarSign,
        label: "Final Cash",
        value: `$${results.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        color: "text-foreground",
      },
      {
        icon: BarChart3,
        label: "Invested",
        value: `$${results.invested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        color: "text-accent",
      },
      // Row 2: Trade Analytics (Filtered)
      {
        icon: CheckCircle,
        label: "Completed Trades",
        value: detailedMetrics.completedTrades.toString(),
        color: "text-foreground",
      },
      {
        icon: Percent,
        label: "Win Rate",
        value: `${detailedMetrics.winRate.toFixed(1)}%`,
        color: detailedMetrics.winRate >= 50 ? "text-success" : "text-destructive",
      },
      {
        icon: TrendingUp,
        label: "Avg Win",
        value: `+${detailedMetrics.avgWin.toFixed(2)}%`,
        color: "text-success",
      },
      {
        icon: TrendingDown,
        label: "Avg Loss",
        value: `${detailedMetrics.avgLoss.toFixed(2)}%`,
        color: "text-destructive",
      },
      // Row 3: Details (Filtered)
      {
        icon: Scale,
        label: "Profit Factor",
        value: detailedMetrics.profitFactor > 0 ? `${detailedMetrics.profitFactor.toFixed(2)}x` : "N/A",
        color: detailedMetrics.profitFactor >= 1 ? "text-success" : "text-destructive",
      },
      {
        icon: XCircle,
        label: "Wins / Losses",
        value: `${detailedMetrics.wins} / ${detailedMetrics.losses}`,
        color: "text-muted-foreground",
      },
      {
        icon: ArrowLeftRight,
        label: "Entries / Exits",
        value: `${detailedMetrics.entries} / ${detailedMetrics.exits}`,
        color: "text-muted-foreground",
      },
      {
        icon: FolderOpen,
        label: "Open Positions",
        value: detailedMetrics.openPositions.toString(),
        color: detailedMetrics.openPositions > 0 ? "text-warning" : "text-muted-foreground",
      },
    ];
  }, [results, detailedMetrics]);

  const positiveRun = results.pct_change >= 0;
  const runColor = positiveRun
    ? safeColor(chartColors.candleUp, "#22c55e")
    : safeColor(chartColors.candleDown, "#ef4444");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="space-y-6"
    >
      {/* Equity curve — chart left, key stats right */}
      {equitySeries && equitySeries.points.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row">
            {/* Chart */}
            <div className="flex-1 min-w-0 p-4 pb-3">
              <p className="text-sm font-semibold mb-3">Equity Curve</p>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={equitySeries.points}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="numEquityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={runColor} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={runColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={colorWithAlpha(chartColors.grid, 0.35, "hsl(var(--border))")}
                    />
                    <XAxis
                      dataKey="label"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      minTickGap={30}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                      width={80}
                    />
                    <ReferenceLine
                      y={equitySeries.startEquity}
                      strokeDasharray="4 4"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1}
                      label={{
                        value: "Start",
                        position: "insideTopLeft",
                        fontSize: 10,
                        fill: "hsl(var(--muted-foreground))",
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [
                        `$${v.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`,
                        "Portfolio",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="portfolio"
                      stroke={runColor}
                      strokeWidth={2}
                      fill="url(#numEquityFill)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Stats sidebar */}
            <div className="sm:w-[180px] shrink-0 border-t sm:border-t-0 sm:border-l border-border/50 p-4 flex flex-col justify-center gap-4">
              {[
                {
                  label: "Starting",
                  value: `$${equitySeries.startEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                  color: "",
                },
                {
                  label: "Final",
                  value: `$${results.total_portfolio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  color: "",
                },
                {
                  label: "Return",
                  value: `${positiveRun ? "+" : ""}${results.pct_change.toFixed(2)}%`,
                  color: positiveRun ? "text-success" : "text-destructive",
                },
                {
                  label: "Completed trades",
                  value: detailedMetrics.completedTrades.toString(),
                  color: "",
                },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground mb-0.5">{s.label}</p>
                  <p className={`font-mono font-semibold text-sm ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Ticker Filter */}
      {availableTickers.length > 1 && (
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter by ticker:</span>
          <Select value={selectedTicker} onValueChange={setSelectedTicker}>
            <SelectTrigger className="w-[140px] bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tickers</SelectItem>
              {availableTickers.map(ticker => (
                <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Metrics Grid - 4 columns, 3 rows */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.3 + index * 0.03 }}
            className="p-3 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <metric.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{metric.label}</span>
            </div>
            <p className={`text-lg font-bold font-mono ${metric.color}`}>{metric.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Trades Table */}
      <TradesTable trades={filteredTrades} />
    </motion.div>
  );
};

export default BacktestResults;
