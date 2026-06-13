import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FlaskConical,
  LayoutDashboard,
  Minus,
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
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import RiskDisclaimer from "@/components/RiskDisclaimer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const fmt$ = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const timeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const normalizeCurve = (points: Array<{ timestamp: string; equity: number }>): CurvePoint[] => {
  const latestByDay = new Map<string, { timestamp: number; equity: number }>();

  for (const point of points) {
    const timestamp = new Date(point.timestamp).getTime();
    const equity = Number(point.equity);
    if (!Number.isFinite(timestamp) || !Number.isFinite(equity)) continue;

    const dayKey = formatLocalDate(new Date(timestamp));
    const existing = latestByDay.get(dayKey);
    if (!existing || timestamp >= existing.timestamp) {
      latestByDay.set(dayKey, { timestamp, equity });
    }
  }

  return Array.from(latestByDay.values())
    .map(({ timestamp, equity }) => {
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
  const reduced = series.filter((_, i) => i % stride === 0);
  const last = series[series.length - 1];
  if (reduced[reduced.length - 1] !== last) reduced.push(last);
  return reduced;
};

const getSeriesDrawdown = (series: CurvePoint[]): number => {
  if (series.length === 0) return 0;
  let peak = series[0].equity;
  let maxDD = 0;
  for (const point of series) {
    peak = Math.max(peak, point.equity);
    if (peak <= 0) continue;
    const dd = ((point.equity - peak) / peak) * 100;
    maxDD = Math.min(maxDD, dd);
  }
  return maxDD;
};

const ReturnIndicator = ({ value }: { value: number }) => {
  if (value > 0.01)
    return <ChevronUp className="h-4 w-4 text-success" />;
  if (value < -0.01)
    return <ChevronDown className="h-4 w-4 text-destructive" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
};

const Dashboard = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const { user } = useAuth();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;

  useEffect(() => {
    const load = async () => {
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
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [user]);

  const normalizedCurve = useMemo(
    () => normalizeCurve(summary?.equityCurve ?? []),
    [summary?.equityCurve]
  );

  const filteredCurve = useMemo(() => {
    const cfg = RANGE_CONFIG[range];
    if (cfg.days === null) return normalizedCurve;
    const cutoff = Date.now() - cfg.days * 86400000;
    const inRange = normalizedCurve.filter((p) => p.timestamp >= cutoff);
    return inRange.length > 0 ? inRange : normalizedCurve.slice(Math.max(0, normalizedCurve.length - 20));
  }, [normalizedCurve, range]);

  const chartSeries = useMemo(() => downsampleSeries(filteredCurve, 140), [filteredCurve]);

  const equityDomain = useMemo<[number, number]>(() => {
    const values = chartSeries.map((p) => p.equity).filter(Number.isFinite);
    if (values.length === 0) return [0, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const pad = Math.max(1, Math.abs(min) * 0.02);
      return [min - pad, max + pad];
    }
    const pad = (max - min) * 0.08;
    return [Math.max(0, min - pad), max + pad];
  }, [chartSeries]);

  const curveStats = useMemo(() => {
    const runsInView = filteredCurve.length;
    const latestBalance = filteredCurve.length > 0
      ? filteredCurve[filteredCurve.length - 1].equity
      : null;
    const maxDrawdownPct = getSeriesDrawdown(filteredCurve);
    return { runsInView, latestBalance, maxDrawdownPct };
  }, [filteredCurve]);

  const recentBacktests = useMemo(() => summary?.recentBacktests ?? [], [summary]);

  const bestBacktest = useMemo(() =>
    recentBacktests.length === 0 ? null :
    recentBacktests.reduce((b, r) => r.pct_change > b.pct_change ? r : b),
    [recentBacktests]
  );

  const worstBacktest = useMemo(() =>
    recentBacktests.length === 0 ? null :
    recentBacktests.reduce((w, r) => r.pct_change < w.pct_change ? r : w),
    [recentBacktests]
  );

  const hasData = !isLoading && (summary?.backtestRunCount ?? 0) > 0;
  const avgReturn = summary?.totalReturnPct ?? 0;
  const winRate = summary?.winRate ?? 0;
  const firstName = (user?.name || "").trim().split(/\s+/)[0];

  const statCards = [
    {
      label: "Avg Return / Run",
      value: isLoading ? "—" : fmtPct(avgReturn),
      sub: isLoading ? null : `across ${summary?.backtestRunCount ?? 0} runs`,
      icon: TrendingUp,
      color: avgReturn >= 0 ? "text-success" : "text-destructive",
      indicator: !isLoading ? <ReturnIndicator value={avgReturn} /> : null,
      href: "/dashboard/history",
    },
    {
      label: "Trade Win Rate",
      value: isLoading ? "—" : `${winRate.toFixed(1)}%`,
      sub: isLoading ? null : winRate >= 50 ? "above break-even" : "below break-even",
      icon: Target,
      color: winRate >= 50 ? "text-primary" : "text-muted-foreground",
      indicator: null,
      href: "/dashboard/history",
    },
    {
      label: "Backtests Run",
      value: isLoading ? "—" : `${summary?.backtestRunCount ?? 0}`,
      sub: isLoading ? null : "total runs",
      icon: BarChart3,
      color: "text-foreground",
      indicator: null,
      href: "/dashboard/history",
    },
    {
      label: "Saved Strategies",
      value: isLoading ? "—" : `${summary?.strategyCount ?? 0}`,
      sub: isLoading ? null : "in library",
      icon: Wallet,
      color: "text-accent",
      indicator: null,
      href: "/dashboard/strategies",
    },
  ];

  return (
    <DashboardLayout
      title="Dashboard"
      metaDescription="Performance dashboard with equity history, run metrics, and strategy activity."
      maxWidth="max-w-[1500px]"
    >
      <PageHeader
        icon={LayoutDashboard}
        eyebrow="Trading command center"
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description="Track performance across runs, validate your edge, and manage your strategies."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/dashboard/strategies")}>
              Strategies
            </Button>
            <Button variant="hero" onClick={() => navigate("/dashboard/backtest")}>
              <FlaskConical className="h-4 w-4" />
              New Backtest
            </Button>
          </>
        }
      >
        {error && <p className="text-sm text-destructive">{error}</p>}
      </PageHeader>

      {/* Stat cards */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            className="glass-card glass-hover cursor-pointer p-4"
            onClick={() => navigate(card.href)}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {card.label}
              </p>
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 bg-background/50">
                <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <p className={`text-2xl font-semibold font-mono leading-none ${card.color}`}>
                {card.value}
              </p>
              {card.indicator}
            </div>
            {card.sub && (
              <p className="mt-1.5 text-xs text-muted-foreground">{card.sub}</p>
            )}
          </motion.div>
        ))}
      </section>

      {/* Main two-column */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">

        {/* Equity curve */}
        <Card className="glass-card border-border/70">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Equity Curve</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  End balance per backtest run — shows trajectory over time, not compounded portfolio growth.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background/60 p-1">
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
          <CardContent className="space-y-3">
            {/* Stats — only show values that are meaningful regardless of run size */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Runs in View</p>
                <p className="mt-0.5 font-mono text-sm font-semibold">
                  {isLoading ? "—" : curveStats.runsInView}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Latest Balance</p>
                <p className="mt-0.5 font-mono text-sm font-semibold">
                  {isLoading || curveStats.latestBalance === null
                    ? "—"
                    : fmt$(curveStats.latestBalance)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Max Drawdown</p>
                <p className={`mt-0.5 font-mono text-sm font-semibold ${
                  curveStats.maxDrawdownPct < -5 ? "text-destructive" : "text-muted-foreground"
                }`}>
                  {isLoading ? "—" : fmtPct(curveStats.maxDrawdownPct)}
                </p>
              </div>
            </div>

            {/* Chart */}
            <div className="h-[340px] rounded-xl border border-border bg-background/50 p-3">
              {isLoading ? (
                <div className="h-full w-full animate-pulse rounded-lg bg-secondary/40" />
              ) : chartSeries.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background/60">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No runs yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Run a backtest to start building your equity history.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/backtest")}>
                    Run First Backtest
                  </Button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartSeries} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashboardEquityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={safeColor(chartColors.areaTop, "hsl(var(--primary))")} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={safeColor(chartColors.areaBottom, "hsl(var(--primary))")} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={colorWithAlpha(chartColors.grid, 0.5, "hsl(var(--border))")}
                    />
                    <XAxis
                      dataKey="xLabel"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      minTickGap={24}
                    />
                    <YAxis
                      domain={equityDomain}
                      allowDecimals={false}
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                      width={88}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "10px",
                      }}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                      formatter={(value: number) => [fmt$(value), "End Balance"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke={safeColor(chartColors.line, "hsl(var(--primary))")}
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

        {/* Recent backtests */}
        <Card className="glass-card border-border/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Recent Runs</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Latest 5 backtests with return and win rate.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs text-primary hover:text-primary"
                onClick={() => navigate("/dashboard/history")}
              >
                All runs
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[72px] animate-pulse rounded-lg bg-secondary/35" />
              ))
            ) : recentBacktests.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
                <FlaskConical className="h-8 w-8 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium">No runs yet</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Your completed backtests will appear here.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/backtest")}>
                  Start Testing
                </Button>
              </div>
            ) : (
              recentBacktests.map((bt) => {
                const pos = bt.pct_change >= 0;
                return (
                  <button
                    key={bt.id}
                    className="group w-full rounded-lg border border-border bg-background/40 p-3 text-left transition-all hover:border-primary/30 hover:bg-background/70"
                    onClick={() => navigate("/dashboard/history")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 flex-1 text-sm font-medium group-hover:text-foreground">
                        {bt.strategy_name || "Unnamed Backtest"}
                      </p>
                      <Badge
                        variant="outline"
                        className={`shrink-0 font-mono text-xs ${
                          pos
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-destructive/40 bg-destructive/10 text-destructive"
                        }`}
                      >
                        {pos ? <ChevronUp className="mr-0.5 h-3 w-3" /> : <ChevronDown className="mr-0.5 h-3 w-3" />}
                        {fmtPct(bt.pct_change ?? 0)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {(bt.win_rate ?? 0).toFixed(1)}% win rate
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {bt.trades ?? 0} trades
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {bt.created_at ? timeAgo(bt.created_at) : "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}

            {/* Best / worst summary — only show if we have multiple runs */}
            {!isLoading && recentBacktests.length >= 2 && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-background/50 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-success" />
                    Best recent
                  </div>
                  <p className="line-clamp-1 text-xs font-medium">{bestBacktest?.strategy_name ?? "—"}</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-success">
                    {bestBacktest ? fmtPct(bestBacktest.pct_change) : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/50 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingDown className="h-3 w-3 text-destructive" />
                    Weakest recent
                  </div>
                  <p className="line-clamp-1 text-xs font-medium">{worstBacktest?.strategy_name ?? "—"}</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-destructive">
                    {worstBacktest ? fmtPct(worstBacktest.pct_change) : "—"}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Footer activity strip */}
      {hasData && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-4 py-3 text-xs text-muted-foreground"
        >
          <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            <span className="font-medium text-foreground">{summary!.backtestRunCount}</span> runs recorded
            {" · "}
            <span className="font-medium text-foreground">{summary!.strategyCount}</span> strategies saved
            {" · "}
            avg return{" "}
            <span className={`font-medium ${avgReturn >= 0 ? "text-success" : "text-destructive"}`}>
              {fmtPct(avgReturn)}
            </span>{" "}
            per run
          </span>
        </motion.div>
      )}

      <RiskDisclaimer variant="inline" className="pt-1" />
    </DashboardLayout>
  );
};

export default Dashboard;
