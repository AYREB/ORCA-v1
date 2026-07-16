import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  LineChart,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
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
  ReferenceLine,
} from "recharts";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import RiskDisclaimer from "@/components/RiskDisclaimer";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, ApiError, BacktestResult, SavedStrategy, TradeEntry } from "@/lib/api";
import { detectDirection, isEntryTrade, isExitTrade } from "@/lib/tradeUtils";
import BacktestResults from "@/components/backtest/BacktestResults";
import ChartView from "@/components/backtest/ChartView";
import StrategySummary from "@/components/backtest/StrategySummary";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";

interface PaperStrategyRun {
  id: string;
  appliedStrategyId?: string;
  strategyId: number;
  strategyName: string;
  executedAt: string;
  mode: "manual" | "live";
  startDate?: string;
  windowEnd?: string;
  result?: BacktestResult;
  pctChange: number;
  startingEquity?: number;
  endingValue?: number;
  pnl?: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface AppliedPaperStrategy {
  id: string;
  strategyId: number;
  strategyName: string;
  appliedAt: string;
  startDate: string;
  startingEquity: number;
  currentValue: number;
  active: boolean;
  stoppedAt?: string;
  lastUpdatedAt?: string;
  lastWindowEnd?: string;
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
  appliedStrategies: AppliedPaperStrategy[];
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
const STRATEGY_SIDES = ["LONG", "SHORT"] as const;

const formatMoney = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatSignedMoney = (value: number) => `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;

const getStorageKey = (userId?: number) => `${PAPER_ACCOUNTS_STORAGE_PREFIX}:${userId ?? "guest"}`;

const toPositiveNumber = (value: string, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const createId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatChartDayLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const isSameLocalDate = (timestamp: string, dateKey: string) => {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) && formatLocalDate(date) === dateKey;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getDateKeyFromTimestamp = (timestamp: string, fallback = formatLocalDate(new Date())) => {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? formatLocalDate(date) : fallback;
};

// The day AFTER the given timestamp, as a YYYY-MM-DD key. Used as an exclusive
// end bound so "today" is included even though the backend treats date-only ends
// as exclusive — a same-day intraday window has no daily/4h bars and errors out.
const getNextDayDateKey = (timestamp: string) => {
  const date = new Date(timestamp);
  const base = Number.isFinite(date.getTime()) ? date : new Date();
  base.setDate(base.getDate() + 1);
  return formatLocalDate(base);
};

// Returns a human-readable age label and whether the data is stale (from a previous day).
const getDataAge = (timestamp: string): { label: string; isStale: boolean } => {
  const then = new Date(timestamp);
  if (!Number.isFinite(then.getTime())) return { label: "unknown", isStale: true };
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffMins = diffMs / 60_000;
  const diffHours = diffMs / 3_600_000;
  const isStale = formatLocalDate(then) < formatLocalDate(now);
  let label: string;
  if (diffMins < 2) label = "just now";
  else if (diffHours < 1) label = `${Math.floor(diffMins)} min ago`;
  else if (diffHours < 2) label = "1 hr ago";
  else if (diffHours < 24) label = `${Math.floor(diffHours)} hrs ago`;
  else if (Math.floor(diffHours / 24) === 1) label = "yesterday";
  else label = `${Math.floor(diffHours / 24)} days ago`;
  return { label, isStale };
};

// An account needs a background refresh if it has active runnable strategies and
// the last refresh happened before today (or it has never been refreshed but was
// committed on a prior day, meaning there's real data to pull).
const isAccountDataStale = (account: PaperAccount): boolean => {
  const active = getActiveAppliedStrategies(account);
  if (active.length === 0) return false;
  const today = formatLocalDate(new Date());
  const lastRun = account.runs[0];
  if (!lastRun) return active.some((as) => getDateKeyFromTimestamp(as.appliedAt) < today);
  return getDateKeyFromTimestamp(lastRun.executedAt) < today;
};

// Backend BacktestError codes that mean "the window simply had no market data"
// — a benign outcome for a live update (e.g. applied today before any new bar).
const NO_DATA_BACKTEST_CODES = new Set([
  "no_data",
  "no_data_after_clip",
  "data_fetch_error",
]);

const formatWindowLabel = (timestamp?: string) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : timestamp;
};

const getTimestampMs = (timestamp: string) => {
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? value : null;
};

const compactEquityHistoryByDay = (history: PaperEquityPoint[]) => {
  const latestByDay = new Map<string, PaperEquityPoint & { timestampMs: number }>();

  for (const point of history) {
    const timestampMs = getTimestampMs(point.timestamp);
    if (timestampMs === null || !Number.isFinite(point.equity)) continue;

    const timestamp = new Date(timestampMs);
    const dayKey = formatLocalDate(timestamp);
    const existing = latestByDay.get(dayKey);

    if (!existing || timestampMs >= existing.timestampMs) {
      latestByDay.set(dayKey, {
        timestamp: timestamp.toISOString(),
        equity: point.equity,
        timestampMs,
      });
    }
  }

  return Array.from(latestByDay.values())
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map(({ timestampMs: _timestampMs, ...point }) => point);
};

const upsertEquityPointForDay = (history: PaperEquityPoint[], point: PaperEquityPoint) =>
  compactEquityHistoryByDay([...history, point]);

const getAppliedStrategyDelta = (strategy: AppliedPaperStrategy) =>
  strategy.currentValue - strategy.startingEquity;

const getActiveAppliedStrategies = (account: PaperAccount) =>
  account.appliedStrategies.filter((strategy) => strategy.active);

const getBalanceAfterStrategyValueChanges = (
  account: PaperAccount,
  nextAppliedStrategies: AppliedPaperStrategy[],
) => {
  const nextById = new Map(nextAppliedStrategies.map((strategy) => [strategy.id, strategy]));
  return account.appliedStrategies.reduce((balance, previousStrategy) => {
    const nextStrategy = nextById.get(previousStrategy.id);
    if (!nextStrategy) return balance;
    return balance - getAppliedStrategyDelta(previousStrategy) + getAppliedStrategyDelta(nextStrategy);
  }, account.currentBalance);
};

const createAppliedStrategyRecord = (
  strategy: SavedStrategy,
  account: PaperAccount,
  appliedAt = new Date().toISOString(),
): AppliedPaperStrategy => ({
  id: createId(),
  strategyId: strategy.id,
  strategyName: strategy.name,
  appliedAt,
  startDate: getDateKeyFromTimestamp(appliedAt),
  startingEquity: account.currentBalance,
  currentValue: account.currentBalance,
  active: true,
});

const withJsonDateframeWindow = (
  dslJson: Record<string, unknown>,
  startDate: string,
  payloadEndDate: string,
) => {
  const cloned = JSON.parse(JSON.stringify(dslJson)) as Record<string, unknown>;
  let touchedContext = false;

  STRATEGY_SIDES.forEach((side) => {
    const sideValue = cloned[side];
    if (!isObjectRecord(sideValue)) return;

    const context = isObjectRecord(sideValue.context) ? sideValue.context : {};
    const dateframe = isObjectRecord(context.dateframe) ? context.dateframe : {};

    sideValue.context = {
      ...context,
      dateframe: {
        ...dateframe,
        start: startDate,
        end: payloadEndDate,
      },
    };
    touchedContext = true;
  });

  if (!touchedContext && isObjectRecord(cloned.context)) {
    const context = cloned.context;
    const dateframe = isObjectRecord(context.dateframe) ? context.dateframe : {};
    cloned.context = {
      ...context,
      dateframe: {
        ...dateframe,
        start: startDate,
        end: payloadEndDate,
      },
    };
  }

  const topLevelDateframe = cloned.DATEFRAME;
  if (isObjectRecord(topLevelDateframe)) {
    cloned.DATEFRAME = {
      ...topLevelDateframe,
      start: startDate,
      end: payloadEndDate,
    };
  }

  return cloned;
};

const withTextDateframeWindow = (dslText: string, startDate: string, payloadEndDate: string) => {
  const nextDsl = dslText.replace(
    /:DATEFRAME\(\s*[^,)]+\s*,\s*[^)]+\)/i,
    `:DATEFRAME(${startDate}, ${payloadEndDate})`,
  );
  return nextDsl === dslText ? `:DATEFRAME(${startDate}, ${payloadEndDate})\n${dslText}` : nextDsl;
};

const serializeAccountsForStorage = (accounts: PaperAccount[]) =>
  accounts.map((account) => ({
    ...account,
    runs: account.runs.map(({ result, ...run }) => run),
  }));

const normalizeRun = (value: unknown): PaperStrategyRun | null => {
  if (!isObjectRecord(value)) return null;
  const result = isObjectRecord(value.result) ? (value.result as unknown as BacktestResult) : undefined;

  return {
    id:
      typeof value.id === "string"
        ? value.id
        : createId(),
    appliedStrategyId: typeof value.appliedStrategyId === "string" ? value.appliedStrategyId : undefined,
    strategyId: typeof value.strategyId === "number" ? value.strategyId : 0,
    strategyName: typeof value.strategyName === "string" ? value.strategyName : "Strategy",
    executedAt: typeof value.executedAt === "string" ? value.executedAt : new Date().toISOString(),
    mode: value.mode === "live" ? "live" : "manual",
    startDate: typeof value.startDate === "string" ? value.startDate : undefined,
    windowEnd: typeof value.windowEnd === "string" ? value.windowEnd : undefined,
    result,
    pctChange: typeof value.pctChange === "number" ? value.pctChange : 0,
    startingEquity: typeof value.startingEquity === "number" ? value.startingEquity : undefined,
    endingValue: typeof value.endingValue === "number" ? value.endingValue : undefined,
    pnl: typeof value.pnl === "number" ? value.pnl : undefined,
    tradeCount: typeof value.tradeCount === "number" ? value.tradeCount : 0,
    wins: typeof value.wins === "number" ? value.wins : 0,
    losses: typeof value.losses === "number" ? value.losses : 0,
    winRate: typeof value.winRate === "number" ? value.winRate : 0,
  };
};

const normalizeAppliedStrategy = (
  value: unknown,
  fallbackCurrentBalance: number,
  fallbackAppliedAt: string,
): AppliedPaperStrategy | null => {
  if (!isObjectRecord(value)) return null;
  const strategyId = typeof value.strategyId === "number" ? value.strategyId : null;
  if (strategyId === null) return null;

  const appliedAt = typeof value.appliedAt === "string" ? value.appliedAt : fallbackAppliedAt;
  const startingEquity =
    typeof value.startingEquity === "number" && Number.isFinite(value.startingEquity) && value.startingEquity > 0
      ? value.startingEquity
      : fallbackCurrentBalance;
  const currentValue =
    typeof value.currentValue === "number" && Number.isFinite(value.currentValue) && value.currentValue >= 0
      ? value.currentValue
      : startingEquity;

  return {
    id: typeof value.id === "string" ? value.id : createId(),
    strategyId,
    strategyName:
      typeof value.strategyName === "string" && value.strategyName.trim()
        ? value.strategyName
        : `Strategy ${strategyId}`,
    appliedAt,
    startDate:
      typeof value.startDate === "string" && value.startDate.trim()
        ? value.startDate
        : getDateKeyFromTimestamp(appliedAt),
    startingEquity,
    currentValue,
    active: typeof value.active === "boolean" ? value.active : typeof value.stoppedAt !== "string",
    stoppedAt: typeof value.stoppedAt === "string" ? value.stoppedAt : undefined,
    lastUpdatedAt: typeof value.lastUpdatedAt === "string" ? value.lastUpdatedAt : undefined,
    lastWindowEnd: typeof value.lastWindowEnd === "string" ? value.lastWindowEnd : undefined,
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

  const storedPerformanceHistory: PaperEquityPoint[] =
    Array.isArray(source.performanceHistory) && source.performanceHistory.length > 0
      ? compactEquityHistoryByDay(
          source.performanceHistory
            .filter(
              (point): point is PaperEquityPoint =>
                isObjectRecord(point) &&
                typeof point.timestamp === "string" &&
                typeof point.equity === "number" &&
                Number.isFinite(point.equity),
            )
            .map((point) => ({ timestamp: point.timestamp, equity: point.equity })),
        )
      : [];
  const performanceHistory =
    storedPerformanceHistory.length > 0 ? storedPerformanceHistory : [{ timestamp: createdAt, equity: startingBalance }];

  const normalizedRuns: PaperStrategyRun[] = Array.isArray(source.runs)
    ? source.runs.map((run) => normalizeRun(run)).filter((run): run is PaperStrategyRun => run !== null)
    : [];
  const fallbackAppliedAt = typeof source.updatedAt === "string" ? source.updatedAt : createdAt;
  const appliedStrategies: AppliedPaperStrategy[] = Array.isArray(source.appliedStrategies)
    ? source.appliedStrategies
        .map((strategy) => normalizeAppliedStrategy(strategy, currentBalance, fallbackAppliedAt))
        .filter((strategy): strategy is AppliedPaperStrategy => strategy !== null)
    : Array.isArray(source.appliedStrategyIds)
      ? source.appliedStrategyIds
          .filter((id): id is number => typeof id === "number")
          .map((strategyId) => {
            const lastRunForStrategy = normalizedRuns.find((run) => run.strategyId === strategyId);
            return {
              id: createId(),
              strategyId,
              strategyName: lastRunForStrategy?.strategyName ?? `Strategy ${strategyId}`,
              appliedAt: fallbackAppliedAt,
              startDate: getDateKeyFromTimestamp(fallbackAppliedAt),
              startingEquity: currentBalance,
              currentValue: currentBalance,
              active: true,
              lastUpdatedAt: lastRunForStrategy?.executedAt,
              lastWindowEnd: lastRunForStrategy?.windowEnd,
            };
          })
      : [];

  return {
    id:
      typeof source.id === "string"
        ? source.id
        : createId(),
    name: typeof source.name === "string" && source.name.trim() ? source.name : "Paper Account",
    description: typeof source.description === "string" ? source.description : "",
    startingBalance,
    currentBalance,
    createdAt,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : createdAt,
    appliedStrategies,
    runs: normalizedRuns,
    performanceHistory,
  };
};

const summarizeTradeOutcomes = (trades: TradeEntry[]): TradeOutcomeSummary => {
  // Direction-aware: a short strategy opens with SELL and closes with BUY.
  // The engine always closes the FULL position, so an exit settles every open
  // entry at once — compare against the average entry price.
  const directions = detectDirection(trades);
  const openEntries = new Map<string, number[]>();
  let wins = 0;
  let losses = 0;

  for (const trade of trades) {
    const dir = directions.get(trade.ticker) ?? "long";

    if (isEntryTrade(trade, dir)) {
      const entries = openEntries.get(trade.ticker) ?? [];
      entries.push(trade.price);
      openEntries.set(trade.ticker, entries);
      continue;
    }

    if (isExitTrade(trade, dir)) {
      const entries = openEntries.get(trade.ticker) ?? [];
      if (entries.length > 0) {
        const avgEntry = entries.reduce((sum, p) => sum + p, 0) / entries.length;
        const profitable = dir === "long" ? trade.price >= avgEntry : trade.price <= avgEntry;
        if (profitable) wins += 1;
        else losses += 1;
      }
      openEntries.delete(trade.ticker);
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

const createPaperRun = (
  strategy: SavedStrategy,
  result: BacktestResult,
  mode: PaperStrategyRun["mode"],
  executedAt: string,
  appliedStrategy?: AppliedPaperStrategy,
  windowStartAt?: string,
  windowStartingEquity?: number,
  windowEnd?: string,
): PaperStrategyRun => {
  const outcomes = summarizeTradeOutcomes(result.trades);
  const startingEquity = windowStartingEquity ?? appliedStrategy?.startingEquity;
  const endingValue = result.total_portfolio;

  return {
    id: createId(),
    appliedStrategyId: appliedStrategy?.id,
    strategyId: strategy.id,
    strategyName: strategy.name,
    executedAt,
    mode,
    startDate: windowStartAt ? getDateKeyFromTimestamp(windowStartAt) : appliedStrategy?.startDate,
    windowEnd,
    result,
    pctChange: result.pct_change,
    startingEquity,
    endingValue,
    pnl: typeof startingEquity === "number" ? endingValue - startingEquity : undefined,
    tradeCount: result.trades.length,
    wins: outcomes.wins,
    losses: outcomes.losses,
    winRate: outcomes.winRate,
  };
};

const PaperAccounts = () => {
  const { user } = useAuth();
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
  const [selectedApplyStrategyId, setSelectedApplyStrategyId] = useState<string>("");
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeAccountTab, setActiveAccountTab] = useState("overview");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountDialogMode, setAccountDialogMode] = useState<"create" | "edit">("create");
  const [accountName, setAccountName] = useState("");
  const [accountDescription, setAccountDescription] = useState("");
  const [accountStartingBalance, setAccountStartingBalance] = useState("10000");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [newStrategyDsl, setNewStrategyDsl] = useState("");
  const [isCreatingStrategy, setIsCreatingStrategy] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [justRefreshedId, setJustRefreshedId] = useState<string | null>(null);
  const saveWarningShown = useRef(false);
  const autoRefreshedRef = useRef(new Set<string>());
  const justRefreshedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useNavigate();
  const storageKey = useMemo(() => getStorageKey(user?.id), [user?.id]);

  // Persist the workspace server-side so it survives browser clears and follows
  // the user across devices. Saves are idempotent (full-document PUT), so the
  // occasional double-fire from a functional state update is harmless.
  const persistAccounts = useCallback((next: PaperAccount[]) => {
    api.savePaperAccounts(serializeAccountsForStorage(next)).catch((error) => {
      if (!saveWarningShown.current) {
        saveWarningShown.current = true;
        const msg = error instanceof Error ? error.message : "Couldn't save your paper account changes. Check your connection and try again.";
        toast.error(msg);
      }
    });
  }, []);

  const updateAccounts = useCallback(
    (updater: (previous: PaperAccount[]) => PaperAccount[]) => {
      setAccounts((previous) => {
        const next = updater(previous);
        persistAccounts(next);
        return next;
      });
    },
    [persistAccounts],
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
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setIsLoadingAccounts(true);
      try {
        let raw = await api.getPaperAccounts();

        // One-time migration: if the server has nothing yet but this browser
        // still holds legacy localStorage accounts, push them up so the user's
        // existing paper-trading history isn't lost in the move to server storage.
        if (!raw || raw.length === 0) {
          const legacy = localStorage.getItem(storageKey);
          if (legacy) {
            try {
              const parsed = JSON.parse(legacy);
              if (Array.isArray(parsed) && parsed.length > 0) {
                raw = parsed;
                await api.savePaperAccounts(parsed).catch(() => undefined);
                localStorage.removeItem(storageKey);
              }
            } catch {
              // ignore malformed legacy data
            }
          }
        }

        if (cancelled) return;
        const normalized = Array.isArray(raw) ? raw.map((account) => normalizeAccount(account)) : [];
        setAccounts(normalized);
        setSelectedAccountId(normalized[0]?.id ?? null);
      } catch (error) {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : "Couldn't load your paper accounts. Please refresh to try again.";
        toast.error(msg);
        setAccounts([]);
        setSelectedAccountId(null);
      } finally {
        if (!cancelled) setIsLoadingAccounts(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user, storageKey]);

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
    setActiveAccountTab("overview");
    if (!selectedAccount) {
      setSelectedRunId(null);
      return;
    }
    const runExists = selectedRunId ? selectedAccount.runs.some((run) => run.id === selectedRunId) : false;
    if (!runExists) {
      setSelectedRunId(selectedAccount.runs[0]?.id ?? null);
    }
  }, [selectedAccount?.id]);

  // Silently auto-refresh stale accounts when the user selects them or when
  // loading finishes. Runs at most once per account per page session (tracked via
  // autoRefreshedRef) so navigating away and back doesn't re-trigger.
  useEffect(() => {
    if (isLoadingAccounts || isLoadingStrategies || !selectedAccount || runningKey !== null) return;
    if (autoRefreshedRef.current.has(selectedAccount.id)) return;
    autoRefreshedRef.current.add(selectedAccount.id);
    if (!isAccountDataStale(selectedAccount)) return;
    const strategyById = new Map(strategies.map((s) => [s.id, s]));
    const hasRunnable = getActiveAppliedStrategies(selectedAccount).some((as) => strategyById.has(as.strategyId));
    if (hasRunnable) handleUpdateAccountToToday(selectedAccount.id, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount?.id, isLoadingAccounts, isLoadingStrategies]);

  const selectedRun = useMemo(() => {
    if (!selectedAccount) return null;
    return selectedAccount.runs.find((run) => run.id === selectedRunId) ?? selectedAccount.runs[0] ?? null;
  }, [selectedAccount, selectedRunId]);

  const selectedAccountStrategies = useMemo(() => {
    if (!selectedAccount) return [];
    const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
    return getActiveAppliedStrategies(selectedAccount).map((appliedStrategy) => ({
      appliedStrategy,
      strategy: strategyById.get(appliedStrategy.strategyId) ?? null,
    }));
  }, [selectedAccount, strategies]);

  const availableStrategiesToApply = useMemo(() => {
    if (!selectedAccount) return [];
    const activeStrategyIds = new Set(
      getActiveAppliedStrategies(selectedAccount).map((strategy) => strategy.strategyId),
    );
    return strategies.filter((strategy) => !activeStrategyIds.has(strategy.id));
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
    const todayKey = formatLocalDate(new Date());
    const todayRuns = selectedAccount.runs.filter((run) => isSameLocalDate(run.executedAt, todayKey));
    const todayStart = new Date(`${todayKey}T00:00:00`);
    const sortedHistory = [...selectedAccount.performanceHistory]
      .filter((point) => Number.isFinite(new Date(point.timestamp).getTime()) && Number.isFinite(point.equity))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const pointsBeforeToday = sortedHistory.filter((point) => new Date(point.timestamp) < todayStart);
    const todayBaseline =
      todayRuns.length > 0
        ? pointsBeforeToday.length > 0
          ? pointsBeforeToday[pointsBeforeToday.length - 1].equity
          : selectedAccount.startingBalance
        : selectedAccount.currentBalance;
    const todayPnl = todayRuns.length > 0 ? selectedAccount.currentBalance - todayBaseline : 0;
    const todayReturnPct = todayBaseline > 0 ? (todayPnl / todayBaseline) * 100 : 0;

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
      todayKey,
      todayRuns: todayRuns.length,
      todayLiveRuns: todayRuns.filter((run) => run.mode === "live").length,
      todayPnl,
      todayReturnPct,
      totalRuns: selectedAccount.runs.length,
      lastRunAt: selectedAccount.runs[0]?.executedAt ?? null,
      lastLiveUpdateAt: selectedAccount.runs.find((run) => run.mode === "live")?.executedAt ?? null,
    };
  }, [selectedAccount]);

  const equityChartData = useMemo(() => {
    if (!selectedAccount) return [];
    const sorted = compactEquityHistoryByDay(selectedAccount.performanceHistory);

    return sorted.map((point, index) => {
      const timestamp = new Date(point.timestamp);
      return {
        run: index + 1,
        label: formatChartDayLabel(timestamp),
        fullLabel: timestamp.toLocaleString(),
        equity: point.equity,
      };
    });
  }, [selectedAccount]);

  // Tighten the Y-axis to the actual equity range (with a little padding) instead of
  // anchoring at $0 — small day-to-day moves are otherwise squashed into a flat line.
  const equityDomain = useMemo<[number, number]>(() => {
    const values = equityChartData
      .map((point) => point.equity)
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) return [0, 1];

    const min = Math.min(...values);
    const max = Math.max(...values);

    if (min === max) {
      const padding = Math.max(1, Math.abs(min) * 0.02);
      return [min - padding, max + padding];
    }

    const padding = (max - min) * 0.08;
    return [Math.max(0, min - padding), max + padding];
  }, [equityChartData]);

  const runReturnsData = useMemo(() => {
    if (!selectedAccount || selectedAccount.runs.length === 0) return [];
    const dailyHistory = compactEquityHistoryByDay(selectedAccount.performanceHistory);
    const allDailyReturns = dailyHistory.map((point, index) => {
      const previousEquity = index > 0 ? dailyHistory[index - 1].equity : selectedAccount.startingBalance;
      const timestamp = new Date(point.timestamp);
      const returnPct = previousEquity > 0 ? ((point.equity - previousEquity) / previousEquity) * 100 : 0;

      return {
        run: index + 1,
        label: formatChartDayLabel(timestamp),
        fullLabel: `${timestamp.toLocaleString()} - ${formatMoney(point.equity)} equity`,
        returnPct,
        equity: point.equity,
      };
    });

    return allDailyReturns.slice(-20);
  }, [selectedAccount]);

  const runReturnDomain = useMemo<[number, number]>(() => {
    if (runReturnsData.length === 0) return [-1, 1];

    const values = runReturnsData.map((point) => point.returnPct);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);

    if (min === max) {
      const padding = Math.max(1, Math.abs(min) * 0.2);
      return [min - padding, max + padding];
    }

    const padding = Math.max(0.5, (max - min) * 0.15);
    return [min - padding, max + padding];
  }, [runReturnsData]);

  const recentRuns = useMemo(() => {
    if (!selectedAccount) return [];
    return selectedAccount.runs.slice(0, 8);
  }, [selectedAccount]);

  const selectedAccountLiveKey = selectedAccount ? `${selectedAccount.id}:live` : null;
  const isSelectedAccountLiveUpdating = selectedAccountLiveKey !== null && runningKey === selectedAccountLiveKey;

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
      const id = createId();
      const newAccount: PaperAccount = {
        id,
        name,
        description: accountDescription.trim(),
        startingBalance,
        currentBalance: startingBalance,
        createdAt: now,
        updatedAt: now,
        appliedStrategies: [],
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
            appliedStrategies: account.appliedStrategies.map((strategy) => ({
              ...strategy,
              startingEquity: strategy.startingEquity * scale,
              currentValue: strategy.currentValue * scale,
            })),
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
    const strategy = strategies.find((item) => item.id === strategyId);
    if (!strategy) return;
    const appliedStrategy = createAppliedStrategyRecord(strategy, selectedAccount);

    updateAccounts((previous) =>
      previous.map((account) =>
        account.id === selectedAccount.id
          ? {
              ...account,
              appliedStrategies: [appliedStrategy, ...account.appliedStrategies],
              updatedAt: new Date().toISOString(),
            }
          : account,
      ),
    );
    setSelectedApplyStrategyId("");
    toast.success("Strategy committed — your forward test starts from today. Hit Refresh to Today to see results.");
  };

  const handleRemoveAppliedStrategy = (appliedStrategyId: string) => {
    if (!selectedAccount) return;
    const now = new Date().toISOString();
    updateAccounts((previous) =>
      previous.map((account) =>
        account.id === selectedAccount.id
          ? {
              ...account,
              appliedStrategies: account.appliedStrategies.map((strategy) =>
                strategy.id === appliedStrategyId
                  ? {
                      ...strategy,
                      active: false,
                      stoppedAt: now,
                    }
                  : strategy,
              ),
              updatedAt: now,
            }
          : account,
      ),
    );
    toast.success("Strategy stopped for future updates");
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
        previous.map((account) => {
          const now = new Date().toISOString();
          return {
            ...account,
            appliedStrategies: account.appliedStrategies.map((appliedStrategy) =>
              appliedStrategy.strategyId === strategyId
                ? {
                    ...appliedStrategy,
                    active: false,
                    stoppedAt: appliedStrategy.stoppedAt ?? now,
                  }
                : appliedStrategy,
            ),
            updatedAt: now,
          };
        }),
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
                appliedStrategies: [createAppliedStrategyRecord(created, account), ...account.appliedStrategies],
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

  const persistStrategyResult = useCallback(async (strategyId: number, result: BacktestResult) => {
    try {
      const updated = await api.updateStrategy(strategyId, { lastResult: result });
      setStrategies((previous) => previous.map((item) => (item.id === strategyId ? updated : item)));
    } catch {
      setStrategies((previous) =>
        previous.map((item) =>
          item.id === strategyId ? { ...item, lastResult: result, lastRun: new Date().toISOString() } : item,
        ),
      );
    }
  }, []);

  const runStrategyBacktest = useCallback(
    async (
      strategy: SavedStrategy,
      initialBalance: number,
      windowStartAt: string,
      windowEndAt: string,
      liveToToday: boolean,
    ) => {
      // Use whole-day bounds: market data is daily/4h, so an intraday window
      // (e.g. applying then refreshing the same hour) contains no bars and errors.
      // Start at the application day; end at tomorrow (exclusive) to include today.
      const windowStart = getDateKeyFromTimestamp(windowStartAt);
      const windowEnd = liveToToday ? getNextDayDateKey(windowEndAt) : undefined;
      const requestOptions = {
        strategyId: liveToToday ? undefined : strategy.id,
        strategyName: strategy.name,
        initialBalance,
      };
      const dslJson = getStrategyDslJson(strategy);
      let result: BacktestResult;

      if (dslJson && Object.keys(dslJson).length > 0) {
        result = await api.backtestDSLJSON(
          windowEnd ? withJsonDateframeWindow(dslJson, windowStart, windowEnd) : dslJson,
          requestOptions,
        );
      } else if (strategy.dsl?.trim()) {
        result = await api.backtestDSLText(
          windowEnd ? withTextDateframeWindow(strategy.dsl, windowStart, windowEnd) : strategy.dsl,
          requestOptions,
        );
      } else {
        throw new Error("This strategy has no runnable conditions saved.");
      }

      await persistStrategyResult(strategy.id, result);
      return { result, windowEnd };
    },
    [persistStrategyResult],
  );

  const handleRunStrategy = async (accountId: string, appliedStrategyId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    const appliedStrategy = account?.appliedStrategies.find((item) => item.id === appliedStrategyId && item.active);
    const strategy = appliedStrategy ? strategies.find((item) => item.id === appliedStrategy.strategyId) : null;
    if (!account || !appliedStrategy || !strategy) return;

    const runKey = `${accountId}:${appliedStrategyId}`;
    setRunningKey(runKey);

    try {
      const now = new Date().toISOString();
      // Re-simulate the whole life of this strategy sleeve (application day → today)
      // from its original equity. Idempotent, so repeated refreshes don't compound.
      const windowStartAt = appliedStrategy.appliedAt;
      const windowStartingEquity = appliedStrategy.startingEquity;
      const { result, windowEnd } = await runStrategyBacktest(
        strategy,
        windowStartingEquity,
        windowStartAt,
        now,
        true,
      );
      const updatedAppliedStrategy: AppliedPaperStrategy = {
        ...appliedStrategy,
        strategyName: strategy.name,
        currentValue: result.total_portfolio,
        lastUpdatedAt: now,
        lastWindowEnd: windowEnd,
      };
      const run = createPaperRun(
        strategy,
        result,
        "live",
        now,
        updatedAppliedStrategy,
        windowStartAt,
        windowStartingEquity,
        windowEnd,
      );

      updateAccounts((previous) =>
        previous.map((item) => {
          if (item.id !== accountId) return item;
          const appliedStrategies = item.appliedStrategies.map((strategyItem) =>
            strategyItem.id === appliedStrategyId ? updatedAppliedStrategy : strategyItem,
          );
          const currentBalance = getBalanceAfterStrategyValueChanges(item, appliedStrategies);
          return {
            ...item,
            appliedStrategies,
            currentBalance,
            updatedAt: now,
            runs: [run, ...item.runs],
            performanceHistory: upsertEquityPointForDay(item.performanceHistory, {
              timestamp: now,
              equity: currentBalance,
            }),
          };
        }),
      );
      setSelectedRunId(run.id);
      toast.success(
        `Forward test updated for "${strategy.name}" — ${formatWindowLabel(windowStartAt)} through ${formatWindowLabel(windowEnd) || "today"}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code && NO_DATA_BACKTEST_CODES.has(error.code)) {
        // No market data yet — still stamp lastUpdatedAt so the "Not yet refreshed" nudge clears.
        const now = new Date().toISOString();
        updateAccounts((previous) =>
          previous.map((item) => {
            if (item.id !== accountId) return item;
            return {
              ...item,
              appliedStrategies: item.appliedStrategies.map((s) =>
                s.id === appliedStrategyId ? { ...s, lastUpdatedAt: now } : s,
              ),
            };
          }),
        );
        toast.info("No new market data yet. Results will appear after the next market close.");
      } else {
        const message = error instanceof Error ? error.message : "Unable to execute strategy";
        toast.error(message);
      }
    } finally {
      setRunningKey(null);
    }
  };

  const handleUpdateAccountToToday = async (accountId: string, silent = false) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;

    const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
    const appliedStrategies = getActiveAppliedStrategies(account);
    const runnableStrategies = appliedStrategies
      .map((appliedStrategy) => ({
        appliedStrategy,
        strategy: strategyById.get(appliedStrategy.strategyId) ?? null,
      }))
      .filter(
        (item): item is { appliedStrategy: AppliedPaperStrategy; strategy: SavedStrategy } =>
          item.strategy !== null,
      );

    if (runnableStrategies.length === 0) {
      toast.error("Add at least one strategy before refreshing your forward test.");
      return;
    }

    const runKey = `${accountId}:live`;
    setRunningKey(runKey);

    try {
      let nextAppliedStrategies = account.appliedStrategies;
      const newRuns: PaperStrategyRun[] = [];
      let skippedNoData = 0;

      for (const { appliedStrategy, strategy } of runnableStrategies) {
        const executedAt = new Date().toISOString();
        // Full idempotent re-simulation from the application day to today.
        const windowStartAt = appliedStrategy.appliedAt;
        const windowStartingEquity = appliedStrategy.startingEquity;
        let result: BacktestResult;
        let windowEnd: string | undefined;
        try {
          ({ result, windowEnd } = await runStrategyBacktest(
            strategy,
            windowStartingEquity,
            windowStartAt,
            executedAt,
            true,
          ));
        } catch (error) {
          if (error instanceof ApiError && error.code && NO_DATA_BACKTEST_CODES.has(error.code)) {
            skippedNoData += 1;
            // Still stamp lastUpdatedAt so the "Not yet refreshed" nudge clears.
            nextAppliedStrategies = nextAppliedStrategies.map((s) =>
              s.id === appliedStrategy.id ? { ...s, lastUpdatedAt: executedAt } : s,
            );
            continue;
          }
          throw error;
        }
        const updatedAppliedStrategy: AppliedPaperStrategy = {
          ...appliedStrategy,
          strategyName: strategy.name,
          currentValue: result.total_portfolio,
          lastUpdatedAt: executedAt,
          lastWindowEnd: windowEnd,
        };
        const run = createPaperRun(
          strategy,
          result,
          "live",
          executedAt,
          updatedAppliedStrategy,
          windowStartAt,
          windowStartingEquity,
          windowEnd,
        );
        nextAppliedStrategies = nextAppliedStrategies.map((strategyItem) =>
          strategyItem.id === appliedStrategy.id ? updatedAppliedStrategy : strategyItem,
        );
        newRuns.push(run);
      }

      if (newRuns.length === 0) {
        // Even with no new data, persist the lastUpdatedAt stamps so nudges clear.
        if (skippedNoData > 0) {
          updateAccounts((previous) =>
            previous.map((item) =>
              item.id !== accountId
                ? item
                : { ...item, appliedStrategies: nextAppliedStrategies, updatedAt: new Date().toISOString() },
            ),
          );
        }
        if (!silent) toast.info(
          skippedNoData > 0
            ? "No new market data yet. Results will appear after the next market close."
            : "Nothing to update yet.",
        );
        // Still flip the button to "✓ Up to date" so it doesn't sit there.
        if (justRefreshedTimerRef.current) clearTimeout(justRefreshedTimerRef.current);
        setJustRefreshedId(accountId);
        justRefreshedTimerRef.current = setTimeout(
          () => setJustRefreshedId((prev) => (prev === accountId ? null : prev)),
          3000,
        );
        return;
      }

      const updatedAt = new Date().toISOString();
      updateAccounts((previous) =>
        previous.map((item) => {
          if (item.id !== accountId) return item;
          const currentBalance = getBalanceAfterStrategyValueChanges(item, nextAppliedStrategies);
          return {
            ...item,
            appliedStrategies: nextAppliedStrategies,
            currentBalance,
            updatedAt,
            runs: [...newRuns].reverse().concat(item.runs),
            performanceHistory: upsertEquityPointForDay(item.performanceHistory, {
              timestamp: updatedAt,
              equity: currentBalance,
            }),
          };
        }),
      );
      setSelectedRunId(newRuns[newRuns.length - 1]?.id ?? null);
      if (!silent) toast.success(
        `Forward test refreshed for ${newRuns.length} ${newRuns.length === 1 ? "strategy" : "strategies"} through today.` +
          (skippedNoData > 0 ? ` ${skippedNoData} had no new market data yet.` : ""),
      );
      // Drive the "✓ Up to date" button state for 3 s after a successful refresh.
      if (justRefreshedTimerRef.current) clearTimeout(justRefreshedTimerRef.current);
      setJustRefreshedId(accountId);
      justRefreshedTimerRef.current = setTimeout(
        () => setJustRefreshedId((prev) => (prev === accountId ? null : prev)),
        3000,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update paper account";
      toast.error(message);
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <>
      <DashboardLayout
        title="Paper Accounts"
        metaDescription="Create and manage paper trading accounts, apply strategies, inspect trades, and track all-time performance."
        maxWidth="max-w-[1500px]"
      >
        <PageHeader
          icon={Rocket}
          eyebrow="Forward testing"
          title="Paper Accounts"
          description="Commit strategies from a set date, refresh to pull in real market data, and track your forward-tested equity over time."
          actions={
            <Button variant="hero" onClick={openCreateAccountDialog}>
              <Plus className="mr-2 h-4 w-4" />
              New Account
            </Button>
          }
        />

            <RiskDisclaimer />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="glass-card border-border/70">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Account Book</CardTitle>
                  <CardDescription>Each account runs independently — commit different strategies and track their real-market performance separately.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingAccounts ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="h-20 animate-pulse rounded-xl bg-secondary/40" />
                      ))}
                    </div>
                  ) : accounts.length === 0 ? (
                    <div className="space-y-4 rounded-xl border border-dashed border-border p-5">
                      <div className="text-center">
                        <Rocket className="mx-auto mb-2 h-8 w-8 text-primary/70" />
                        <p className="font-semibold text-sm">Start forward testing</p>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          Run your backtested strategies on real market data — from a date you commit to, forward through today.
                        </p>
                      </div>
                      <div className="space-y-2">
                        {[
                          { n: 1, label: "Create an account", sub: "Set a name and starting balance" },
                          { n: 2, label: "Apply a saved strategy", sub: "Commits it from today's date" },
                          { n: 3, label: "Refresh to Today", sub: "Pulls real market data through now" },
                        ].map(({ n, label, sub }) => (
                          <div key={n} className="flex items-start gap-3 rounded-lg bg-secondary/30 px-3 py-2">
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${n === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{n}</span>
                            <div>
                              <p className="text-xs font-medium">{label}</p>
                              <p className="text-xs text-muted-foreground">{sub}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" className="w-full" onClick={openCreateAccountDialog}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Your First Account
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
                            <div
                              key={account.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedAccountId(account.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedAccountId(account.id);
                                }
                              }}
                              className={`w-full cursor-pointer rounded-xl border p-4 text-left transition-colors ${
                                isSelected
                                  ? "border-primary/40 bg-primary/10"
                                  : "border-border bg-background/40 hover:bg-background/70"
                              }`}
                            >
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {isAccountDataStale(account) && (
                                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Data is stale — will auto-refresh when selected" />
                                    )}
                                    <p className="line-clamp-1 font-semibold">{account.name}</p>
                                  </div>
                                  {account.description && (
                                    <p className="line-clamp-1 text-xs text-muted-foreground">{account.description}</p>
                                  )}
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

                              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-md border border-border bg-background/70 p-2">
                                  <p className="text-muted-foreground">Equity</p>
                                  <p className="font-mono font-semibold">{formatMoney(account.currentBalance)}</p>
                                </div>
                                <div className="rounded-md border border-border bg-background/70 p-2">
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
                              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                                <span>{getActiveAppliedStrategies(account).length} {getActiveAppliedStrategies(account).length === 1 ? "strategy" : "strategies"} active</span>
                                <span>{account.runs.length} {account.runs.length === 1 ? "refresh" : "refreshes"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              {!selectedAccount || !selectedAccountMetrics ? (
                <Card className="border-dashed bg-card/40">
                  <CardContent className="space-y-2 py-20 text-center">
                    <Rocket className="mx-auto h-10 w-10 text-muted-foreground" />
                    <p className="text-sm font-medium">Select an account to get started</p>
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                      Choose an account on the left to view its equity curve, applied strategies, and forward test results.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  <Card className="relative overflow-hidden border-border bg-card/70">
                    <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
                    <CardHeader className="relative z-10 pb-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-2xl">{selectedAccount.name}</CardTitle>
                            <Badge variant="outline" className="text-xs">
                              Active since {new Date(selectedAccount.createdAt).toLocaleDateString()}
                            </Badge>
                          </div>
                          <CardDescription>
                            {selectedAccount.description || "Forward testing account — strategies track real market performance from the day they were committed."}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const lastRun = selectedAccount.runs[0];
                            const age = lastRun ? getDataAge(lastRun.executedAt) : null;
                            const isJustRefreshed = justRefreshedId === selectedAccount.id;
                            return (
                              <>
                                {age && (
                                  <span className={`hidden text-xs sm:inline ${age.isStale && !isSelectedAccountLiveUpdating && !isJustRefreshed ? "text-amber-500" : "text-muted-foreground"}`}>
                                    {isSelectedAccountLiveUpdating ? "Refreshing…" : isJustRefreshed ? "✓ Up to date" : `Data from ${age.label}`}
                                  </span>
                                )}
                                <Button
                                  onClick={() => handleUpdateAccountToToday(selectedAccount.id)}
                                  disabled={isSelectedAccountLiveUpdating || runningKey !== null || selectedAccountStrategies.length === 0 || isJustRefreshed}
                                  variant={isJustRefreshed ? "outline" : "default"}
                                  title="Re-runs all committed strategies against real market data from their commitment date through today"
                                >
                                  {isSelectedAccountLiveUpdating ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Refreshing…</>
                                  ) : isJustRefreshed ? (
                                    <><CheckCircle2 className="mr-2 h-4 w-4 text-success" />Up to date</>
                                  ) : (
                                    <><RefreshCw className="mr-2 h-4 w-4" />Refresh to Today</>
                                  )}
                                </Button>
                              </>
                            );
                          })()}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon" title="Account options">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditAccountDialog(selectedAccount)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit account
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDeleteAccount(selectedAccount.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete account
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const hasData = selectedAccount.runs.length > 0;
                        const lastRun = selectedAccount.runs[0];
                        const age = lastRun ? getDataAge(lastRun.executedAt) : null;
                        const m = selectedAccountMetrics;
                        const Stat = ({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color?: string }) => (
                          <div className="rounded-lg border border-border bg-background/60 p-3">
                            <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Icon className="h-3.5 w-3.5" />{label}
                            </p>
                            <p className={`font-mono text-lg font-semibold ${color ?? ""}`}>{value}</p>
                            {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
                          </div>
                        );
                        return (
                          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                            <div className="rounded-lg border border-border bg-background/60 p-3">
                              <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <Wallet className="h-3.5 w-3.5" />Equity
                              </p>
                              <p className="font-mono text-lg font-semibold">{formatMoney(selectedAccount.currentBalance)}</p>
                              {age && (
                                <p className={`mt-0.5 text-[10px] ${age.isStale && !isSelectedAccountLiveUpdating ? "text-amber-500" : "text-muted-foreground"}`}>
                                  {isSelectedAccountLiveUpdating ? "updating…" : age.isStale ? `${age.label} — stale` : `as of ${new Date(lastRun!.executedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                                </p>
                              )}
                            </div>
                            <Stat
                              icon={TrendingUp}
                              label="Total Return"
                              value={hasData ? `${m.totalReturnPct >= 0 ? "+" : ""}${m.totalReturnPct.toFixed(2)}%` : "—"}
                              color={hasData ? (m.totalReturnPct > 0 ? "text-success" : m.totalReturnPct < 0 ? "text-destructive" : "") : "text-muted-foreground"}
                            />
                            <Stat
                              icon={Activity}
                              label="Today's P&L"
                              value={hasData && m.todayPnl !== 0 ? formatSignedMoney(m.todayPnl) : hasData ? "—" : "—"}
                              sub={hasData && m.todayPnl !== 0 ? `${m.todayReturnPct >= 0 ? "+" : ""}${m.todayReturnPct.toFixed(2)}%` : undefined}
                              color={hasData && m.todayPnl !== 0 ? (m.todayPnl > 0 ? "text-success" : "text-destructive") : "text-muted-foreground"}
                            />
                            <Stat
                              icon={LineChart}
                              label="All-Time High"
                              value={hasData ? formatMoney(m.allTimeHigh) : "—"}
                              color={hasData ? "" : "text-muted-foreground"}
                            />
                            <Stat
                              icon={TrendingDown}
                              label="Drawdown"
                              value={hasData ? `${m.drawdownPct.toFixed(2)}%` : "—"}
                              color={hasData && m.drawdownPct < 0 ? "text-destructive" : hasData ? "" : "text-muted-foreground"}
                            />
                            <Stat
                              icon={Target}
                              label="Win Rate"
                              value={hasData && m.totalTrades > 0 ? `${m.allTimeWinRate.toFixed(1)}%` : "—"}
                              sub={hasData && m.totalTrades > 0 ? `${m.totalTrades} trades` : undefined}
                              color={hasData && m.totalTrades > 0 ? (m.allTimeWinRate >= 50 ? "text-success" : "text-destructive") : "text-muted-foreground"}
                            />
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  <Tabs value={activeAccountTab} onValueChange={setActiveAccountTab} className="w-full" key={selectedAccount.id}>
                    <TabsList className="flex w-full justify-start overflow-x-auto md:inline-flex md:w-auto mb-4 border border-border bg-card/50 p-1">
                      <TabsTrigger value="overview" className="data-[state=active]:bg-primary/20">
                        Overview
                      </TabsTrigger>
                      <TabsTrigger value="strategies" className="data-[state=active]:bg-primary/20">
                        Strategies
                      </TabsTrigger>
                      <TabsTrigger value="activity" className="data-[state=active]:bg-primary/20">
                        Results
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                      {/* Contextual setup guide — disappears once the account has been refreshed */}
                      {selectedAccount.runs.length === 0 && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                          <p className="mb-3 text-sm font-semibold text-primary">
                            {selectedAccountStrategies.length === 0 ? "Step 1 of 2 — Apply a strategy" : "Step 2 of 2 — Refresh to see your results"}
                          </p>
                          {selectedAccountStrategies.length === 0 ? (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-sm text-muted-foreground">
                                Go to the <span className="font-medium text-foreground">Strategy Deck</span> tab to apply one of your saved backtested strategies. That locks in today as the commitment date — all forward test results will measure from that point.
                              </p>
                              <Button size="sm" className="shrink-0" onClick={() => setActiveAccountTab("strategies")}>
                                Go to Strategy Deck →
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-sm text-muted-foreground">
                                You have {selectedAccountStrategies.length} {selectedAccountStrategies.length === 1 ? "strategy" : "strategies"} committed. Hit <span className="font-medium text-foreground">Refresh to Today</span> above to run it against real market data and see your first forward test result.
                              </p>
                              <Button
                                size="sm"
                                className="shrink-0"
                                onClick={() => handleUpdateAccountToToday(selectedAccount.id)}
                                disabled={isSelectedAccountLiveUpdating || runningKey !== null || justRefreshedId === selectedAccount.id}
                              >
                                {isSelectedAccountLiveUpdating ? (
                                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Refreshing…</>
                                ) : justRefreshedId === selectedAccount.id ? (
                                  <><CheckCircle2 className="mr-2 h-3.5 w-3.5 text-success" />Up to date</>
                                ) : (
                                  <><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh to Today</>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <Card className="border-border bg-card/60">
                          <CardHeader>
                            <CardTitle className="text-lg">Equity Trajectory</CardTitle>
                            <CardDescription>Account value from the latest saved update on each day.</CardDescription>
                          </CardHeader>
                          <CardContent className="h-[340px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={equityChartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="paperEquityFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={safeColor(chartColors.areaTop, "hsl(var(--primary))")} stopOpacity={0.35} />
                                    <stop offset="95%" stopColor={safeColor(chartColors.areaBottom, "hsl(var(--primary))")} stopOpacity={0.02} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke={colorWithAlpha(chartColors.grid, 0.5, "hsl(var(--border))")} />
                                <XAxis
                                  dataKey="label"
                                  stroke="hsl(var(--muted-foreground))"
                                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                                />
                                <YAxis
                                  domain={equityDomain}
                                  allowDecimals={false}
                                  stroke="hsl(var(--muted-foreground))"
                                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                                  tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
                                  width={88}
                                />
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: "hsl(var(--card))",
                                    border: "1px solid hsl(var(--border))",
                                  }}
                                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                                  formatter={(value: number) => [formatMoney(value), "Equity"]}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="equity"
                                  stroke={safeColor(chartColors.line, "hsl(var(--primary))")}
                                  strokeWidth={2.5}
                                  fill="url(#paperEquityFill)"
                                  dot={false}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>

                        <Card className="border-border bg-card/60">
                          <CardHeader>
                            <CardTitle className="text-lg">Daily P&L</CardTitle>
                            <CardDescription>Day-by-day return across the full forward test period.</CardDescription>
                          </CardHeader>
                          <CardContent className="h-[340px]">
                            {runReturnsData.length === 0 ? (
                              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                                Refresh a strategy to start building your forward test record.
                              </div>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={runReturnsData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke={colorWithAlpha(chartColors.grid, 0.5, "hsl(var(--border))")} />
                                  <XAxis
                                    dataKey="label"
                                    stroke="hsl(var(--muted-foreground))"
                                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                                    minTickGap={16}
                                  />
                                  <YAxis
                                    domain={runReturnDomain}
                                    stroke="hsl(var(--muted-foreground))"
                                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                                    tickFormatter={(value) => `${value.toFixed(0)}%`}
                                  />
                                  <Tooltip
                                    contentStyle={{
                                      backgroundColor: "hsl(var(--card))",
                                      border: "1px solid hsl(var(--border))",
                                    }}
                                    formatter={(value: number) => [`${value.toFixed(2)}%`, "Return"]}
                                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                                  />
                                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.55} />
                                  <Bar dataKey="returnPct" minPointSize={4} radius={[4, 4, 0, 0]}>
                                    {runReturnsData.map((entry, index) => (
                                      <Cell
                                        key={`${entry.label}-${index}`}
                                        fill={entry.returnPct >= 0 ? safeColor(chartColors.candleUp, "hsl(var(--success))") : safeColor(chartColors.candleDown, "hsl(var(--destructive))")}
                                      />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </CardContent>
                        </Card>
                      </div>

                      {(() => {
                        const latestRun = selectedAccount.runs[0] ?? null;
                        return (
                          <Card className="border-border bg-card/60">
                            <CardHeader className="flex flex-row items-start justify-between space-y-0">
                              <div>
                                <CardTitle className="text-lg">Current Forward Test</CardTitle>
                                <CardDescription>
                                  {latestRun
                                    ? `Last refreshed ${new Date(latestRun.executedAt).toLocaleString()}${latestRun.windowEnd ? ` · through ${formatWindowLabel(latestRun.windowEnd)}` : ""}`
                                    : "Refresh a strategy to see your live forward test results here."}
                                </CardDescription>
                              </div>
                              {latestRun && (
                                <Badge
                                  variant="outline"
                                  className={latestRun.pctChange >= 0 ? "border-success/40 bg-success/10 text-success text-sm font-semibold" : "border-destructive/40 bg-destructive/10 text-destructive text-sm font-semibold"}
                                >
                                  {latestRun.pctChange >= 0 ? "+" : ""}{latestRun.pctChange.toFixed(2)}%
                                </Badge>
                              )}
                            </CardHeader>
                            <CardContent>
                              {latestRun ? (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                  <div className="rounded-lg border border-border bg-background/60 p-3">
                                    <p className="text-xs text-muted-foreground">Strategy</p>
                                    <p className="font-semibold text-sm truncate">{latestRun.strategyName}</p>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/60 p-3">
                                    <p className="text-xs text-muted-foreground">Trades</p>
                                    <p className="font-mono font-semibold">{latestRun.tradeCount}</p>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/60 p-3">
                                    <p className="text-xs text-muted-foreground">Win Rate</p>
                                    <p className={`font-mono font-semibold ${latestRun.winRate >= 50 ? "text-success" : "text-destructive"}`}>
                                      {latestRun.winRate.toFixed(1)}%
                                    </p>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/60 p-3">
                                    <p className="text-xs text-muted-foreground">Full Detail</p>
                                    <button
                                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                                      onClick={() => setActiveAccountTab("activity")}
                                    >
                                      View in log →
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                                  {(() => {
                                    const active = getActiveAppliedStrategies(selectedAccount);
                                    if (active.length === 0) return <>Go to the <span className="font-medium text-foreground">Strategies</span> tab to commit a strategy to this account.</>;
                                    if (active.some((s) => s.lastUpdatedAt)) return <>No trades taken yet — your strategy is tracking live and results will appear once entry conditions are met.</>;
                                    return <>Hit <span className="font-medium text-foreground">Refresh to Today</span> above to run your first forward test.</>;
                                  })()}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })()}
                    </TabsContent>

                    <TabsContent value="strategies" className="space-y-6">
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <Card className="border-border bg-card/60">
                          <CardHeader>
                            <CardTitle className="text-lg">Apply a Saved Strategy</CardTitle>
                            <CardDescription>
                              Commits a strategy from today — all forward test results measure from this date onward.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {availableStrategiesToApply.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-border p-4 text-center space-y-2">
                                <p className="text-sm text-muted-foreground">No saved strategies yet.</p>
                                <p className="text-xs text-muted-foreground">
                                  Run a backtest on the <span className="font-medium text-foreground">Backtest</span> page, save it as a strategy, then come back here to apply it.
                                </p>
                                <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/strategies")}>
                                  Go to Strategies →
                                </Button>
                              </div>
                            ) : (
                              <>
                                <Select value={selectedApplyStrategyId} onValueChange={setSelectedApplyStrategyId}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Choose a saved strategy" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableStrategiesToApply.map((strategy) => (
                                      <SelectItem key={strategy.id} value={strategy.id.toString()}>
                                        {strategy.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button onClick={handleApplyStrategy} disabled={!selectedApplyStrategyId}>
                                  <Plus className="mr-2 h-4 w-4" />
                                  Commit Strategy from Today
                                </Button>
                              </>
                            )}
                          </CardContent>
                        </Card>

                        <Card className="border-border bg-card/60">
                          <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                              Advanced — Paste Raw Strategy
                              <Badge variant="secondary" className="text-xs font-normal">Power users</Badge>
                            </CardTitle>
                            <CardDescription>
                              Paste a strategy DSL directly if you have one. Most users should use the Strategies page and apply from there.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <Input
                              placeholder="Strategy name"
                              value={newStrategyName}
                              onChange={(event) => setNewStrategyName(event.target.value)}
                            />
                            <Textarea
                              placeholder='Paste the strategy JSON from a saved backtest (e.g. {"LONG": {...}})'
                              value={newStrategyDsl}
                              onChange={(event) => setNewStrategyDsl(event.target.value)}
                              className="min-h-[120px] font-mono text-xs"
                            />
                            <Button onClick={handleCreateStrategyInAccount} disabled={isCreatingStrategy}>
                              {isCreatingStrategy ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Creating
                                </>
                              ) : (
                                <>
                                  <Plus className="mr-2 h-4 w-4" />
                                  Save & Apply
                                </>
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="border-border bg-card/60">
                        <CardHeader>
                          <CardTitle className="text-lg">Applied Strategy Deck</CardTitle>
                          <CardDescription>Each strategy is forward-tested from its commitment date using real market data. Refresh to update through today.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {selectedAccountStrategies.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-1">
                              <p className="text-sm font-medium">No strategies committed yet</p>
                              <p className="text-xs text-muted-foreground">Use "Apply a Saved Strategy" above to commit one from today. Your forward test starts the moment you apply it.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {selectedAccountStrategies.map(({ appliedStrategy, strategy }) => {
                                const key = `${selectedAccount.id}:${appliedStrategy.id}`;
                                const isRunning = runningKey === key;
                                const lastResult = strategy?.lastResult;
                                const strategyName = strategy?.name ?? appliedStrategy.strategyName;
                                const sleevePnl = getAppliedStrategyDelta(appliedStrategy);
                                const sleeveReturn =
                                  appliedStrategy.startingEquity > 0
                                    ? (sleevePnl / appliedStrategy.startingEquity) * 100
                                    : 0;

                                return (
                                  <div
                                    key={appliedStrategy.id}
                                    className="flex flex-col gap-4 rounded-xl border border-border bg-background/50 p-4 lg:flex-row lg:items-center lg:justify-between"
                                  >
                                    <div className="min-w-0 flex-1 space-y-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-semibold">{strategyName}</p>
                                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">
                                          Tracking
                                        </Badge>
                                        <Badge variant="outline" className="text-xs">
                                          Committed {new Date(appliedStrategy.appliedAt).toLocaleDateString()}
                                        </Badge>
                                        {lastResult?.pct_change !== undefined && (
                                          <Badge
                                            variant="outline"
                                            className={
                                              lastResult.pct_change >= 0
                                                ? "border-success/40 bg-success/10 text-success"
                                                : "border-destructive/40 bg-destructive/10 text-destructive"
                                            }
                                          >
                                            {lastResult.pct_change >= 0 ? "+" : ""}
                                            {lastResult.pct_change.toFixed(2)}%
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                                        <div className="rounded-md border border-border bg-background/70 p-2">
                                          <p className="text-muted-foreground">Started with</p>
                                          <p className="font-mono font-semibold">
                                            {formatMoney(appliedStrategy.startingEquity)}
                                          </p>
                                        </div>
                                        <div className="rounded-md border border-border bg-background/70 p-2">
                                          <p className="text-muted-foreground">Current value</p>
                                          <p className="font-mono font-semibold">
                                            {appliedStrategy.lastUpdatedAt ? formatMoney(appliedStrategy.currentValue) : "—"}
                                          </p>
                                        </div>
                                        <div className="rounded-md border border-border bg-background/70 p-2">
                                          <p className="text-muted-foreground">P&L</p>
                                          {appliedStrategy.lastUpdatedAt ? (
                                            <p className={`font-mono font-semibold ${sleevePnl > 0 ? "text-success" : sleevePnl < 0 ? "text-destructive" : ""}`}>
                                              {formatSignedMoney(sleevePnl)}{" "}
                                              <span className="text-muted-foreground">({sleeveReturn >= 0 ? "+" : ""}{sleeveReturn.toFixed(2)}%)</span>
                                            </p>
                                          ) : (
                                            <p className="font-mono font-semibold text-muted-foreground">—</p>
                                          )}
                                        </div>
                                      </div>
                                      {strategy ? (
                                        <div className="overflow-hidden rounded-lg">
                                          <StrategySummary dsl={getStrategyDslJson(strategy)} />
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">Saved strategy is no longer available.</p>
                                      )}
                                      <p className="text-xs text-muted-foreground">
                                        {appliedStrategy.lastUpdatedAt
                                          ? <>Last refreshed {new Date(appliedStrategy.lastUpdatedAt).toLocaleString()}{appliedStrategy.lastWindowEnd ? ` · through ${formatWindowLabel(appliedStrategy.lastWindowEnd)}` : ""}</>
                                          : <span className="text-amber-500/80">Not yet refreshed — hit <span className="font-medium">Refresh to Today</span> above to see results</span>
                                        }
                                      </p>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleRunStrategy(selectedAccount.id, appliedStrategy.id)}
                                        disabled={runningKey !== null || !strategy}
                                      >
                                        {isRunning ? (
                                          <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Updating
                                          </>
                                        ) : (
                                          <>
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                            {appliedStrategy.lastUpdatedAt ? "Refresh" : "Run First Test"}
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleRemoveAppliedStrategy(appliedStrategy.id)}
                                      >
                                        Stop Tracking
                                      </Button>
                                      {strategy && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="text-destructive hover:text-destructive"
                                          onClick={() => handleDeleteStrategyEverywhere(strategy.id)}
                                        >
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          Delete
                                        </Button>
                                      )}
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
                      {(() => {
                        const latestRun = selectedAccount.runs[0] ?? null;
                        if (!latestRun) {
                          const activeStrategies = getActiveAppliedStrategies(selectedAccount);
                          const hasEverRefreshed = activeStrategies.some((s) => s.lastUpdatedAt);
                          return (
                            <Card className="border-border bg-card/60">
                              <CardContent className="space-y-3 py-16 text-center">
                                <Play className="mx-auto h-10 w-10 text-muted-foreground" />
                                {activeStrategies.length === 0 ? (
                                  <>
                                    <p className="text-sm font-medium">No strategies committed yet</p>
                                    <p className="text-sm text-muted-foreground">
                                      Go to the <span className="font-medium text-foreground">Strategies</span> tab to commit a strategy to this account, then hit{" "}
                                      <span className="font-medium text-foreground">Refresh to Today</span> to start tracking.
                                    </p>
                                  </>
                                ) : hasEverRefreshed ? (
                                  <>
                                    <p className="text-sm font-medium">No trades taken yet</p>
                                    <p className="text-sm text-muted-foreground">
                                      Your strategy is tracking live but hasn't triggered any entries yet. Results will appear here once the entry conditions are met.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-sm font-medium">Ready to start tracking</p>
                                    <p className="text-sm text-muted-foreground">
                                      Hit <span className="font-medium text-foreground">Refresh to Today</span> above to run your first forward test and see the trade log here.
                                    </p>
                                  </>
                                )}
                              </CardContent>
                            </Card>
                          );
                        }
                        return (
                          <>
                            <Card className="border-border bg-card/60">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-base">{latestRun.strategyName}</CardTitle>
                                <CardDescription>
                                  Forward test covering <span className="text-foreground font-medium">{latestRun.startDate ? formatWindowLabel(latestRun.startDate) : "commitment date"}</span> through <span className="text-foreground font-medium">{latestRun.windowEnd ? formatWindowLabel(latestRun.windowEnd) : "today"}</span>
                                  {" · "}last refreshed {new Date(latestRun.executedAt).toLocaleString()}
                                </CardDescription>
                              </CardHeader>
                              <CardContent>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                  <div className="rounded-lg border border-border bg-background/70 p-3">
                                    <p className="text-xs text-muted-foreground">Total Return</p>
                                    <p className={`font-mono font-semibold ${latestRun.pctChange >= 0 ? "text-success" : "text-destructive"}`}>
                                      {latestRun.pctChange >= 0 ? "+" : ""}{latestRun.pctChange.toFixed(2)}%
                                    </p>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/70 p-3">
                                    <p className="text-xs text-muted-foreground">Trades</p>
                                    <p className="font-mono font-semibold">{latestRun.tradeCount}</p>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/70 p-3">
                                    <p className="text-xs text-muted-foreground">Win Rate</p>
                                    <p className={`font-mono font-semibold ${latestRun.winRate >= 50 ? "text-success" : "text-destructive"}`}>
                                      {latestRun.winRate.toFixed(1)}%
                                    </p>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/70 p-3">
                                    <p className="text-xs text-muted-foreground">P&L</p>
                                    <p className={`font-mono font-semibold ${(latestRun.pnl ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                                      {(latestRun.pnl ?? 0) >= 0 ? "+" : ""}{formatMoney(latestRun.pnl ?? 0)}
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>

                            {latestRun.result ? (
                              <Tabs defaultValue="numerical" className="w-full" key={latestRun.id}>
                                <TabsList className="flex w-full justify-start overflow-x-auto md:inline-flex md:w-auto border border-border bg-card/50 p-1">
                                  <TabsTrigger value="numerical" className="data-[state=active]:bg-primary/20">
                                    Trades & Stats
                                  </TabsTrigger>
                                  <TabsTrigger value="chart" className="data-[state=active]:bg-primary/20">
                                    Chart Replay
                                  </TabsTrigger>
                                </TabsList>
                                <TabsContent value="numerical">
                                  <BacktestResults results={latestRun.result} />
                                </TabsContent>
                                <TabsContent value="chart">
                                  <ChartView results={latestRun.result} />
                                </TabsContent>
                              </Tabs>
                            ) : (
                              <Card className="border-dashed bg-card/40">
                                <CardContent className="space-y-2 py-10 text-center">
                                  <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
                                  <p className="text-sm font-medium">Full results not stored for this entry</p>
                                  <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                                    Summary stats are kept for every refresh. Hit <span className="font-medium text-foreground">Refresh to Today</span> again to load the full trade table and chart replay for the current period.
                                  </p>
                                </CardContent>
                              </Card>
                            )}
                          </>
                        );
                      })()}
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>

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
      </DashboardLayout>
    </>
  );
};

export default PaperAccounts;
