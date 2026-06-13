import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  ExternalLink,
  FlaskConical,
  History as HistoryIcon,
  Loader2,
  RefreshCw,
  Search,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import RiskDisclaimer from "@/components/RiskDisclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BacktestRunRecord } from "@/lib/api";
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";

type OutcomeFilter = "all" | "profitable" | "losing";
type SortKey = "newest" | "oldest" | "best" | "worst" | "balance";

const SORT_OPTIONS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  best: "Best return",
  worst: "Worst return",
  balance: "Final balance",
};

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatRunDate = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Unknown";

const ReturnBadge = ({ value }: { value: number }) => {
  const positive = value >= 0;
  return (
    <Badge
      variant="outline"
      className={`gap-1 font-mono ${
        positive
          ? "border-success/40 bg-success/10 text-success"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      }`}
    >
      {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {formatPercent(value)}
    </Badge>
  );
};

const Sparkline = ({ run }: { run: BacktestRunRecord }) => {
  const points = run.equity_curve
    .map((point, index) => ({ index, equity: Number(point.equity) }))
    .filter((point) => Number.isFinite(point.equity));

  if (points.length < 2) {
    return (
      <div className="flex h-12 items-center justify-center text-[10px] text-muted-foreground/60">
        No curve
      </div>
    );
  }

  const positive = run.pct_change >= 0;
  const stroke = positive ? "hsl(var(--success))" : "hsl(var(--destructive))";

  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${run.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={stroke}
          strokeWidth={1.5}
          fill={`url(#spark-${run.id})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

const History = () => {
  const [runs, setRuns] = useState<BacktestRunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [detailRun, setDetailRun] = useState<BacktestRunRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BacktestRunRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;

  const loadRuns = async () => {
    setIsLoading(true);
    try {
      const data = await api.getBacktestHistory({ limit: 500 });
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backtest history");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  const stats = useMemo(() => {
    if (runs.length === 0) {
      return { total: 0, avgReturn: 0, profitable: 0, best: null as BacktestRunRecord | null };
    }
    const avgReturn = runs.reduce((sum, run) => sum + run.pct_change, 0) / runs.length;
    const profitable = runs.filter((run) => run.pct_change >= 0).length;
    const best = runs.reduce((acc, run) => (run.pct_change > acc.pct_change ? run : acc));
    return { total: runs.length, avgReturn, profitable, best };
  }, [runs]);

  const visibleRuns = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = runs.filter((run) => {
      if (query && !run.strategy_name.toLowerCase().includes(query)) return false;
      if (outcome === "profitable") return run.pct_change >= 0;
      if (outcome === "losing") return run.pct_change < 0;
      return true;
    });

    const sorted = [...filtered];
    switch (sortKey) {
      case "oldest":
        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "best":
        sorted.sort((a, b) => b.pct_change - a.pct_change);
        break;
      case "worst":
        sorted.sort((a, b) => a.pct_change - b.pct_change);
        break;
      case "balance":
        sorted.sort((a, b) => b.final_balance - a.final_balance);
        break;
      default:
        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return sorted;
  }, [runs, search, outcome, sortKey]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteBacktestRun(pendingDelete.id);
      setRuns((prev) => prev.filter((run) => run.id !== pendingDelete.id));
      if (detailRun?.id === pendingDelete.id) setDetailRun(null);
      toast.success("Run deleted from history");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete run");
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const detailCurve = useMemo(() => {
    if (!detailRun) return [];
    return detailRun.equity_curve
      .map((point) => {
        const time = new Date(point.timestamp).getTime();
        const equity = Number(point.equity);
        if (!Number.isFinite(time) || !Number.isFinite(equity)) return null;
        return {
          equity,
          label: new Date(time).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
      })
      .filter((point): point is { equity: number; label: string } => point !== null);
  }, [detailRun]);

  const detailStartEquity = detailCurve.length > 0 ? detailCurve[0].equity : null;

  const statCards = [
    { label: "Total Runs", value: `${stats.total}`, icon: BarChart3, accent: "text-foreground" },
    {
      label: "Average Return",
      value: formatPercent(stats.avgReturn),
      icon: TrendingUp,
      accent: stats.avgReturn >= 0 ? "text-success" : "text-destructive",
    },
    {
      label: "Profitable Runs",
      value: stats.total ? `${stats.profitable} / ${stats.total}` : "0",
      icon: Target,
      accent: "text-primary",
    },
    {
      label: "Best Run",
      value: stats.best ? formatPercent(stats.best.pct_change) : "—",
      icon: Trophy,
      accent: "text-warning",
    },
  ];

  return (
    <DashboardLayout
      title="History"
      metaDescription="Complete archive of your backtest runs with performance breakdowns."
    >
      <PageHeader
        icon={HistoryIcon}
        eyebrow="Run archive"
        title="Backtest History"
        description="Every backtest you've run, in one place. Search, compare, and drill into past performance."
        actions={
          <>
            <Button variant="outline" onClick={loadRuns} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button variant="hero" onClick={() => navigate("/dashboard/backtest")}>
              <FlaskConical className="h-4 w-4" />
              New Backtest
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card, index) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06, duration: 0.28 }}
            className="glass-card glass-hover p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
              <card.icon className={`h-4 w-4 ${card.accent}`} />
            </div>
            <p className={`font-mono text-2xl font-semibold ${card.accent}`}>
              {isLoading ? "—" : card.value}
            </p>
          </motion.div>
        ))}
      </section>

      <section className="glass-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by strategy name..."
              className="h-10 border-border bg-secondary/60 pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 p-1">
              {(["all", "profitable", "losing"] as OutcomeFilter[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setOutcome(key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    outcome === key
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
            <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
              <SelectTrigger className="h-10 w-[160px] border-border bg-secondary/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_OPTIONS) as SortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_OPTIONS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {error && (
        <div className="glass-card border-destructive/40 p-4 text-sm text-destructive">{error}</div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="glass-card h-20 animate-pulse" />
          ))}
        </div>
      ) : visibleRuns.length === 0 ? (
        <div className="glass-card border-dashed p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
            <HistoryIcon className="h-7 w-7 text-primary" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">
            {runs.length === 0 ? "No backtests yet" : "No runs match your filters"}
          </h3>
          <p className="mx-auto mb-5 max-w-md text-sm text-muted-foreground">
            {runs.length === 0
              ? "Run your first backtest and it will be archived here automatically — returns, win rates, and equity curves included."
              : "Try a different search term or clear the outcome filter."}
          </p>
          {runs.length === 0 && (
            <Button variant="hero" onClick={() => navigate("/dashboard/backtest")}>
              <FlaskConical className="h-4 w-4" />
              Run Your First Backtest
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRuns.map((run, index) => (
            <motion.button
              key={run.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 10) * 0.04, duration: 0.25 }}
              onClick={() => setDetailRun(run)}
              className="glass-card glass-hover grid w-full grid-cols-2 items-center gap-x-4 gap-y-3 p-4 text-left md:grid-cols-[minmax(0,1.4fr)_110px_repeat(3,minmax(0,0.7fr))_140px_auto]"
            >
              <div className="col-span-2 min-w-0 md:col-span-1">
                <p className="truncate font-semibold">{run.strategy_name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {formatRunDate(run.created_at)}
                </p>
              </div>

              <div><ReturnBadge value={run.pct_change} /></div>

              <div className="hidden md:block">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Win Rate</p>
                <p className="font-mono text-sm font-medium">{run.win_rate.toFixed(1)}%</p>
              </div>
              <div className="hidden md:block">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trades</p>
                <p className="font-mono text-sm font-medium">{run.trades}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Final Balance</p>
                <p className="font-mono text-sm font-medium">{formatCurrency(run.final_balance)}</p>
              </div>

              <div className="hidden md:block">
                <Sparkline run={run} />
              </div>

              <div className="hidden items-center md:flex">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDelete(run);
                  }}
                  aria-label="Delete run"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </motion.button>
          ))}
          <p className="px-1 text-xs text-muted-foreground">
            Showing {visibleRuns.length} of {runs.length} runs
          </p>
        </div>
      )}

      <RiskDisclaimer variant="inline" className="pt-2" />

      {/* Run detail dialog */}
      <Dialog open={detailRun !== null} onOpenChange={(open) => !open && setDetailRun(null)}>
        <DialogContent className="max-w-3xl border-border/70 bg-card/95 backdrop-blur-xl">
          {detailRun && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-3">
                  {detailRun.strategy_name}
                  <ReturnBadge value={detailRun.pct_change} />
                </DialogTitle>
                <p className="text-sm text-muted-foreground">{formatRunDate(detailRun.created_at)}</p>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Final Balance", value: formatCurrency(detailRun.final_balance) },
                  { label: "Cash", value: formatCurrency(detailRun.cash) },
                  { label: "Invested", value: formatCurrency(detailRun.invested) },
                  { label: "Trades", value: `${detailRun.trades}` },
                  {
                    label: "Wins / Losses",
                    value: `${detailRun.winning_trades} / ${detailRun.losing_trades}`,
                  },
                  { label: "Win Rate", value: `${detailRun.win_rate.toFixed(1)}%` },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="font-mono text-sm font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-0.5">
                  <p className="text-xs text-muted-foreground">Portfolio value at each trade event</p>
                  {detailStartEquity !== null && (
                    <p className="text-xs text-muted-foreground">
                      Start:{" "}
                      <span className="font-mono font-medium text-foreground">
                        {formatCurrency(detailStartEquity)}
                      </span>
                    </p>
                  )}
                </div>
                <div className="h-[240px] rounded-xl border border-border bg-background/50 p-3">
                  {detailCurve.length >= 2 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detailCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="historyDetailFill" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor={safeColor(chartColors.areaTop, "hsl(var(--primary))")}
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="95%"
                              stopColor={safeColor(chartColors.areaBottom, "hsl(var(--primary))")}
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={colorWithAlpha(chartColors.grid, 0.5, "hsl(var(--border))")}
                        />
                        <XAxis
                          dataKey="label"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          minTickGap={32}
                        />
                        <YAxis
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
                          width={76}
                          domain={["auto", "auto"]}
                        />
                        {detailStartEquity !== null && (
                          <ReferenceLine
                            y={detailStartEquity}
                            stroke="hsl(var(--muted-foreground))"
                            strokeDasharray="4 3"
                            strokeOpacity={0.5}
                            label={{
                              value: "Start",
                              position: "insideTopRight",
                              fontSize: 10,
                              fill: "hsl(var(--muted-foreground))",
                            }}
                          />
                        )}
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "10px",
                          }}
                          formatter={(value: number) => [formatCurrency(value), "Portfolio Value"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="equity"
                          stroke={safeColor(chartColors.line, "hsl(var(--primary))")}
                          strokeWidth={2}
                          fill="url(#historyDetailFill)"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      This run has no stored equity curve.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setPendingDelete(detailRun)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Run
                </Button>
                {detailRun.strategy_id && (
                  <Button variant="hero" onClick={() => navigate("/dashboard/strategies")}>
                    <ExternalLink className="h-4 w-4" />
                    Open Strategy
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="border-border/70 bg-card/95 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes "{pendingDelete?.strategy_name}" from your history permanently. The saved
              strategy itself is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default History;
