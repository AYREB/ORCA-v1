import { useEffect, useMemo, useState } from "react";
import {
  Shield, Users, Bot, FlaskConical, Sigma, MessageSquare, Search, Loader2,
  ChevronRight, Clock, CheckCircle2, XCircle, Sliders, TrendingUp, TrendingDown,
  Download, Copy, Eye, Repeat, Filter, BrainCircuit, AlertTriangle,
  ArrowUp, ArrowDown, ArrowUpDown, Gauge,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Cell, LabelList,
} from "recharts";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  api, AdminOverview, AdminAnalytics, AdminUserSummary, AdminUserDetail,
  AdminAiInteraction, AdminBacktestRow, AdminOptimization, TimePoint, AdminFeedback,
  AdminVisitors, AdminFunnel, AdminAiQuality, AdminAiProblem, AdminOnline,
} from "@/lib/api";
import { toast } from "sonner";

// Single-hue palette (magnitude/time charts) — teal primary + recessive grid.
// Single-series throughout, so no categorical-CVD concern.
const TEAL = "#14b8a6";
const GRID = "rgba(148,163,184,0.18)";
const AXIS = "rgba(148,163,184,0.7)";

const PLAN_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  plus: "bg-primary/15 text-primary",
  pro: "bg-amber-500/15 text-amber-500",
};
const METRIC_LABEL: Record<string, string> = { ai: "AI", backtest: "Backtests", optimize: "Optimizers" };
const PERIOD_SUFFIX: Record<string, string> = { all_time: "all-time", weekly: "/wk", monthly: "/mo" };
const KIND_LABEL: Record<string, string> = {
  strategy_assistant: "Strategy assistant", indicator_assistant: "Indicator assistant",
  nl_parse: "NL → strategy", nl_chat: "NL chat", other: "Other",
};

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const fmtDuration = (secs: number | null | undefined) => {
  if (secs == null) return "—";
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const fmtPct = (n: number | null | undefined, mult = 100) => (n == null ? "—" : `${(n * mult).toFixed(mult === 100 ? 1 : 2)}%`);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

const tooltipStyle = {
  background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
  borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))",
} as const;

function StatTile({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
      <div className="mb-1.5 flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Small area chart for one metric over time (single hue, change-over-time). */
function ActivityChart({ title, total, data }: { title: string; total: number; data: TimePoint[] }) {
  const gid = `g-${title.replace(/\s+/g, "")}`;
  return (
    <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{fmtNum(total)} total</span>
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
                <stop offset="100%" stopColor={TEAL} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: AXIS }}
              interval="preserveStartEnd" minTickGap={40} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} width={24} tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
            <RTooltip contentStyle={tooltipStyle} labelFormatter={(l) => shortDate(String(l))} />
            <Area type="monotone" dataKey="count" name={title} stroke={TEAL} strokeWidth={2}
              fill={`url(#${gid})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Horizontal single-hue bar chart for a category→count map. */
function CategoryBars({ title, data, labelMap }: { title: string; data: Record<string, number>; labelMap?: Record<string, string> }) {
  const rows = Object.entries(data)
    .map(([k, v]) => ({ name: labelMap?.[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
      <span className="mb-2 block text-sm font-medium">{title}</span>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div style={{ height: Math.max(80, rows.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
              <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Bar dataKey="value" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList dataKey="value" position="right" style={{ fill: AXIS, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Conversion funnel — bars scale to the widest stage; each stage shows the
 * conversion from the previous one. */
function FunnelChart({ funnel }: { funnel: AdminFunnel }) {
  const max = Math.max(1, ...funnel.stages.map((s) => s.count));
  return (
    <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
      <div className="space-y-2.5">
        {funnel.stages.map((s, i) => (
          <div key={s.key}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmtNum(s.count)}
                {s.rate_from_prev != null && (
                  <span className="ml-2 opacity-70">{fmtPct(s.rate_from_prev)} of prev.</span>
                )}
              </span>
            </div>
            <div className="h-5 overflow-hidden rounded bg-secondary/40">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${Math.max(1.5, (s.count / max) * 100)}%`,
                  background: TEAL,
                  opacity: 1 - i * 0.16,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Signup → retention stages follow users who signed up in this window. Visitor counts
        start with tracking, so early on signups can exceed visitors.
      </p>
    </div>
  );
}

const PROBLEM_STATUS_STYLE: Record<string, string> = {
  failed: "bg-destructive/15 text-destructive",
  clarify: "bg-amber-500/15 text-amber-500",
};

function ProblemPromptRow({ p }: { p: AdminAiProblem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/50 bg-background/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/40">
        <Badge className={`shrink-0 text-[10px] capitalize ${PROBLEM_STATUS_STYLE[p.status] ?? ""}`}>{p.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-xs">{p.prompt}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(p.created_at)}</span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2.5 text-xs">
          <p className="whitespace-pre-wrap">{p.prompt}</p>
          {p.missing_field && <p className="text-muted-foreground">Asked for: <span className="font-mono">{p.missing_field}</span></p>}
          {p.errors.length > 0 && (
            <div className="rounded bg-destructive/10 px-2 py-1.5 text-destructive">
              {p.errors.map((e, i) => <div key={i}>{String(e)}</div>)}
            </div>
          )}
          <p className="text-muted-foreground">{p.user_email ?? "unknown user"}</p>
        </div>
      )}
    </div>
  );
}

/** Highest quota utilisation across a user's metered metrics — the upsell
 * signal. Unlimited (null-limit) metrics can't create pressure. */
const quotaPressure = (u: AdminUserSummary): { pct: number; metric: string | null } => {
  let best = { pct: 0, metric: null as string | null };
  for (const m of Object.keys(u.quotas)) {
    const limit = u.quotas[m]?.limit;
    if (limit == null || limit <= 0) continue;
    const pct = (u.usage[m] ?? 0) / limit;
    if (pct > best.pct) best = { pct, metric: m };
  }
  return best;
};

const pressureTone = (pct: number) =>
  pct >= 1 ? "text-destructive" : pct >= 0.8 ? "text-amber-500" : "text-muted-foreground";

type UserSortKey = "email" | "plan" | "pressure" | "backtests" | "ai" | "opt" | "joined";

function SortTh({ label, k, sort, onSort, right }: {
  label: string; k: UserSortKey;
  sort: { key: UserSortKey; dir: "asc" | "desc" };
  onSort: (k: UserSortKey) => void; right?: boolean;
}) {
  const active = sort.key === k;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`px-4 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}>
        {right && <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />}
        {label}
        {!right && <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />}
      </button>
    </th>
  );
}

function QuotaBar({ metric, used, quota }: { metric: string; used: number; quota?: { limit: number | null; period: string } }) {
  const limit = quota?.limit ?? null;
  const pct = limit === null || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium">{METRIC_LABEL[metric] ?? metric}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} / {limit === null ? "∞" : limit}
          {quota && <span className="ml-1 opacity-60">{PERIOD_SUFFIX[quota.period] ?? ""}</span>}
        </span>
      </div>
      <Progress value={limit === null ? 0 : pct} className="h-1.5" />
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <pre className="max-h-56 overflow-auto rounded bg-secondary/40 p-2 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EquitySpark({ curve }: { curve: AdminBacktestRow["equity_curve"] }) {
  const data = (curve ?? []).map((pt, i) => {
    const rec = pt as Record<string, unknown>;
    const v = Number(rec.equity ?? rec.value ?? rec.portfolio ?? rec.total ?? 0);
    return { i, v };
  }).filter((d) => Number.isFinite(d.v));
  if (data.length < 2) return null;
  const up = data[data.length - 1].v >= data[0].v;
  const color = up ? "#10b981" : "#f43f5e";
  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <RTooltip contentStyle={tooltipStyle} formatter={(v) => [Number(v).toLocaleString(), "Equity"]} labelFormatter={() => ""} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill="url(#eq)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function AiInteractionCard({ log }: { log: AdminAiInteraction }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/50 bg-background/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40">
        {log.success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{KIND_LABEL[log.kind] ?? log.kind}</Badge>
            <span className="truncate text-xs text-muted-foreground">{log.model || log.provider || "—"}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/80">{log.prompt_preview || (log.messages?.at(-1)?.content ?? "")}</p>
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
          <div>{fmtDate(log.created_at)}</div>
          <div className="flex items-center justify-end gap-2">
            {log.latency_ms != null && <span>{Math.round(log.latency_ms)}ms</span>}
            {log.total_tokens != null && <span>{log.total_tokens} tok</span>}
          </div>
        </div>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/50 px-3 py-3 text-sm">
          {log.error && <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">Error: {log.error}</div>}
          {(log.messages ?? []).map((m, i) => (
            <div key={i}>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{m.role}</div>
              <div className="whitespace-pre-wrap rounded bg-secondary/40 px-2 py-1.5 text-xs">{m.content}</div>
            </div>
          ))}
          {log.response_text && (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">response</div>
              <div className="whitespace-pre-wrap rounded bg-primary/5 px-2 py-1.5 text-xs">{log.response_text}</div>
            </div>
          )}
          {log.system_prompt && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">System prompt</summary>
              <div className="mt-1 whitespace-pre-wrap rounded bg-secondary/30 px-2 py-1.5 text-[11px] text-muted-foreground">{log.system_prompt}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-md bg-secondary/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === "up" ? "text-emerald-500" : tone === "down" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function BacktestCard({ bt }: { bt: AdminBacktestRow }) {
  const [open, setOpen] = useState(false);
  const cfg = (bt.config ?? {}) as Record<string, unknown>;
  const tickers = Array.isArray(cfg.tickers) ? (cfg.tickers as string[]).join(", ") : "—";
  return (
    <div className="rounded-lg border border-border/50 bg-background/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40">
        {bt.pct_change >= 0 ? <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" /> : <TrendingDown className="h-4 w-4 shrink-0 text-destructive" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{bt.strategy_name || "Ad-hoc backtest"}</div>
          <div className="text-xs text-muted-foreground">{tickers} · {bt.source || "—"} · {fmtDate(bt.created_at)}</div>
        </div>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${bt.pct_change >= 0 ? "text-emerald-500" : "text-destructive"}`}>{bt.pct_change.toFixed(2)}%</span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/50 px-3 py-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Metric label="Return" value={`${bt.pct_change.toFixed(2)}%`} tone={bt.pct_change >= 0 ? "up" : "down"} />
            <Metric label="Win rate" value={fmtPct(bt.win_rate)} />
            <Metric label="Trades" value={fmtNum(bt.trades)} />
            <Metric label="Final $" value={fmtNum(Math.round(bt.final_balance))} />
            <Metric label="Won" value={fmtNum(bt.winning_trades)} />
            <Metric label="Lost" value={fmtNum(bt.losing_trades)} />
          </div>
          <EquitySpark curve={bt.equity_curve} />
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Run config</div>
            <JsonBlock value={bt.config} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Strategy (DSL)</div>
            <JsonBlock value={bt.dsl_json ?? bt.dsl_text ?? null} />
          </div>
        </div>
      )}
    </div>
  );
}

function OptimizationCard({ opt }: { opt: AdminOptimization }) {
  const [open, setOpen] = useState(false);
  const best = opt.best_result ?? {};
  const ret = Number(best.pct_change ?? best.return ?? NaN);
  return (
    <div className="rounded-lg border border-border/50 bg-background/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40">
        <Sliders className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] capitalize">{opt.method}{opt.algorithm ? ` · ${opt.algorithm}` : ""}</Badge>
            <span className="truncate text-xs text-muted-foreground">{opt.strategy_name || "—"}</span>
          </div>
          <div className="text-xs text-muted-foreground">{opt.total_runs} runs · {fmtDate(opt.created_at)}</div>
        </div>
        {Number.isFinite(ret) && <span className={`shrink-0 text-sm font-semibold tabular-nums ${ret >= 0 ? "text-emerald-500" : "text-destructive"}`}>{ret.toFixed(2)}%</span>}
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/50 px-3 py-3">
          {opt.best_result && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(opt.best_result).map(([k, v]) => (
                <Metric key={k} label={k.replace(/_/g, " ")} value={typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)}
                  tone={k.includes("pct") || k.includes("return") ? (Number(v) >= 0 ? "up" : "down") : undefined} />
              ))}
            </div>
          )}
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What was optimized</div>
            <JsonBlock value={opt.parameter_space} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">Winning params</div>
            <JsonBlock value={opt.best_params} />
          </div>
          {opt.best_dsl && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Optimized strategy (DSL)</div>
              <JsonBlock value={opt.best_dsl} />
            </div>
          )}
          {opt.top_results && opt.top_results.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Leaderboard ({opt.top_results.length})</summary>
              <div className="mt-1"><JsonBlock value={opt.top_results} /></div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const DAY_RANGES = [7, 30, 90];

const AdminDashboard = () => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [days, setDays] = useState(30);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<AdminFeedback | null>(null);
  const [visitors, setVisitors] = useState<AdminVisitors | null>(null);
  const [funnel, setFunnel] = useState<AdminFunnel | null>(null);
  const [aiQuality, setAiQuality] = useState<AdminAiQuality | null>(null);
  const [online, setOnline] = useState<AdminOnline | null>(null);
  const [userSort, setUserSort] = useState<{ key: UserSortKey; dir: "asc" | "desc" }>({ key: "joined", dir: "desc" });
  const [nearLimitOnly, setNearLimitOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ov, us, fb] = await Promise.all([
          api.getAdminOverview(), api.getAdminUsers(), api.getAdminFeedback(),
        ]);
        if (!alive) return;
        setOverview(ov); setUsers(us.users); setTotal(us.total); setFeedback(fb);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load admin data.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    api.getAdminAnalytics(days).then((a) => { if (alive) setAnalytics(a); }).catch(() => {});
    api.getAdminVisitors(days).then((v) => { if (alive) setVisitors(v); }).catch(() => {});
    api.getAdminFunnel(days).then((f) => { if (alive) setFunnel(f); }).catch(() => {});
    api.getAdminAiQuality(days).then((q) => { if (alive) setAiQuality(q); }).catch(() => {});
    return () => { alive = false; };
  }, [days]);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const us = await api.getAdminUsers(query.trim());
        setUsers(us.users); setTotal(us.total);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Live "online now" — refreshes every 30s (heartbeats mark 2-min freshness).
  useEffect(() => {
    let alive = true;
    const load = () => api.getAdminOnline().then((o) => { if (alive) setOnline(o); }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const toggleUserSort = (key: UserSortKey) =>
    setUserSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const sortedUsers = useMemo(() => {
    const val = (u: AdminUserSummary): string | number => {
      switch (userSort.key) {
        case "email": return u.email.toLowerCase();
        case "plan": return u.plan;
        case "pressure": return quotaPressure(u).pct;
        case "backtests": return u.counts.backtests ?? 0;
        case "ai": return u.counts.ai_interactions ?? 0;
        case "opt": return u.counts.optimizations ?? 0;
        case "joined": return u.date_joined ?? "";
      }
    };
    const rows = nearLimitOnly ? users.filter((u) => quotaPressure(u).pct >= 0.8) : [...users];
    return rows.sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return userSort.dir === "asc" ? cmp : -cmp;
    });
  }, [users, userSort, nearLimitOnly]);

  const openUser = async (id: number) => {
    setDetailLoading(true); setDetail(null);
    try { setDetail(await api.getAdminUserDetail(id)); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Failed to load user."); }
    finally { setDetailLoading(false); }
  };

  const downloadEmails = () => {
    const emails = feedback?.emails ?? [];
    if (emails.length === 0) { toast.error("No feedback emails to export yet."); return; }
    const csv = emails.join(", ");
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feedback-emails-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${emails.length} email${emails.length === 1 ? "" : "s"}.`);
  };

  const copyEmails = async () => {
    const emails = feedback?.emails ?? [];
    if (emails.length === 0) { toast.error("No feedback emails to copy yet."); return; }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      toast.success(`Copied ${emails.length} email${emails.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  const aiSuccessPct = useMemo(
    () => (overview?.ai.success_rate != null ? `${Math.round(overview.ai.success_rate * 100)}%` : "—"),
    [overview],
  );

  return (
    <DashboardLayout>
      <PageHeader icon={Shield} eyebrow="Internal" title="Admin Analytics"
        description="Platform usage, every user's activity, AI calls, backtests & optimizations. Superuser-only." />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          {/* Top-line tiles */}
          {overview && (
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile icon={Users} label="Users" value={fmtNum(overview.users.total)}
                sub={`${overview.users.active_7d} active (7d) · ${Object.entries(overview.users.by_plan).map(([p, n]) => `${n} ${p}`).join(" · ") || "—"}`} />
              <StatTile icon={Bot} label="AI calls" value={fmtNum(overview.ai.total)}
                sub={`${aiSuccessPct} success · ${fmtNum(overview.ai.total_tokens)} tokens · ${overview.ai.avg_latency_ms != null ? Math.round(overview.ai.avg_latency_ms) + "ms avg" : "—"}`} />
              <StatTile icon={FlaskConical} label="Backtests" value={fmtNum(overview.backtests.total)}
                sub={`${fmtPct(overview.backtests.profitable_rate)} profitable · ${overview.backtests.avg_return_pct != null ? overview.backtests.avg_return_pct + "% avg" : "—"}`} />
              <StatTile icon={Sliders} label="Optimizations" value={fmtNum(overview.optimizations.total)}
                sub={Object.entries(overview.optimizations.by_method).map(([m, n]) => `${n} ${m}`).join(" · ") || "—"} />
            </div>
          )}

          {/* Activity over time */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">Activity over time</span>
            <div className="flex gap-1">
              {DAY_RANGES.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${days === d ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary/60"}`}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          {analytics && (
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ActivityChart title="Signups" total={analytics.timeseries.signups.reduce((s, p) => s + p.count, 0)} data={analytics.timeseries.signups} />
              <ActivityChart title="AI calls" total={analytics.timeseries.ai.reduce((s, p) => s + p.count, 0)} data={analytics.timeseries.ai} />
              <ActivityChart title="Backtests" total={analytics.timeseries.backtests.reduce((s, p) => s + p.count, 0)} data={analytics.timeseries.backtests} />
              <ActivityChart title="Optimizations" total={analytics.timeseries.optimizations.reduce((s, p) => s + p.count, 0)} data={analytics.timeseries.optimizations} />
            </div>
          )}

          {/* Distributions */}
          {overview && analytics && (
            <div className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <CategoryBars title="Users by plan" data={analytics.plan_distribution} />
              <CategoryBars title="AI calls by feature" data={overview.ai.by_kind} labelMap={KIND_LABEL} />
              <CategoryBars title="Backtests by source" data={overview.backtests.by_source} />
            </div>
          )}

          {/* Conversion funnel + AI quality */}
          <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Filter className="h-4 w-4" /> Conversion funnel
                <span className="text-xs font-normal text-muted-foreground">(last {days}d)</span>
              </div>
              {funnel ? (
                <FunnelChart funnel={funnel} />
              ) : (
                <div className="rounded-xl border border-border/50 bg-card/55 py-10 text-center backdrop-blur-xl">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <BrainCircuit className="h-4 w-4" /> AI parser quality
                <span className="text-xs font-normal text-muted-foreground">(NL → strategy · last {days}d)</span>
              </div>
              {aiQuality ? (
                <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Parse success" value={fmtPct(aiQuality.totals.parse_success_rate)}
                      tone={aiQuality.totals.parse_success_rate != null && aiQuality.totals.parse_success_rate >= 0.8 ? "up" : undefined} />
                    <Metric label="Ran w/o edits" value={fmtPct(aiQuality.totals.clean_run_rate)}
                      tone={aiQuality.totals.clean_run_rate != null && aiQuality.totals.clean_run_rate >= 0.7 ? "up" : undefined} />
                    <Metric label="Prompts" value={fmtNum(aiQuality.totals.attempts)} />
                    <Metric label="Avg turns" value={aiQuality.totals.avg_turns != null ? String(aiQuality.totals.avg_turns) : "—"} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Parsed" value={fmtNum(aiQuality.totals.complete)} />
                    <Metric label="Needed clarify" value={fmtNum(aiQuality.totals.clarify)} />
                    <Metric label="Failed" value={fmtNum(aiQuality.totals.failed)} tone={aiQuality.totals.failed > 0 ? "down" : undefined} />
                    <Metric label="Parsed, not run" value={fmtNum(aiQuality.totals.abandoned)} />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    “Ran w/o edits” = user ran the parsed strategy without correcting a single field — the
                    strongest signal the model got it right. Corrections below show what to fix in training.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 bg-card/55 py-10 text-center backdrop-blur-xl">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          {aiQuality && (aiQuality.totals.attempts > 0 || aiQuality.problems.length > 0) && (
            <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <CategoryBars title="Fields users corrected before running" data={aiQuality.corrected_fields} />
              <CategoryBars title="Fields the model had to ask for" data={aiQuality.missing_fields} />
              <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
                <span className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Problem prompts
                  <span className="text-xs font-normal text-muted-foreground">(failed / clarify — free training data)</span>
                </span>
                {aiQuality.problems.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">None in this window. 🎉</p>
                ) : (
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {aiQuality.problems.map((p) => <ProblemPromptRow key={p.id} p={p} />)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Online now — polls every 30s */}
          <div className="mb-6 rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                {(online?.count ?? 0) > 0 && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${(online?.count ?? 0) > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
              </span>
              <span className="text-sm font-semibold tabular-nums">{online ? fmtNum(online.count) : "—"}</span>
              <span className="text-sm text-muted-foreground">online now</span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">active in the last 2 min · refreshes every 30s</span>
            </div>
            {online && online.visitors.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {online.visitors.map((v) => (
                  <span key={v.anon_id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px]">
                    <span className={v.email ? "font-medium" : "font-mono text-muted-foreground"}>
                      {v.email ?? `anon · ${v.anon_id.slice(0, 8)}`}
                    </span>
                    <span className="font-mono text-muted-foreground">{v.path}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Visitors & view time */}
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4" /> Visitors
            <span className="text-xs font-normal text-muted-foreground">(page views incl. logged-out traffic · last {days}d · your own admin browsing excluded)</span>
          </div>
          {visitors ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile icon={Eye} label="Unique visitors" value={fmtNum(visitors.totals.unique_visitors)}
                  sub={`${fmtNum(visitors.totals.signed_in_visitors)} signed in · ${fmtNum(visitors.totals.views)} page views`} />
                <StatTile icon={Repeat} label="Returning visitors" value={fmtNum(visitors.totals.returning_visitors)}
                  sub={visitors.totals.unique_visitors > 0
                    ? `${Math.round((visitors.totals.returning_visitors / visitors.totals.unique_visitors) * 100)}% came back on another day`
                    : "seen on 2+ days"} />
                <StatTile icon={Clock} label="Avg session time" value={fmtDuration(visitors.totals.avg_session_seconds)}
                  sub={`${visitors.totals.views_per_session ?? "—"} pages/session · ${fmtNum(visitors.totals.sessions)} sessions`} />
                <StatTile icon={Clock} label="Total time on site" value={fmtDuration(visitors.totals.total_time_seconds)}
                  sub={`across all visitors (${days}d)`} />
              </div>

              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ActivityChart title="Unique visitors / day"
                  total={visitors.totals.unique_visitors}
                  data={visitors.daily.map((d) => ({ date: d.date, count: d.visitors }))} />
                <ActivityChart title="Page views / day"
                  total={visitors.totals.views}
                  data={visitors.daily.map((d) => ({ date: d.date, count: d.views }))} />
              </div>

              <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <CategoryBars title="Top pages (views)"
                  data={Object.fromEntries(visitors.pages.map((p) => [p.path, p.views]))} />
                <div className="rounded-xl border border-border/50 bg-card/55 p-4 backdrop-blur-xl">
                  <span className="mb-2 block text-sm font-medium">Time on page (avg)</span>
                  {visitors.pages.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">No data yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {[...visitors.pages].sort((a, b) => b.avg_seconds - a.avg_seconds).map((p) => (
                        <div key={p.path} className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate font-mono">{p.path}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {fmtDuration(p.avg_seconds)} · {fmtNum(p.visitors)} visitor{p.visitors === 1 ? "" : "s"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-8 overflow-hidden rounded-xl border border-border/50 bg-card/55 backdrop-blur-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Viewer</th>
                        <th className="px-4 py-2.5 font-medium text-right">Sessions</th>
                        <th className="px-4 py-2.5 font-medium text-right">Views</th>
                        <th className="px-4 py-2.5 font-medium text-right">Days active</th>
                        <th className="px-4 py-2.5 font-medium text-right">Time on site</th>
                        <th className="px-4 py-2.5 font-medium">First seen</th>
                        <th className="px-4 py-2.5 font-medium">Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visitors.visitors.map((v) => (
                        <tr key={v.anon_id} className="border-b border-border/30 last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className={v.email ? "font-medium" : "font-mono text-xs text-muted-foreground"}>
                                {v.email ?? `anon · ${v.anon_id.slice(0, 8)}`}
                              </span>
                              {v.returning && <Badge variant="secondary" className="text-[10px]">returning</Badge>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{v.sessions}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{v.views}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{v.days_active}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtDuration(v.total_seconds)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(v.first_seen)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(v.last_seen)}</td>
                        </tr>
                      ))}
                      {visitors.visitors.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                          No visits recorded yet — tracking starts with this deploy.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="mb-8 rounded-xl border border-border/50 bg-card/55 py-10 text-center text-sm text-muted-foreground backdrop-blur-xl">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          )}

          {/* Users — sortable; sort by Usage for the upsell radar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" /> Users <span className="text-muted-foreground">({total})</span>
              <span className="text-xs font-normal text-muted-foreground">— click a column to rank</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setNearLimitOnly((v) => !v);
                  if (!nearLimitOnly) setUserSort({ key: "pressure", dir: "desc" });
                }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  nearLimitOnly
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-500"
                    : "border-border/60 bg-card/55 text-muted-foreground hover:bg-secondary/60"
                }`}>
                <Gauge className="h-3.5 w-3.5" /> Near limit (≥80%)
              </button>
              <div className="relative w-64 max-w-full">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email…" className="pl-8" />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/55 backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                    <SortTh label="User" k="email" sort={userSort} onSort={toggleUserSort} />
                    <SortTh label="Plan" k="plan" sort={userSort} onSort={toggleUserSort} />
                    <SortTh label="Usage" k="pressure" sort={userSort} onSort={toggleUserSort} />
                    <SortTh label="Backtests" k="backtests" sort={userSort} onSort={toggleUserSort} right />
                    <SortTh label="AI" k="ai" sort={userSort} onSort={toggleUserSort} right />
                    <SortTh label="Opt" k="opt" sort={userSort} onSort={toggleUserSort} right />
                    <SortTh label="Joined" k="joined" sort={userSort} onSort={toggleUserSort} />
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((u) => {
                    const pressure = quotaPressure(u);
                    return (
                      <tr key={u.id} onClick={() => openUser(u.id)}
                        className="cursor-pointer border-b border-border/30 transition-colors last:border-0 hover:bg-secondary/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 font-medium">
                            {u.email}{u.is_superuser && <Shield className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.name}</div>
                        </td>
                        <td className="px-4 py-3"><Badge className={`capitalize ${PLAN_COLORS[u.plan] ?? ""}`}>{u.plan_label}</Badge></td>
                        <td className="px-4 py-3">
                          <div className={`flex items-center gap-2 text-xs font-semibold tabular-nums ${pressureTone(pressure.pct)}`}>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary/60">
                              <div className={`h-full rounded-full ${pressure.pct >= 1 ? "bg-destructive" : pressure.pct >= 0.8 ? "bg-amber-500" : "bg-primary/60"}`}
                                style={{ width: `${Math.min(100, pressure.pct * 100)}%` }} />
                            </div>
                            {Math.round(pressure.pct * 100)}%
                            {pressure.metric && <span className="font-normal opacity-70">{METRIC_LABEL[pressure.metric] ?? pressure.metric}</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            {Object.keys(u.quotas).map((m) => (
                              <span key={m} className="tabular-nums">{METRIC_LABEL[m] ?? m} {u.usage[m] ?? 0}/{u.quotas[m].limit ?? "∞"}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{u.counts.backtests ?? 0}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{u.counts.ai_interactions ?? 0}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{u.counts.optimizations ?? 0}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(u.date_joined)}</td>
                        <td className="px-4 py-3 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                      </tr>
                    );
                  })}
                  {sortedUsers.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      {nearLimitOnly ? "Nobody is near their quota limits right now." : "No users."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Feedback leads */}
          <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="h-4 w-4" /> Feedback
              <span className="text-muted-foreground">
                ({feedback?.total ?? 0}{feedback ? ` · ${feedback.unique_emails} unique email${feedback.unique_emails === 1 ? "" : "s"}` : ""})
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={copyEmails} disabled={!feedback?.emails.length}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/55 px-3 py-1.5 text-xs font-medium backdrop-blur-xl transition-colors hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50">
                <Copy className="h-3.5 w-3.5" /> Copy emails
              </button>
              <button onClick={downloadEmails} disabled={!feedback?.emails.length}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                <Download className="h-3.5 w-3.5" /> Download emails (CSV)
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/55 backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Account</th>
                    <th className="px-4 py-2.5 font-medium">Feedback</th>
                    <th className="px-4 py-2.5 font-medium">Source</th>
                    <th className="px-4 py-2.5 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {(feedback?.leads ?? []).map((f) => (
                    <tr key={f.id} className="border-b border-border/30 align-top last:border-0">
                      <td className="px-4 py-3 font-medium">{f.email}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {f.user_email
                          ? (f.user_email === f.email ? "—" : f.user_email)
                          : <span className="italic">deleted / anonymous</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {f.message
                          ? <span className="whitespace-pre-wrap">{f.message}</span>
                          : <span className="italic opacity-60">No message</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{f.source || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(f.created_at)}</td>
                    </tr>
                  ))}
                  {(!feedback || feedback.leads.length === 0) && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No feedback yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Drill-down */}
      <Dialog open={detail !== null || detailLoading} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-24"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <DialogHeader className="border-b border-border/60 p-5">
                <DialogTitle className="flex items-center gap-2">
                  {detail.user.email}
                  {detail.user.is_superuser && <Shield className="h-4 w-4 text-amber-500" />}
                  <Badge className={`capitalize ${PLAN_COLORS[detail.user.plan] ?? ""}`}>{detail.user.plan_label}</Badge>
                </DialogTitle>
                <DialogDescription>
                  Joined {fmtDate(detail.user.date_joined)} · Last login {fmtDate(detail.user.last_login)} ·{detail.user.has_password ? " password" : " Google-SSO"}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 gap-3 border-b border-border/60 px-5 py-4 sm:grid-cols-3">
                {Object.keys(detail.user.quotas).map((m) => (
                  <QuotaBar key={m} metric={m} used={detail.user.usage[m] ?? 0} quota={detail.user.quotas[m]} />
                ))}
              </div>

              <Tabs defaultValue="ai" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="mx-5 mt-3 w-fit">
                  <TabsTrigger value="ai" className="gap-1.5"><Bot className="h-3.5 w-3.5" />AI ({detail.ai_interactions.length})</TabsTrigger>
                  <TabsTrigger value="backtests" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" />Backtests ({detail.backtests.length})</TabsTrigger>
                  <TabsTrigger value="optimizations" className="gap-1.5"><Sliders className="h-3.5 w-3.5" />Optimizations ({detail.optimizations.length})</TabsTrigger>
                  <TabsTrigger value="indicators" className="gap-1.5"><Sigma className="h-3.5 w-3.5" />Indicators ({detail.custom_indicators.length})</TabsTrigger>
                  <TabsTrigger value="feedback" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Feedback ({detail.feedback.length})</TabsTrigger>
                </TabsList>

                <ScrollArea className="max-h-[52vh] flex-1 px-5 py-4">
                  <TabsContent value="ai" className="mt-0 space-y-2">
                    {detail.ai_interactions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No AI calls.</p>}
                    {detail.ai_interactions.map((log) => <AiInteractionCard key={log.id} log={log} />)}
                  </TabsContent>

                  <TabsContent value="backtests" className="mt-0 space-y-2">
                    {detail.backtests.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No backtests.</p>}
                    {detail.backtests.map((bt) => <BacktestCard key={bt.id} bt={bt} />)}
                  </TabsContent>

                  <TabsContent value="optimizations" className="mt-0 space-y-2">
                    {detail.optimizations.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No optimizations.</p>}
                    {detail.optimizations.map((opt) => <OptimizationCard key={opt.id} opt={opt} />)}
                  </TabsContent>

                  <TabsContent value="indicators" className="mt-0 space-y-2">
                    {detail.custom_indicators.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No custom indicators.</p>}
                    {detail.custom_indicators.map((ci) => (
                      <div key={ci.id} className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <div className="font-medium">{ci.name}</div>
                        {ci.description && <div className="mt-0.5 text-xs text-muted-foreground">{ci.description}</div>}
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">{ci.code}</pre>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="feedback" className="mt-0 space-y-2">
                    {detail.feedback.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No feedback.</p>}
                    {detail.feedback.map((f) => (
                      <div key={f.id} className="rounded-lg border border-border/50 bg-background/40 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{f.email}</span>
                          <span className="text-xs text-muted-foreground">{fmtDate(f.created_at)}</span>
                        </div>
                        {f.message && <p className="mt-1 text-xs text-muted-foreground">{f.message}</p>}
                      </div>
                    ))}
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminDashboard;
