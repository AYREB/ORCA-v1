import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  FlaskConical,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, DashboardSummary } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type RangeKey = "all" | "90d" | "30d" | "7d";
type CurvePoint = {
  timestamp: number;
  equity: number;
  xLabel: string;
  fullLabel: string;
};

const RANGE_CONFIG: Record<RangeKey, { label: string; days: number | null }> = {
  all: { label: "All", days: null },
  "90d": { label: "90D", days: 90 },
  "30d": { label: "30D", days: 30 },
  "7d": { label: "7D", days: 7 },
};

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const normalizeCurve = (points: Array<{ timestamp: string; equity: number }>): CurvePoint[] => {
  const parsed = points
    .map((point) => {
      const timestamp = new Date(point.timestamp).getTime();
      return {
        timestamp,
        equity: Number(point.equity),
      };
    })
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.equity))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Keep only the latest value for duplicate timestamps.
  const deduped = new Map<number, number>();
  for (const point of parsed) {
    deduped.set(point.timestamp, point.equity);
  }

  return Array.from(deduped.entries())
    .map(([timestamp, equity]) => {
      const date = new Date(timestamp);
      return {
        timestamp,
        equity,
        xLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        fullLabel: date.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
};

const downsampleSeries = <T,>(series: T[], maxPoints: number): T[] => {
  if (series.length <= maxPoints) return series;
  const stride = Math.ceil(series.length / maxPoints);
  const reduced = series.filter((_, index) => index % stride === 0);
  const last = series[series.length - 1];
  if (reduced[reduced.length - 1] !== last) reduced.push(last);
  return reduced;
};

const getSeriesDrawdown = (series: CurvePoint[]): number => {
  if (series.length === 0) return 0;
  let peak = series[0].equity;
  let maxDrawdown = 0;
  for (const point of series) {
    peak = Math.max(peak, point.equity);
    if (peak <= 0) continue;
    const drawdown = ((point.equity - peak) / peak) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  return maxDrawdown;
};

const Dashboard = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadSummary = async () => {
      if (!user) {
        setSummary(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const data = await api.getDashboardSummary();
        setSummary(data);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load dashboard data";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    loadSummary();
  }, [user]);

  const normalizedCurve = useMemo(() => normalizeCurve(summary?.equityCurve ?? []), [summary?.equityCurve]);

  const filteredCurve = useMemo(() => {
    const cfg = RANGE_CONFIG[range];
    if (cfg.days === null) return normalizedCurve;
    const now = Date.now();
    const cutoff = now - cfg.days * 24 * 60 * 60 * 1000;
    const inRange = normalizedCurve.filter((point) => point.timestamp >= cutoff);
    if (inRange.length > 0) return inRange;
    return normalizedCurve.slice(Math.max(0, normalizedCurve.length - 20));
  }, [normalizedCurve, range]);

  const chartSeries = useMemo(() => downsampleSeries(filteredCurve, 140), [filteredCurve]);

  const seriesStats = useMemo(() => {
    if (filteredCurve.length === 0) {
      return {
        start: 0,
        end: 0,
        periodReturnPct: 0,
        maxDrawdownPct: 0,
      };
    }
    const start = filteredCurve[0].equity;
    const end = filteredCurve[filteredCurve.length - 1].equity;
    const periodReturnPct = start > 0 ? ((end - start) / start) * 100 : 0;
    const maxDrawdownPct = getSeriesDrawdown(filteredCurve);
    return {
      start,
      end,
      periodReturnPct,
      maxDrawdownPct,
    };
  }, [filteredCurve]);

  const recentBacktests = summary?.recentBacktests ?? [];

  const bestBacktest = useMemo(() => {
    if (recentBacktests.length === 0) return null;
    return recentBacktests.reduce((best, item) =>
      item.pct_change > best.pct_change ? item : best
    );
  }, [recentBacktests]);

  const worstBacktest = useMemo(() => {
    if (recentBacktests.length === 0) return null;
    return recentBacktests.reduce((worst, item) =>
      item.pct_change < worst.pct_change ? item : worst
    );
  }, [recentBacktests]);

  const metricCards = [
    {
      label: "Average Return",
      value: isLoading ? "—" : formatPercent(summary?.totalReturnPct ?? 0),
      icon: TrendingUp,
      accent: "text-success",
    },
    {
      label: "Win Rate",
      value: isLoading ? "—" : formatPercent(summary?.winRate ?? 0),
      icon: Target,
      accent: "text-primary",
    },
    {
      label: "Backtests Run",
      value: isLoading ? "—" : `${summary?.backtestRunCount ?? 0}`,
      icon: BarChart3,
      accent: "text-foreground",
    },
    {
      label: "Saved Strategies",
      value: isLoading ? "—" : `${summary?.strategyCount ?? 0}`,
      icon: Wallet,
      accent: "text-accent",
    },
  ];

  return (
    <>
      <Helmet>
        <title>Dashboard - Orca</title>
        <meta name="description" content="Performance dashboard with account equity, run metrics, and strategy activity." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed((previous) => !previous)}
        />

        <main className={`transition-all duration-300 ${isSidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="max-w-[1500px] mx-auto p-6 space-y-6">
            <motion.section
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-card/95 to-card p-6"
            >
              <div className="absolute -right-24 -top-24 h-52 w-52 rounded-full bg-primary/15 blur-3xl" />
              <div className="absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-accent/10 blur-3xl" />
              <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary/90">
                    <Sparkles className="h-3.5 w-3.5" />
                    Trading command center
                  </div>
                  <h1 className="text-3xl font-semibold">Dashboard</h1>
                  <p className="text-sm text-muted-foreground">
                    Track portfolio movement, validate edge, and keep your strategy runs in one place.
                  </p>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => navigate("/dashboard/strategies")}>
                    Manage Strategies
                  </Button>
                  <Button variant="hero" onClick={() => navigate("/dashboard/backtest")}>
                    <FlaskConical className="h-4 w-4" />
                    New Backtest
                  </Button>
                </div>
              </div>
            </motion.section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((card, index) => (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06, duration: 0.28 }}
                  className="rounded-xl border border-border bg-card/70 p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
                    <card.icon className={`h-4 w-4 ${card.accent}`} />
                  </div>
                  <p className={`text-2xl font-semibold font-mono ${card.accent}`}>{card.value}</p>
                </motion.div>
              ))}
            </section>

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Card className="border-border bg-card/70">
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-lg">Equity Curve</CardTitle>
                      <CardDescription>
                        Stable run-level equity history with range filtering and drawdown context.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 p-1">
                      {(Object.keys(RANGE_CONFIG) as RangeKey[]).map((key) => (
                        <button
                          key={key}
                          onClick={() => setRange(key)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            range === key
                              ? "bg-primary/20 text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {RANGE_CONFIG[key].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-border bg-background/60 p-3">
                      <p className="text-xs text-muted-foreground">Start Equity</p>
                      <p className="font-mono text-sm font-semibold">{formatCurrency(seriesStats.start)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/60 p-3">
                      <p className="text-xs text-muted-foreground">End Equity</p>
                      <p className="font-mono text-sm font-semibold">{formatCurrency(seriesStats.end)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/60 p-3">
                      <p className="text-xs text-muted-foreground">Range Return / Max DD</p>
                      <p className="font-mono text-sm font-semibold">
                        <span className={seriesStats.periodReturnPct >= 0 ? "text-success" : "text-destructive"}>
                          {formatPercent(seriesStats.periodReturnPct)}
                        </span>
                        {" / "}
                        <span className="text-destructive">{formatPercent(seriesStats.maxDrawdownPct)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="h-[360px] rounded-xl border border-border bg-background/50 p-3">
                    {isLoading ? (
                      <div className="h-full w-full animate-pulse rounded-lg bg-secondary/40" />
                    ) : chartSeries.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Run a backtest to build your equity history.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartSeries} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="dashboardEquityFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="xLabel"
                            stroke="hsl(var(--muted-foreground))"
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                            minTickGap={24}
                          />
                          <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                            tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
                            width={88}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "10px",
                            }}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                            formatter={(value: number) => [formatCurrency(value), "Equity"]}
                          />
                          <Area
                            type="monotone"
                            dataKey="equity"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2.5}
                            fill="url(#dashboardEquityFill)"
                            dot={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border bg-card/70">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Recent Backtests</CardTitle>
                  <CardDescription>
                    Latest runs with return, win-rate, and final balance snapshot.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index} className="h-16 animate-pulse rounded-lg bg-secondary/35" />
                      ))}
                    </div>
                  ) : recentBacktests.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                      No runs yet. Launch a backtest to populate this feed.
                    </div>
                  ) : (
                    <>
                      {recentBacktests.map((backtest) => {
                        const positive = backtest.pct_change >= 0;
                        return (
                          <button
                            key={backtest.id}
                            className="w-full rounded-lg border border-border bg-background/50 p-3 text-left transition-colors hover:bg-background/80"
                            onClick={() => navigate("/dashboard/backtest")}
                          >
                            <div className="mb-2 flex items-start justify-between gap-3">
                              <p className="line-clamp-1 text-sm font-semibold">{backtest.strategy_name || "Backtest"}</p>
                              <Badge
                                variant="outline"
                                className={
                                  positive
                                    ? "border-success/40 bg-success/10 text-success"
                                    : "border-destructive/40 bg-destructive/10 text-destructive"
                                }
                              >
                                {formatPercent(backtest.pct_change ?? 0)}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                              <p>Win Rate: {(backtest.win_rate ?? 0).toFixed(1)}%</p>
                              <p>Trades: {backtest.trades ?? 0}</p>
                              <p className="col-span-2">
                                Final Balance: {formatCurrency(backtest.final_balance ?? 0)}
                              </p>
                              <p className="col-span-2">
                                {backtest.created_at
                                  ? new Date(backtest.created_at).toLocaleString()
                                  : "Unknown run time"}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}

                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background/60 p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5 text-success" />
                        Best Recent Run
                      </div>
                      <p className="line-clamp-1 text-sm font-medium">{bestBacktest?.strategy_name ?? "—"}</p>
                      <p className="font-mono text-sm text-success">
                        {bestBacktest ? formatPercent(bestBacktest.pct_change ?? 0) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/60 p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                        Weakest Recent Run
                      </div>
                      <p className="line-clamp-1 text-sm font-medium">{worstBacktest?.strategy_name ?? "—"}</p>
                      <p className="font-mono text-sm text-destructive">
                        {worstBacktest ? formatPercent(worstBacktest.pct_change ?? 0) : "—"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {!isLoading && summary && summary.backtestRunCount > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="rounded-xl border border-border bg-card/70 p-4"
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="h-4 w-4" />
                  <span>
                    {summary.backtestRunCount} total runs tracked. Continue testing to strengthen curve quality and
                    confidence intervals.
                  </span>
                </div>
              </motion.section>
            )}
          </div>
        </main>
      </div>
    </>
  );
};

export default Dashboard;
