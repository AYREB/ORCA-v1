import { useEffect, useMemo, useState } from "react";
import {
  Shield, Users, Bot, FlaskConical, Sigma, MessageSquare, Search, Loader2,
  ChevronRight, Clock, CheckCircle2, XCircle,
} from "lucide-react";
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
  api, AdminOverview, AdminUserSummary, AdminUserDetail, AdminAiInteraction,
} from "@/lib/api";
import { toast } from "sonner";

const PLAN_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  plus: "bg-primary/15 text-primary",
  pro: "bg-amber-500/15 text-amber-500",
};
const METRIC_LABEL: Record<string, string> = { ai: "AI", backtest: "Backtests", optimize: "Optimizers" };
const PERIOD_SUFFIX: Record<string, string> = { all_time: "all-time", weekly: "/wk", monthly: "/mo" };

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

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

/** Per-metric quota usage bar (used vs limit, with period). */
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

function AiInteractionCard({ log }: { log: AdminAiInteraction }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/50 bg-background/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40"
      >
        {log.success ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{log.kind}</Badge>
            <span className="truncate text-xs text-muted-foreground">{log.model || log.provider || "—"}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/80">
            {log.prompt_preview || (log.messages?.at(-1)?.content ?? "")}
          </p>
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
          {log.error && (
            <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">Error: {log.error}</div>
          )}
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

const AdminDashboard = () => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ov, us] = await Promise.all([api.getAdminOverview(), api.getAdminUsers()]);
        if (!alive) return;
        setOverview(ov);
        setUsers(us.users);
        setTotal(us.total);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load admin data.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const us = await api.getAdminUsers(query.trim());
        setUsers(us.users);
        setTotal(us.total);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const openUser = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await api.getAdminUserDetail(id);
      setDetail(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load user.");
    } finally {
      setDetailLoading(false);
    }
  };

  const aiSuccessPct = useMemo(
    () => (overview?.ai.success_rate != null ? `${Math.round(overview.ai.success_rate * 100)}%` : "—"),
    [overview],
  );

  return (
    <DashboardLayout>
      <PageHeader
        icon={Shield}
        eyebrow="Internal"
        title="Admin Analytics"
        description="Every user's activity, AI calls, and quota usage. Superuser-only — highly sensitive."
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Overview */}
          {overview && (
            <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile icon={Users} label="Users" value={fmtNum(overview.users.total)}
                sub={Object.entries(overview.users.by_plan).map(([p, n]) => `${n} ${p}`).join(" · ") || "—"} />
              <StatTile icon={Bot} label="AI calls" value={fmtNum(overview.ai.total)}
                sub={`${aiSuccessPct} success · ${fmtNum(overview.ai.total_tokens)} tokens`} />
              <StatTile icon={Clock} label="Avg latency" value={overview.ai.avg_latency_ms != null ? `${Math.round(overview.ai.avg_latency_ms)}ms` : "—"}
                sub={Object.entries(overview.ai.by_kind).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(" · ") || "—"} />
              <StatTile icon={FlaskConical} label="Backtests" value={fmtNum(overview.backtests.total)}
                sub={`${fmtNum(overview.custom_indicators.total)} indicators · ${fmtNum(overview.feedback_leads.total)} leads`} />
            </div>
          )}

          {/* Users */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" /> Users <span className="text-muted-foreground">({total})</span>
            </div>
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email…" className="pl-8" />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/55 backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Quota usage</th>
                    <th className="px-4 py-2.5 font-medium text-right">Backtests</th>
                    <th className="px-4 py-2.5 font-medium text-right">AI</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => openUser(u.id)}
                      className="cursor-pointer border-b border-border/30 transition-colors last:border-0 hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-medium">
                          {u.email}
                          {u.is_superuser && <Shield className="h-3.5 w-3.5 text-amber-500" />}
                        </div>
                        <div className="text-xs text-muted-foreground">{u.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`capitalize ${PLAN_COLORS[u.plan] ?? ""}`}>{u.plan_label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          {Object.keys(u.quotas).map((m) => {
                            const q = u.quotas[m];
                            return (
                              <span key={m} className="tabular-nums">
                                {METRIC_LABEL[m] ?? m} {u.usage[m] ?? 0}/{q.limit ?? "∞"}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.counts.backtests ?? 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.counts.ai_interactions ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(u.date_joined)}</td>
                      <td className="px-4 py-3 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No users.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Drill-down */}
      <Dialog open={detail !== null || detailLoading} onOpenChange={(o) => { if (!o) { setDetail(null); } }}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
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
                  Joined {fmtDate(detail.user.date_joined)} · Last login {fmtDate(detail.user.last_login)} ·
                  {detail.user.has_password ? " password" : " Google-SSO"}
                </DialogDescription>
              </DialogHeader>

              {/* Quota usage */}
              <div className="grid grid-cols-1 gap-3 border-b border-border/60 px-5 py-4 sm:grid-cols-3">
                {Object.keys(detail.user.quotas).map((m) => (
                  <QuotaBar key={m} metric={m} used={detail.user.usage[m] ?? 0} quota={detail.user.quotas[m]} />
                ))}
              </div>

              <Tabs defaultValue="ai" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="mx-5 mt-3 w-fit">
                  <TabsTrigger value="ai" className="gap-1.5"><Bot className="h-3.5 w-3.5" />AI ({detail.ai_interactions.length})</TabsTrigger>
                  <TabsTrigger value="backtests" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" />Backtests ({detail.backtests.length})</TabsTrigger>
                  <TabsTrigger value="indicators" className="gap-1.5"><Sigma className="h-3.5 w-3.5" />Indicators ({detail.custom_indicators.length})</TabsTrigger>
                  <TabsTrigger value="feedback" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Feedback ({detail.feedback.length})</TabsTrigger>
                </TabsList>

                <ScrollArea className="max-h-[46vh] flex-1 px-5 py-4">
                  <TabsContent value="ai" className="mt-0 space-y-2">
                    {detail.ai_interactions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No AI calls.</p>}
                    {detail.ai_interactions.map((log) => <AiInteractionCard key={log.id} log={log} />)}
                  </TabsContent>

                  <TabsContent value="backtests" className="mt-0">
                    {detail.backtests.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">No backtests.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Strategy</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Return</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Win rate</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Trades</th>
                          <th className="py-1.5 font-medium">When</th>
                        </tr></thead>
                        <tbody>
                          {detail.backtests.map((b) => (
                            <tr key={b.id} className="border-t border-border/30">
                              <td className="py-1.5 pr-3">{b.strategy_name || "Ad-hoc"}</td>
                              <td className={`py-1.5 pr-3 text-right tabular-nums ${b.pct_change >= 0 ? "text-emerald-500" : "text-destructive"}`}>{b.pct_change.toFixed(2)}%</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{(b.win_rate * 100).toFixed(0)}%</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{b.trades}</td>
                              <td className="py-1.5 text-xs text-muted-foreground">{fmtDate(b.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
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
