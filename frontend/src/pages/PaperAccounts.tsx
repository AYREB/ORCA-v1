import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  Activity,
  BarChart3,
  Clock3,
  LineChart,
  Loader2,
  Pencil,
  Play,
  Plus,
  Rocket,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from "recharts";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, BacktestResult, SavedStrategy, TradeEntry } from "@/lib/api";
import BacktestResults from "@/components/backtest/BacktestResults";
import ChartView from "@/components/backtest/ChartView";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

interface PaperStrategyRun {
  id: string;
  strategyId: number;
  strategyName: string;
  executedAt: string;
  result: BacktestResult;
  pctChange: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface PaperEquityPoint {
  timestamp: string;
  equity: number;
}

interface PaperAccount {
  id: string;
  name: string;
  description: string;
  startingBalance: number;
  currentBalance: number;
  createdAt: string;
  updatedAt: string;
  appliedStrategyIds: number[];
  runs: PaperStrategyRun[];
  performanceHistory: PaperEquityPoint[];
}

interface TradeOutcomeSummary {
  wins: number;
  losses: number;
  completed: number;
  winRate: number;
}

const PAPER_ACCOUNTS_STORAGE_PREFIX = "orca_paper_accounts_v1";

const formatMoney = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const getStorageKey = (userId?: number) => `${PAPER_ACCOUNTS_STORAGE_PREFIX}:${userId ?? "guest"}`;

const toPositiveNumber = (value: string, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeRun = (value: unknown): PaperStrategyRun | null => {
  if (!isObjectRecord(value)) return null;
  const result = value.result;
  if (!isObjectRecord(result)) return null;

  return {
    id:
      typeof value.id === "string"
        ? value.id
        : typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
    strategyId: typeof value.strategyId === "number" ? value.strategyId : 0,
    strategyName: typeof value.strategyName === "string" ? value.strategyName : "Strategy",
    executedAt: typeof value.executedAt === "string" ? value.executedAt : new Date().toISOString(),
    result: result as BacktestResult,
    pctChange: typeof value.pctChange === "number" ? value.pctChange : 0,
    tradeCount: typeof value.tradeCount === "number" ? value.tradeCount : 0,
    wins: typeof value.wins === "number" ? value.wins : 0,
    losses: typeof value.losses === "number" ? value.losses : 0,
    winRate: typeof value.winRate === "number" ? value.winRate : 0,
  };
};

const normalizeAccount = (raw: unknown): PaperAccount => {
  const source = isObjectRecord(raw) ? raw : {};
  const createdAt = typeof source.createdAt === "string" ? source.createdAt : new Date().toISOString();
  const startingBalance =
    typeof source.startingBalance === "number" &&
    Number.isFinite(source.startingBalance) &&
    source.startingBalance > 0
      ? source.startingBalance
      : 10000;
  const currentBalance =
    typeof source.currentBalance === "number" && Number.isFinite(source.currentBalance) && source.currentBalance > 0
      ? source.currentBalance
      : startingBalance;

  const performanceHistory: PaperEquityPoint[] =
    Array.isArray(source.performanceHistory) && source.performanceHistory.length > 0
      ? source.performanceHistory
          .filter(
            (point): point is PaperEquityPoint =>
              isObjectRecord(point) &&
              typeof point.timestamp === "string" &&
              typeof point.equity === "number" &&
              Number.isFinite(point.equity),
          )
          .map((point) => ({ timestamp: point.timestamp, equity: point.equity }))
      : [{ timestamp: createdAt, equity: startingBalance }];

  const normalizedRuns: PaperStrategyRun[] = Array.isArray(source.runs)
    ? source.runs.map((run) => normalizeRun(run)).filter((run): run is PaperStrategyRun => run !== null)
    : [];

  return {
    id:
      typeof source.id === "string"
        ? source.id
        : typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
    name: typeof source.name === "string" && source.name.trim() ? source.name : "Paper Account",
    description: typeof source.description === "string" ? source.description : "",
    startingBalance,
    currentBalance,
    createdAt,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : createdAt,
    appliedStrategyIds: Array.isArray(source.appliedStrategyIds)
      ? source.appliedStrategyIds.filter((id): id is number => typeof id === "number")
      : [],
    runs: normalizedRuns,
    performanceHistory,
  };
};

const summarizeTradeOutcomes = (trades: TradeEntry[]): TradeOutcomeSummary => {
  const openPositions = new Map<string, number[]>();
  let wins = 0;
  let losses = 0;

  for (const trade of trades) {
    if (trade.type === "BUY" || trade.type === "RECURRING_BUY") {
      const entries = openPositions.get(trade.ticker) ?? [];
      entries.push(trade.price);
      openPositions.set(trade.ticker, entries);
      continue;
    }

    if (trade.type === "SELL") {
      const entries = openPositions.get(trade.ticker) ?? [];
      const entryPrice = entries.shift();
      if (entryPrice !== undefined) {
        if (trade.price >= entryPrice) wins += 1;
        else losses += 1;
      }
      if (entries.length > 0) openPositions.set(trade.ticker, entries);
      else openPositions.delete(trade.ticker);
    }
  }

  const completed = wins + losses;
  return {
    wins,
    losses,
    completed,
    winRate: completed > 0 ? (wins / completed) * 100 : 0,
  };
};

const getStrategyDslJson = (strategy: SavedStrategy): Record<string, unknown> | null => {
  if (strategy.dslJson && typeof strategy.dslJson === "object" && !Array.isArray(strategy.dslJson)) {
    return strategy.dslJson as Record<string, unknown>;
  }

  if (!strategy.dsl?.trim()) return null;

  try {
    const parsed = JSON.parse(strategy.dsl);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
};

const PaperAccounts = () => {
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
  const [selectedApplyStrategyId, setSelectedApplyStrategyId] = useState<string>("");
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountDialogMode, setAccountDialogMode] = useState<"create" | "edit">("create");
  const [accountName, setAccountName] = useState("");
  const [accountDescription, setAccountDescription] = useState("");
  const [accountStartingBalance, setAccountStartingBalance] = useState("10000");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [newStrategyDsl, setNewStrategyDsl] = useState("");
  const [isCreatingStrategy, setIsCreatingStrategy] = useState(false);

  const storageKey = useMemo(() => getStorageKey(user?.id), [user?.id]);

  const updateAccounts = useCallback(
    (updater: (previous: PaperAccount[]) => PaperAccount[]) => {
      setAccounts((previous) => {
        const next = updater(previous);
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [storageKey],
  );

  const loadStrategies = useCallback(async () => {
    setIsLoadingStrategies(true);
    try {
      const fetched = await api.fetchStrategies();
      setStrategies(fetched);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load strategies";
      toast.error(message);
    } finally {
      setIsLoadingStrategies(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      setAccounts([]);
      setSelectedAccountId(null);
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        setAccounts([]);
        setSelectedAccountId(null);
        return;
      }
      const normalized = parsed.map((account) => normalizeAccount(account));
      setAccounts(normalized);
      setSelectedAccountId(normalized[0]?.id ?? null);
    } catch {
      setAccounts([]);
      setSelectedAccountId(null);
    }
  }, [storageKey]);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId(null);
      return;
    }

    const stillExists = selectedAccountId ? accounts.some((account) => account.id === selectedAccountId) : false;
    if (!stillExists) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  useEffect(() => {
    if (!selectedAccount) {
      setSelectedRunId(null);
      return;
    }
    const runExists = selectedRunId ? selectedAccount.runs.some((run) => run.id === selectedRunId) : false;
    if (!runExists) {
      setSelectedRunId(selectedAccount.runs[0]?.id ?? null);
    }
  }, [selectedAccount, selectedRunId]);

  const selectedRun = useMemo(() => {
    if (!selectedAccount) return null;
    return selectedAccount.runs.find((run) => run.id === selectedRunId) ?? selectedAccount.runs[0] ?? null;
  }, [selectedAccount, selectedRunId]);

  const selectedAccountStrategies = useMemo(() => {
    if (!selectedAccount) return [];
    return strategies.filter((strategy) => selectedAccount.appliedStrategyIds.includes(strategy.id));
  }, [selectedAccount, strategies]);

  const availableStrategiesToApply = useMemo(() => {
    if (!selectedAccount) return [];
    return strategies.filter((strategy) => !selectedAccount.appliedStrategyIds.includes(strategy.id));
  }, [selectedAccount, strategies]);

  const selectedAccountMetrics = useMemo(() => {
    if (!selectedAccount) return null;

    const totalTrades = selectedAccount.runs.reduce((sum, run) => sum + run.tradeCount, 0);
    const totalWins = selectedAccount.runs.reduce((sum, run) => sum + run.wins, 0);
    const totalLosses = selectedAccount.runs.reduce((sum, run) => sum + run.losses, 0);
    const completedTrades = totalWins + totalLosses;
    const allTimeWinRate = completedTrades > 0 ? (totalWins / completedTrades) * 100 : 0;
    const returns = selectedAccount.runs.map((run) => run.pctChange);
    const bestRun = returns.length > 0 ? Math.max(...returns) : 0;
    const worstRun = returns.length > 0 ? Math.min(...returns) : 0;
    const allTimeHigh = Math.max(
      selectedAccount.startingBalance,
      ...selectedAccount.performanceHistory.map((point) => point.equity),
    );
    const totalReturnPct =
      ((selectedAccount.currentBalance - selectedAccount.startingBalance) / selectedAccount.startingBalance) * 100;
    const drawdownPct = allTimeHigh > 0 ? ((selectedAccount.currentBalance - allTimeHigh) / allTimeHigh) * 100 : 0;

    return {
      totalTrades,
      totalWins,
      totalLosses,
      allTimeWinRate,
      bestRun,
      worstRun,
      allTimeHigh,
      totalReturnPct,
      drawdownPct,
      totalRuns: selectedAccount.runs.length,
      lastRunAt: selectedAccount.runs[0]?.executedAt ?? null,
    };
  }, [selectedAccount]);

  const equityChartData = useMemo(() => {
    if (!selectedAccount) return [];
    return [...selectedAccount.performanceHistory]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((point) => ({
        time: new Date(point.timestamp).toLocaleDateString(),
        equity: point.equity,
      }));
  }, [selectedAccount]);

  const runReturnsData = useMemo(() => {
    if (!selectedAccount) return [];
    return [...selectedAccount.runs]
      .slice(0, 20)
      .reverse()
      .map((run) => ({
        time: new Date(run.executedAt).toLocaleDateString(),
        returnPct: run.pctChange,
        strategy: run.strategyName,
      }));
  }, [selectedAccount]);

  const openCreateAccountDialog = () => {
    setAccountDialogMode("create");
    setAccountName("");
    setAccountDescription("");
    setAccountStartingBalance("10000");
    setAccountDialogOpen(true);
  };

  const openEditAccountDialog = (account: PaperAccount) => {
    setAccountDialogMode("edit");
    setAccountName(account.name);
    setAccountDescription(account.description);
    setAccountStartingBalance(account.startingBalance.toString());
    setAccountDialogOpen(true);
  };

  const handleSaveAccount = () => {
    const name = accountName.trim();
    if (!name) {
      toast.error("Please enter an account name");
      return;
    }

    const startingBalance = toPositiveNumber(accountStartingBalance, 10000);
    const now = new Date().toISOString();

    if (accountDialogMode === "create") {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const newAccount: PaperAccount = {
        id,
        name,
        description: accountDescription.trim(),
        startingBalance,
        currentBalance: startingBalance,
        createdAt: now,
        updatedAt: now,
        appliedStrategyIds: [],
        runs: [],
        performanceHistory: [{ timestamp: now, equity: startingBalance }],
      };

      updateAccounts((previous) => [newAccount, ...previous]);
      setSelectedAccountId(id);
      toast.success("Paper account created");
    } else if (selectedAccount) {
      const previousStart = selectedAccount.startingBalance;
      const scale = previousStart > 0 ? startingBalance / previousStart : 1;

      updateAccounts((previous) =>
        previous.map((account) => {
          if (account.id !== selectedAccount.id) return account;
          return {
            ...account,
            name,
            description: accountDescription.trim(),
            startingBalance,
            currentBalance: account.currentBalance * scale,
            performanceHistory: account.performanceHistory.map((point, idx) => ({
              ...point,
              equity: idx === 0 ? startingBalance : point.equity * scale,
            })),
            updatedAt: now,
          };
        }),
      );
      toast.success("Paper account updated");
    }

    setAccountDialogOpen(false);
  };

  const handleDeleteAccount = (accountId: string) => {
    const target = accounts.find((account) => account.id === accountId);
    if (!target) return;

    const confirmed = window.confirm(`Delete "${target.name}"? This removes its paper-trading history.`);
    if (!confirmed) return;

    updateAccounts((previous) => previous.filter((account) => account.id !== accountId));
    if (selectedAccountId === accountId) {
      const remaining = accounts.filter((account) => account.id !== accountId);
      setSelectedAccountId(remaining[0]?.id ?? null);
    }
    toast.success("Paper account deleted");
  };

  const handleApplyStrategy = () => {
    if (!selectedAccount || !selectedApplyStrategyId) return;
    const strategyId = Number(selectedApplyStrategyId);
    if (!Number.isFinite(strategyId)) return;

    updateAccounts((previous) =>
      previous.map((account) =>
        account.id === selectedAccount.id
          ? {
              ...account,
              appliedStrategyIds: Array.from(new Set([...account.appliedStrategyIds, strategyId])),
              updatedAt: new Date().toISOString(),
            }
          : account,
      ),
    );
    setSelectedApplyStrategyId("");
    toast.success("Strategy applied to account");
  };

  const handleRemoveAppliedStrategy = (strategyId: number) => {
    if (!selectedAccount) return;
    updateAccounts((previous) =>
      previous.map((account) =>
        account.id === selectedAccount.id
          ? {
              ...account,
              appliedStrategyIds: account.appliedStrategyIds.filter((id) => id !== strategyId),
              updatedAt: new Date().toISOString(),
            }
          : account,
      ),
    );
    toast.success("Strategy removed from account");
  };

  const handleDeleteStrategyEverywhere = async (strategyId: number) => {
    const strategy = strategies.find((item) => item.id === strategyId);
    if (!strategy) return;
    const confirmed = window.confirm(`Delete strategy "${strategy.name}" everywhere?`);
    if (!confirmed) return;

    try {
      await api.deleteStrategy(strategyId);
      setStrategies((previous) => previous.filter((item) => item.id !== strategyId));
      updateAccounts((previous) =>
        previous.map((account) => ({
          ...account,
          appliedStrategyIds: account.appliedStrategyIds.filter((id) => id !== strategyId),
        })),
      );
      toast.success("Strategy deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete strategy";
      toast.error(message);
    }
  };

  const handleCreateStrategyInAccount = async () => {
    if (!selectedAccount) return;

    const name = newStrategyName.trim();
    const dsl = newStrategyDsl.trim();

    if (!name) {
      toast.error("Please enter a strategy name");
      return;
    }
    if (!dsl) {
      toast.error("Please enter strategy DSL");
      return;
    }

    let parsedDslJson: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(dsl);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedDslJson = parsed as Record<string, unknown>;
      }
    } catch {
      parsedDslJson = undefined;
    }

    setIsCreatingStrategy(true);
    try {
      const created = await api.createStrategy({
        name,
        dsl,
        dslJson: parsedDslJson,
      });
      setStrategies((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
      updateAccounts((previous) =>
        previous.map((account) =>
          account.id === selectedAccount.id
            ? {
                ...account,
                appliedStrategyIds: Array.from(new Set([...account.appliedStrategyIds, created.id])),
                updatedAt: new Date().toISOString(),
              }
            : account,
        ),
      );
      setNewStrategyName("");
      setNewStrategyDsl("");
      toast.success("New strategy created and applied");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create strategy";
      toast.error(message);
    } finally {
      setIsCreatingStrategy(false);
    }
  };

  const handleRunStrategy = async (accountId: string, strategyId: number) => {
    const account = accounts.find((item) => item.id === accountId);
    const strategy = strategies.find((item) => item.id === strategyId);
    if (!account || !strategy) return;

    const runKey = `${accountId}:${strategyId}`;
    setRunningKey(runKey);

    try {
      const dslJson = getStrategyDslJson(strategy);
      let result: BacktestResult;

      if (dslJson && Object.keys(dslJson).length > 0) {
        result = await api.backtestDSLJSON(dslJson, {
          strategyId: strategy.id,
          strategyName: strategy.name,
          initialBalance: account.currentBalance,
        });
      } else if (strategy.dsl?.trim()) {
        result = await api.backtestDSLText(strategy.dsl, {
          strategyId: strategy.id,
          strategyName: strategy.name,
          initialBalance: account.currentBalance,
        });
      } else {
        throw new Error("This strategy has no runnable DSL.");
      }

      const now = new Date().toISOString();
      const outcomes = summarizeTradeOutcomes(result.trades);
      const run: PaperStrategyRun = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        strategyId: strategy.id,
        strategyName: strategy.name,
        executedAt: now,
        result,
        pctChange: result.pct_change,
        tradeCount: result.trades.length,
        wins: outcomes.wins,
        losses: outcomes.losses,
        winRate: outcomes.winRate,
      };

      updateAccounts((previous) =>
        previous.map((item) =>
          item.id === accountId
            ? {
                ...item,
                currentBalance: result.total_portfolio,
                updatedAt: now,
                runs: [run, ...item.runs],
                performanceHistory: [...item.performanceHistory, { timestamp: now, equity: result.total_portfolio }],
              }
            : item,
        ),
      );
      setSelectedRunId(run.id);
      toast.success(`Executed "${strategy.name}" on ${account.name}`);

      try {
        await api.updateStrategy(strategy.id, { lastResult: result });
      } catch {
        // Keep paper account flow resilient even if strategy result persistence fails.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to execute strategy";
      toast.error(message);
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <>
      <Helmet>
        <title>Paper Accounts - Orca</title>
        <meta
          name="description"
          content="Create and manage paper trading accounts, apply strategies, inspect trades, and track all-time performance."
        />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((previous) => !previous)}
        />

        <main className={`transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="p-6 max-w-[1500px] mx-auto space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">Paper Accounts</h1>
                <p className="text-sm text-muted-foreground">
                  Build full paper-trading portfolios with strategy execution, trade logs, and account analytics.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={loadStrategies} disabled={isLoadingStrategies}>
                  {isLoadingStrategies ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Refreshing Strategies
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Refresh Strategies
                    </>
                  )}
                </Button>
                <Button onClick={openCreateAccountDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Paper Account
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
              <Card className="bg-card/60 backdrop-blur-sm border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Accounts</CardTitle>
                  <CardDescription>
                    Create, edit, and switch between paper trading accounts.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {accounts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-3">
                      <Wallet className="h-8 w-8 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No paper accounts yet. Create one to start tracking simulated performance.
                      </p>
                      <Button size="sm" onClick={openCreateAccountDialog}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Account
                      </Button>
                    </div>
                  ) : (
                    <ScrollArea className="h-[calc(100vh-260px)] pr-2">
                      <div className="space-y-3">
                        {accounts.map((account) => {
                          const returnPct =
                            ((account.currentBalance - account.startingBalance) / account.startingBalance) * 100;
                          const isSelected = selectedAccountId === account.id;
                          return (
                            <button
                              key={account.id}
                              onClick={() => setSelectedAccountId(account.id)}
                              className={`w-full rounded-xl border p-4 text-left transition-colors ${
                                isSelected
                                  ? "border-primary/40 bg-primary/10"
                                  : "border-border bg-secondary/20 hover:bg-secondary/40"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div>
                                  <p className="font-semibold line-clamp-1">{account.name}</p>
                                  <p className="text-xs text-muted-foreground line-clamp-1">
                                    {account.description || "No description"}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openEditAccountDialog(account);
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleDeleteAccount(account.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                                <div className="rounded-md bg-background/70 p-2">
                                  <p className="text-muted-foreground">Current</p>
                                  <p className="font-mono font-semibold">{formatMoney(account.currentBalance)}</p>
                                </div>
                                <div className="rounded-md bg-background/70 p-2">
                                  <p className="text-muted-foreground">Return</p>
                                  <p
                                    className={`font-mono font-semibold ${
                                      returnPct >= 0 ? "text-success" : "text-destructive"
                                    }`}
                                  >
                                    {returnPct >= 0 ? "+" : ""}
                                    {returnPct.toFixed(2)}%
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                                <span>{account.appliedStrategyIds.length} strategies</span>
                                <span>{account.runs.length} runs</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              {!selectedAccount || !selectedAccountMetrics ? (
                <Card className="border-dashed bg-card/40">
                  <CardContent className="py-16 text-center space-y-3">
                    <Rocket className="h-10 w-10 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Select an account to manage strategies, run paper trades, and review analytics.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  <Card className="bg-card/60 border-border">
                    <CardHeader className="pb-4">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-xl">{selectedAccount.name}</CardTitle>
                            <Badge variant="outline" className="text-xs">
                              Started {new Date(selectedAccount.createdAt).toLocaleDateString()}
                            </Badge>
                          </div>
                          <CardDescription>
                            {selectedAccount.description || "Simulated environment for strategy execution and testing."}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" onClick={() => openEditAccountDialog(selectedAccount)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit Account
                          </Button>
                          <Button
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteAccount(selectedAccount.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Account
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <Wallet className="h-3.5 w-3.5" />
                          Current Equity
                        </div>
                        <p className="font-mono text-lg font-semibold">{formatMoney(selectedAccount.currentBalance)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <TrendingUp className="h-3.5 w-3.5" />
                          All-Time Return
                        </div>
                        <p
                          className={`font-mono text-lg font-semibold ${
                            selectedAccountMetrics.totalReturnPct >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {selectedAccountMetrics.totalReturnPct >= 0 ? "+" : ""}
                          {selectedAccountMetrics.totalReturnPct.toFixed(2)}%
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <LineChart className="h-3.5 w-3.5" />
                          All-Time High
                        </div>
                        <p className="font-mono text-lg font-semibold">{formatMoney(selectedAccountMetrics.allTimeHigh)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <TrendingDown className="h-3.5 w-3.5" />
                          Drawdown
                        </div>
                        <p
                          className={`font-mono text-lg font-semibold ${
                            selectedAccountMetrics.drawdownPct >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {selectedAccountMetrics.drawdownPct >= 0 ? "+" : ""}
                          {selectedAccountMetrics.drawdownPct.toFixed(2)}%
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <Target className="h-3.5 w-3.5" />
                          Best / Worst Run
                        </div>
                        <p className="font-mono text-base font-semibold">
                          <span className="text-success">
                            {selectedAccountMetrics.bestRun >= 0 ? "+" : ""}
                            {selectedAccountMetrics.bestRun.toFixed(2)}%
                          </span>
                          {" / "}
                          <span className="text-destructive">{selectedAccountMetrics.worstRun.toFixed(2)}%</span>
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <BarChart3 className="h-3.5 w-3.5" />
                          Strategy Runs
                        </div>
                        <p className="font-mono text-lg font-semibold">{selectedAccountMetrics.totalRuns}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <Activity className="h-3.5 w-3.5" />
                          Trades / Win Rate
                        </div>
                        <p className="font-mono text-base font-semibold">
                          {selectedAccountMetrics.totalTrades} / {selectedAccountMetrics.allTimeWinRate.toFixed(1)}%
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <Clock3 className="h-3.5 w-3.5" />
                          Last Run
                        </div>
                        <p className="font-mono text-sm font-semibold">
                          {selectedAccountMetrics.lastRunAt
                            ? new Date(selectedAccountMetrics.lastRunAt).toLocaleString()
                            : "No runs yet"}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="mb-4 bg-card/50 border border-border p-1">
                      <TabsTrigger value="overview" className="data-[state=active]:bg-primary/20">
                        Overview
                      </TabsTrigger>
                      <TabsTrigger value="strategies" className="data-[state=active]:bg-primary/20">
                        Strategies
                      </TabsTrigger>
                      <TabsTrigger value="activity" className="data-[state=active]:bg-primary/20">
                        Activity & Trades
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <Card className="bg-card/60 border-border">
                          <CardHeader>
                            <CardTitle className="text-lg">Equity Curve</CardTitle>
                            <CardDescription>All-time account value after each paper run.</CardDescription>
                          </CardHeader>
                          <CardContent className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={equityChartData}>
                                <defs>
                                  <linearGradient id="paperEquityFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="hsl(175 80% 50%)" stopOpacity={0.35} />
                                    <stop offset="95%" stopColor="hsl(175 80% 50%)" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 18%)" />
                                <XAxis
                                  dataKey="time"
                                  stroke="hsl(215 20% 55%)"
                                  tick={{ fill: "hsl(215 20% 55%)", fontSize: 12 }}
                                />
                                <YAxis
                                  stroke="hsl(215 20% 55%)"
                                  tick={{ fill: "hsl(215 20% 55%)", fontSize: 12 }}
                                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                                />
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: "hsl(222 47% 8%)",
                                    border: "1px solid hsl(222 30% 18%)",
                                  }}
                                  formatter={(value: number) => formatMoney(value)}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="equity"
                                  stroke="hsl(175 80% 50%)"
                                  strokeWidth={2}
                                  fill="url(#paperEquityFill)"
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>

                        <Card className="bg-card/60 border-border">
                          <CardHeader>
                            <CardTitle className="text-lg">Run Performance</CardTitle>
                            <CardDescription>Return percentage for recent strategy executions.</CardDescription>
                          </CardHeader>
                          <CardContent className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={runReturnsData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 18%)" />
                                <XAxis
                                  dataKey="time"
                                  stroke="hsl(215 20% 55%)"
                                  tick={{ fill: "hsl(215 20% 55%)", fontSize: 12 }}
                                />
                                <YAxis
                                  stroke="hsl(215 20% 55%)"
                                  tick={{ fill: "hsl(215 20% 55%)", fontSize: 12 }}
                                  tickFormatter={(value) => `${value.toFixed(0)}%`}
                                />
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: "hsl(222 47% 8%)",
                                    border: "1px solid hsl(222 30% 18%)",
                                  }}
                                  formatter={(value: number) => [`${value.toFixed(2)}%`, "Return"]}
                                  labelFormatter={(label, payload) => {
                                    const item = payload?.[0]?.payload;
                                    return item ? `${item.time} - ${item.strategy}` : `${label}`;
                                  }}
                                />
                                <Bar dataKey="returnPct" radius={[4, 4, 0, 0]}>
                                  {runReturnsData.map((entry, index) => (
                                    <Cell key={`${entry.time}-${index}`} fill={entry.returnPct >= 0 ? "#22c55e" : "#ef4444"} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>

                    <TabsContent value="strategies" className="space-y-6">
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <Card className="bg-card/60 border-border">
                          <CardHeader>
                            <CardTitle className="text-lg">Apply Existing Strategy</CardTitle>
                            <CardDescription>
                              Attach any saved strategy to this account and run it with current equity.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <Select value={selectedApplyStrategyId} onValueChange={setSelectedApplyStrategyId}>
                              <SelectTrigger>
                                <SelectValue placeholder="Choose a saved strategy" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableStrategiesToApply.length === 0 ? (
                                  <SelectItem value="__none" disabled>
                                    No available strategies
                                  </SelectItem>
                                ) : (
                                  availableStrategiesToApply.map((strategy) => (
                                    <SelectItem key={strategy.id} value={strategy.id.toString()}>
                                      {strategy.name}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <Button
                              onClick={handleApplyStrategy}
                              disabled={!selectedApplyStrategyId || availableStrategiesToApply.length === 0}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Apply Strategy
                            </Button>
                          </CardContent>
                        </Card>

                        <Card className="bg-card/60 border-border">
                          <CardHeader>
                            <CardTitle className="text-lg">Create Strategy In Account</CardTitle>
                            <CardDescription>
                              Create and save a new strategy directly from this paper account context.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <Input
                              placeholder="Strategy name"
                              value={newStrategyName}
                              onChange={(event) => setNewStrategyName(event.target.value)}
                            />
                            <Textarea
                              placeholder='Paste DSL text or JSON DSL (e.g. {"strategy": {...}})'
                              value={newStrategyDsl}
                              onChange={(event) => setNewStrategyDsl(event.target.value)}
                              className="min-h-[120px] font-mono text-xs"
                            />
                            <Button onClick={handleCreateStrategyInAccount} disabled={isCreatingStrategy}>
                              {isCreatingStrategy ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Creating
                                </>
                              ) : (
                                <>
                                  <Plus className="h-4 w-4 mr-2" />
                                  Create & Apply
                                </>
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="bg-card/60 border-border">
                        <CardHeader>
                          <CardTitle className="text-lg">Applied Strategies</CardTitle>
                          <CardDescription>
                            Run, detach, or delete strategies from this account's trading setup.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {selectedAccountStrategies.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                              No strategies applied yet.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {selectedAccountStrategies.map((strategy) => {
                                const key = `${selectedAccount.id}:${strategy.id}`;
                                const isRunning = runningKey === key;
                                const lastResult = strategy.lastResult;
                                return (
                                  <div
                                    key={strategy.id}
                                    className="rounded-xl border border-border bg-background/50 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                                  >
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold">{strategy.name}</p>
                                        {lastResult?.pct_change !== undefined && (
                                          <Badge
                                            variant="outline"
                                            className={
                                              lastResult.pct_change >= 0
                                                ? "text-success border-success/40 bg-success/10"
                                                : "text-destructive border-destructive/40 bg-destructive/10"
                                            }
                                          >
                                            {lastResult.pct_change >= 0 ? "+" : ""}
                                            {lastResult.pct_change.toFixed(2)}%
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground line-clamp-2">
                                        {strategy.dsl || "No DSL text"}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleRunStrategy(selectedAccount.id, strategy.id)}
                                        disabled={isRunning}
                                      >
                                        {isRunning ? (
                                          <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Running
                                          </>
                                        ) : (
                                          <>
                                            <Play className="h-4 w-4 mr-2" />
                                            Run
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleRemoveAppliedStrategy(strategy.id)}
                                      >
                                        Remove
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => handleDeleteStrategyEverywhere(strategy.id)}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="activity" className="space-y-4">
                      {selectedAccount.runs.length === 0 ? (
                        <Card className="bg-card/60 border-border">
                          <CardContent className="py-16 text-center space-y-3">
                            <Play className="h-10 w-10 mx-auto text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                              Run any applied strategy to generate trade logs, charts, and full performance analytics.
                            </p>
                          </CardContent>
                        </Card>
                      ) : selectedRun ? (
                        <>
                          <Card className="bg-card/60 border-border">
                            <CardContent className="pt-6">
                              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                                <div className="lg:col-span-2 space-y-2">
                                  <p className="text-xs text-muted-foreground">Selected run</p>
                                  <Select value={selectedRun.id} onValueChange={setSelectedRunId}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {selectedAccount.runs.map((run) => (
                                        <SelectItem key={run.id} value={run.id}>
                                          {new Date(run.executedAt).toLocaleString()} - {run.strategyName}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="rounded-lg border border-border bg-background/70 p-3">
                                  <p className="text-xs text-muted-foreground">Return</p>
                                  <p
                                    className={`font-mono font-semibold ${
                                      selectedRun.pctChange >= 0 ? "text-success" : "text-destructive"
                                    }`}
                                  >
                                    {selectedRun.pctChange >= 0 ? "+" : ""}
                                    {selectedRun.pctChange.toFixed(2)}%
                                  </p>
                                </div>
                                <div className="rounded-lg border border-border bg-background/70 p-3">
                                  <p className="text-xs text-muted-foreground">Trades / Win Rate</p>
                                  <p className="font-mono font-semibold">
                                    {selectedRun.tradeCount} / {selectedRun.winRate.toFixed(1)}%
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>

                          <Tabs defaultValue="numerical" className="w-full" key={selectedRun.id}>
                            <TabsList className="bg-card/50 border border-border p-1">
                              <TabsTrigger value="numerical" className="data-[state=active]:bg-primary/20">
                                Numerical + Trades
                              </TabsTrigger>
                              <TabsTrigger value="chart" className="data-[state=active]:bg-primary/20">
                                Chart + Trade Markers
                              </TabsTrigger>
                            </TabsList>
                            <TabsContent value="numerical">
                              <BacktestResults results={selectedRun.result} />
                            </TabsContent>
                            <TabsContent value="chart">
                              <ChartView results={selectedRun.result} />
                            </TabsContent>
                          </Tabs>
                        </>
                      ) : null}
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
          </div>
        </main>

        <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{accountDialogMode === "create" ? "Create Paper Account" : "Edit Paper Account"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Account name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
              />
              <Textarea
                placeholder="Short description (optional)"
                value={accountDescription}
                onChange={(event) => setAccountDescription(event.target.value)}
              />
              <Input
                type="number"
                min={1}
                step={100}
                placeholder="Starting balance"
                value={accountStartingBalance}
                onChange={(event) => setAccountStartingBalance(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAccountDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveAccount}>
                {accountDialogMode === "create" ? "Create Account" : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

export default PaperAccounts;
