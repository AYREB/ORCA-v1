import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, Rocket, ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError, PublicPlan, PlanSummary, PlanSlug, isPlanLimitError } from "@/lib/api";

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
const CAP_LABEL: Record<string, string> = {
  strategies: "Saved strategies",
  paper_accounts: "Paper accounts",
  custom_indicators: "Custom indicators",
};
const METHOD_LABEL: Record<string, string> = {
  grid: "Grid search",
  genetic: "Genetic",
  meta: "Metaheuristics",
};

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "Unlimited" : String(v));

/** Build the ordered feature rows shown on each plan card. */
function featureRows(plan: PublicPlan): string[] {
  const methods = plan.optimizer_methods.map((m) => METHOD_LABEL[m] ?? m).join(", ");
  return [
    `${fmt(plan.monthly.ai)} AI generations / mo`,
    `${fmt(plan.monthly.backtest)} backtests / mo`,
    `${fmt(plan.monthly.optimize)} optimizer runs / mo`,
    `Optimizers: ${methods}`,
    `Up to ${fmt(plan.optimize_intensity)} backtests per optimization`,
    `${fmt(plan.caps.strategies)} saved strategies`,
    `${fmt(plan.caps.paper_accounts)} paper accounts`,
    `${fmt(plan.caps.custom_indicators)} custom indicators`,
    plan.timeframes === "*" ? "All timeframes" : `Timeframes: ${(plan.timeframes as string[]).join(", ")}`,
  ];
}

const Plans = () => {
  const { user, refreshUser } = useAuth();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [summary, setSummary] = useState<PlanSummary | null>(user?.plan ?? null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<PlanSlug | null>(null);

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

  const handleUpgrade = async (plan: PlanSlug) => {
    if (plan === currentPlan) return;
    setSwitching(plan);
    try {
      // No paywall yet — anyone can self-select their plan. Billing (Stripe)
      // will replace this free switch later.
      await api.switchPlan(plan);
      await Promise.all([refreshUser(), api.getPlan().then(setSummary)]);
      toast.success(`Switched to ${plan.charAt(0).toUpperCase() + plan.slice(1)}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast("Payments are coming soon", {
          description: "You'll be able to upgrade right here. Hang tight!",
        });
      } else if (isPlanLimitError(err)) {
        // handled by the global dialog
      } else {
        toast.error(err instanceof Error ? err.message : "Could not change plan.");
      }
    } finally {
      setSwitching(null);
    }
  };

  return (
    <DashboardLayout>
      <PageHeader
        icon={Sparkles}
        eyebrow="Subscription"
        title="Plans & Usage"
        description="Pick the plan that fits how you trade. Upgrade or downgrade anytime."
      />

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
            <span className="text-xs text-muted-foreground">Resets monthly · {summary.period}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {Object.keys(summary.limits.monthly).map((metric) => {
              const used = summary.usage[metric] ?? 0;
              const limit = summary.limits.monthly[metric];
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
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Pricing cards */}
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
                ) : (
                  <Button
                    variant={isFeatured ? "default" : "outline"}
                    className="w-full gap-1.5"
                    disabled={switching !== null}
                    onClick={() => handleUpgrade(plan.plan)}
                  >
                    {switching === plan.plan ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {plan.price_usd > (summary?.price_usd ?? 0) ? "Upgrade" : "Switch"} to {plan.label}
                        <ArrowUpRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        No billing yet — pick whichever plan you'd like. Secure checkout is coming soon.
      </p>
    </DashboardLayout>
  );
};

export default Plans;
