import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingDown,
  Shield,
  BarChart3,
  Activity,
  AlertTriangle,
  TrendingUp,
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
import { BacktestResult, TradeEntry } from "@/lib/api";
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";
import { detectDirection, isEntryTrade, isExitTrade, buildDailyEquityCurve } from "@/lib/tradeUtils";

function computeMetrics(trades: TradeEntry[], results: BacktestResult) {
  const startEquity = results.total_portfolio / (1 + results.pct_change / 100);
  const equityCurve = buildDailyEquityCurve(trades, startEquity);

  const maxDrawdownPct =
    equityCurve.length > 0
      ? Math.min(0, ...equityCurve.map((p) => p.drawdown))
      : 0;

  let maxDuration = 0;
  let dur = 0;
  for (const p of equityCurve) {
    if (p.drawdown < -0.001) {
      dur++;
      maxDuration = Math.max(maxDuration, dur);
    } else {
      dur = 0;
    }
  }

  // Round-trip returns for Sharpe / Sortino / VaR
  const directions = detectDirection(trades);
  const openPositions = new Map<string, { price: number; shares: number }[]>();
  const tradeReturns: number[] = [];

  for (const trade of trades) {
    const dir = directions.get(trade.ticker) ?? "long";
    if (isEntryTrade(trade, dir)) {
      const positions = openPositions.get(trade.ticker) ?? [];
      positions.push({ price: trade.price, shares: trade.shares });
      openPositions.set(trade.ticker, positions);
    } else if (isExitTrade(trade, dir)) {
      const positions = openPositions.get(trade.ticker) ?? [];
      if (positions.length > 0) {
        const entry = positions.shift()!;
        const r =
          dir === "long"
            ? (trade.price - entry.price) / entry.price
            : (entry.price - trade.price) / entry.price;
        tradeReturns.push(r);
        openPositions.set(trade.ticker, positions);
      }
    }
  }

  const n = tradeReturns.length;
  const mean = n > 0 ? tradeReturns.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 1 ? tradeReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? mean / std : null;

  const downsideMeanSq =
    n > 0
      ? tradeReturns.filter((r) => r < 0).reduce((a, r) => a + r * r, 0) / n
      : 0;
  const downsideStd = Math.sqrt(downsideMeanSq);
  const sortino = downsideStd > 0 ? mean / downsideStd : null;

  const totalReturnFrac = results.pct_change / 100;
  const calmar =
    maxDrawdownPct < -0.001 ? totalReturnFrac / Math.abs(maxDrawdownPct / 100) : null;

  const sorted5 = [...tradeReturns].sort((a, b) => a - b);
  const varIdx = Math.max(0, Math.floor(sorted5.length * 0.05) - 1);
  const var95 = sorted5.length > 0 ? sorted5[varIdx] : null;

  return {
    equityCurve,
    startEquity,
    maxDrawdownPct,
    maxDuration,
    sharpe,
    sortino,
    calmar,
    var95,
    completedTrades: n,
  };
}

const GarchAnalysis = ({ results }: RiskAnalysisProps) => {
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;

  const m = useMemo(() => computeMetrics(results.trades, results), [results]);

  const noTrades = results.trades.length === 0;
  const tooFewTrades = m.completedTrades < 2;

  const fmtRatio = (v: number | null) => (v === null ? "—" : v.toFixed(3));
  const fmtPct = (v: number) =>
    `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  const tiles = [
    {
      icon: Activity,
      label: "Sharpe Ratio",
      value: fmtRatio(m.sharpe),
      sub: "Per-trade risk-adjusted return",
      color:
        m.sharpe === null
          ? "text-foreground"
          : m.sharpe > 0
          ? "text-success"
          : "text-destructive",
    },
    {
      icon: Shield,
      label: "Sortino Ratio",
      value: fmtRatio(m.sortino),
      sub: "Downside deviation adjusted",
      color:
        m.sortino === null
          ? "text-foreground"
          : m.sortino > 0
          ? "text-success"
          : "text-destructive",
    },
    {
      icon: BarChart3,
      label: "Calmar Ratio",
      value: fmtRatio(m.calmar),
      sub: "Return ÷ max drawdown",
      color:
        m.calmar === null
          ? "text-foreground"
          : m.calmar > 1
          ? "text-success"
          : m.calmar < 0
          ? "text-destructive"
          : "text-foreground",
    },
    {
      icon: TrendingDown,
      label: "Max Drawdown",
      value: `${m.maxDrawdownPct.toFixed(2)}%`,
      sub: `Peak duration: ${m.maxDuration} trade${m.maxDuration !== 1 ? "s" : ""}`,
      color:
        m.maxDrawdownPct > -5
          ? "text-success"
          : m.maxDrawdownPct < -20
          ? "text-destructive"
          : "text-foreground",
    },
    {
      icon: AlertTriangle,
      label: "VaR (95%)",
      value: m.var95 === null ? "—" : fmtPct(m.var95 * 100),
      sub: "Worst 5% of trade outcomes",
      color:
        m.var95 === null
          ? "text-foreground"
          : m.var95 < -0.05
          ? "text-destructive"
          : "text-foreground",
    },
    {
      icon: TrendingUp,
      label: "Total Return",
      value: fmtPct(results.pct_change),
      sub: `Starting equity $${m.startEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      color: results.pct_change >= 0 ? "text-success" : "text-destructive",
    },
  ];

  const positiveRun = results.pct_change >= 0;
  const runColor = positiveRun
    ? safeColor(chartColors.candleUp, "#22c55e")
    : safeColor(chartColors.candleDown, "#ef4444");
  const ddColor = safeColor(chartColors.candleDown, "#ef4444");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Risk Analysis</h3>
          <p className="text-sm text-muted-foreground">
            {noTrades
              ? "No trades to analyse"
              : `Computed from ${m.completedTrades} completed round-trip trade${m.completedTrades !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {noTrades ? (
        <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-xl">
          Run a backtest with at least one completed round-trip trade to see risk metrics.
        </div>
      ) : (
        <>
          {/* Metric tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {tiles.map((tile, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.05 + i * 0.04 }}
                className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
              >
                <div className="flex items-center gap-2 mb-2">
                  <tile.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{tile.label}</span>
                </div>
                <p className={`text-xl font-bold font-mono ${tile.color}`}>{tile.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{tile.sub}</p>
              </motion.div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Portfolio equity */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
            >
              <h4 className="text-sm font-semibold mb-4">Portfolio Value</h4>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={m.equityCurve}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="riskEquityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={runColor} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={runColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={colorWithAlpha(chartColors.grid, 0.4, "hsl(var(--border))")}
                    />
                    <XAxis
                      dataKey="label"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      minTickGap={28}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                      width={80}
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
                    <ReferenceLine
                      y={m.startEquity}
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
                    <Area
                      type="monotone"
                      dataKey="portfolio"
                      stroke={runColor}
                      strokeWidth={2}
                      fill="url(#riskEquityFill)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Drawdown */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
            >
              <h4 className="text-sm font-semibold mb-1">Drawdown</h4>
              <p className="text-xs text-muted-foreground mb-4">% decline from running peak</p>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={m.equityCurve}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="riskDrawdownFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={ddColor} stopOpacity={0.05} />
                        <stop offset="95%" stopColor={ddColor} stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={colorWithAlpha(chartColors.grid, 0.4, "hsl(var(--border))")}
                    />
                    <XAxis
                      dataKey="label"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      minTickGap={28}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickFormatter={(v) => `${v.toFixed(1)}%`}
                      width={58}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [`${v.toFixed(2)}%`, "Drawdown"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="drawdown"
                      stroke={ddColor}
                      strokeWidth={1.5}
                      fill="url(#riskDrawdownFill)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {tooFewTrades && (
            <p className="text-xs text-muted-foreground text-center border border-dashed border-border rounded-lg p-3">
              Sharpe, Sortino, and Calmar ratios require at least 2 completed round-trip trades to be meaningful.
            </p>
          )}
        </>
      )}
    </motion.div>
  );
};

export default GarchAnalysis;
