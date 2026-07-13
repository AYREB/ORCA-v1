import { FormEvent, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, Rocket, Loader2, Gift, Clock, Lock } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { api, PublicPlan, PlanSummary, PlanSlug, MetricQuota, QuotaPeriod } from "@/lib/api";

const PLAN_ICON: Record<PlanSlug, typeof Sparkles> = {
  free: Sparkles,
  plus: Zap,
  pro: Rocket,
};

const METRIC_LABEL: Record<string, string> = {
  ai: "AI generations",
  backtest: "Backtests",
  optimize: "Optimizer runs",
};
const METHOD_LABEL: Record<string, string> = {
  grid: "Grid search",
  genetic: "Genetic",
  meta: "Metaheuristics",
};

/** Short suffix describing a quota's reset cadence, e.g. "/ wk". */
const PERIOD_SUFFIX: Record<QuotaPeriod, string> = {
  all_time: "all-time",
  weekly: "/ wk",
  monthly: "/ mo",
};
/** How the usage panel describes when a metric resets. */
const PERIOD_RESET: Record<QuotaPeriod, string> = {
  all_time: "Lifetime — upgrade to reset",
  weekly: "Resets weekly",
  monthly: "Resets monthly",
};

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "Unlimited" : String(v));

const quotaLine = (label: string, q: MetricQuota | undefined) => {
  if (!q) return `${label}`;
  if (q.limit === null) return `Unlimited ${label.toLowerCase()}`;
  const suffix = PERIOD_SUFFIX[q.period] ?? "";
  return `${q.limit} ${label.toLowerCase()} ${suffix}`.trim();
};

/** Build the ordered feature rows shown on each plan card. */
function featureRows(plan: PublicPlan): string[] {
  const methods = plan.optimizer_methods.map((m) => METHOD_LABEL[m] ?? m).join(", ");
  return [
    quotaLine("AI generations", plan.quotas.ai),
    quotaLine("Backtests", plan.quotas.backtest),
    quotaLine("Optimizer runs", plan.quotas.optimize),
    `Optimizers: ${methods}`,
    `Up to ${fmt(plan.optimize_intensity)} backtests per optimization`,
    `${fmt(plan.caps.strategies)} saved strategies`,
    `${fmt(plan.caps.paper_accounts)} paper accounts`,
    `${fmt(plan.caps.custom_indicators)} custom indicators`,
    plan.timeframes === "*" ? "All timeframes" : `Timeframes: ${(plan.timeframes as string[]).join(", ")}`,
  ];
}

const Plans = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [summary, setSummary] = useState<PlanSummary | null>(user?.plan ?? null);
  const [loading, setLoading] = useState(true);

  // Feedback CTA
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [email, setEmail] = useState(user?.email ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const currentPlan: PlanSlug = summary?.plan ?? "free";

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [publicPlans, mine] = await Promise.all([api.getPublicPlans(), api.getPlan()]);
        if (!alive) return;
        setPlans(publicPlans);
        setSummary(mine);
      } catch {
        // Non-fatal — the pricing table can still render from whatever we have.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (user?.email) setEmail((prev) => prev || user.email);
  }, [user?.email]);

  const handleFeedbackSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter your email so we can reach you.");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitFeedback({ email: trimmed, message: message.trim(), source: "plans_page" });
      setSubmitted(true);
      toast.success("Thanks! You're on the list for discounts & giveaways.");
      setTimeout(() => setFeedbackOpen(false), 1200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <PageHeader
        icon={Sparkles}
        eyebrow="Subscription"
        title="Plans & Usage"
        description="Track your usage and preview the plans coming soon."
      />

      {/* Coming-soon disclosure banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 overflow-hidden rounded-2xl border border-primary/40 bg-primary/[0.06] p-6 backdrop-blur-xl"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold sm:text-xl">Paid upgrades are coming soon</h2>
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              We're putting the finishing touches on secure checkout and the Plus &amp; Pro tiers.
              For now you're on the Free plan — help shape what ships next and get rewarded for it.
            </p>
            <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Gift className="h-4 w-4" />
              Share feedback to unlock subscription discounts, giveaways &amp; freebies.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Button size="lg" className="gap-2" onClick={() => { setSubmitted(false); setFeedbackOpen(true); }}>
              <Gift className="h-4 w-4" />
              Provide feedback for perks
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Current usage */}
      {summary && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 rounded-2xl border border-border/60 bg-card/55 p-5 backdrop-blur-xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-medium text-muted-foreground">Current plan</span>
              <Badge variant="secondary" className="capitalize">{summary.label}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">Usage · {summary.period}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {Object.keys(summary.limits.quotas).map((metric) => {
              const quota = summary.limits.quotas[metric];
              const limit = quota?.limit ?? null;
              const used = summary.usage[metric] ?? 0;
              const pct = limit === null || limit === 0 ? (limit === null ? 0 : 100) : Math.min(100, (used / limit) * 100);
              return (
                <div key={metric} className="rounded-xl border border-border/50 bg-background/40 p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm font-medium">{METRIC_LABEL[metric] ?? metric}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {used} <span className="opacity-60">/ {limit === null ? "∞" : limit}</span>
                    </span>
                  </div>
                  <Progress value={limit === null ? 0 : pct} className="h-1.5" />
                  {quota && (
                    <span className="mt-2 block text-[11px] text-muted-foreground">
                      {PERIOD_RESET[quota.period]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Pricing cards — preview only (upgrades disabled until checkout ships) */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const Icon = PLAN_ICON[plan.plan];
            const isCurrent = plan.plan === currentPlan;
            const isFeatured = plan.plan === "plus";
            return (
              <motion.div
                key={plan.plan}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`relative flex flex-col rounded-2xl border p-6 backdrop-blur-xl transition-all ${
                  isFeatured
                    ? "border-primary/40 bg-primary/[0.04] shadow-[0_0_40px_-12px_hsl(var(--primary)/0.4)]"
                    : "border-border/60 bg-card/55"
                }`}
              >
                {isFeatured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">Most popular</Badge>
                  </div>
                )}
                <div className="mb-4 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-lg font-semibold">{plan.label}</span>
                </div>

                <div className="mb-5 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">${plan.price_usd}</span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </div>

                <ul className="mb-6 flex-1 space-y-2.5">
                  {featureRows(plan).map((row) => (
                    <li key={row} className="flex items-start gap-2.5 text-sm">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                      <span className="text-muted-foreground">{row}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <Button variant="secondary" disabled className="w-full">
                    Current plan
                  </Button>
                ) : plan.plan === "free" ? (
                  <Button variant="outline" disabled className="w-full">
                    Free plan
                  </Button>
                ) : (
                  <Button variant={isFeatured ? "default" : "outline"} disabled className="w-full gap-1.5">
                    <Lock className="h-4 w-4" />
                    Coming soon
                  </Button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Upgrades aren't available yet — secure checkout is coming soon. Everyone's on Free for now.
      </p>

      {/* Feedback capture dialog */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              Feedback = perks
            </DialogTitle>
            <DialogDescription>
              Tell us what you'd want from a paid plan. We'll use your email to send subscription
              discounts, giveaways, and early-access freebies.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFeedbackSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="feedback-email" className="text-sm font-medium">Email</label>
              <Input
                id="feedback-email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="feedback-message" className="text-sm font-medium">
                What would make you upgrade? <span className="text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="feedback-message"
                rows={4}
                placeholder="Features you want, pricing thoughts, anything…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full gap-2" disabled={submitting || submitted}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : submitted ? (
                  <>
                    <Check className="h-4 w-4" />
                    You're on the list!
                  </>
                ) : (
                  <>
                    <Gift className="h-4 w-4" />
                    Send feedback & claim perks
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Plans;
