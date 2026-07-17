import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Play, Lock, TrendingUp, Bot, User } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { DEMO_FIXTURES, DEMO_ORDER, DemoFixture } from "./demo-fixtures";
import { trackDemoEvent } from "@/lib/tracker";

interface LandingDemoProps {
  onSignupClick: () => void;
}

// One free run, then every interaction routes to signup — anonymous visitors
// never touch the backtest engine or the GPU; results are real, pre-computed.
type Phase = "idle" | "thinking" | "parsed" | "running" | "done";

const shortMonth = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums sm:text-lg ${accent ? "text-emerald-500" : ""}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

const LandingDemo = ({ onSignupClick }: LandingDemoProps) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState<DemoFixture | null>(null);
  const hasRunRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const gate = (from: string) => {
    trackDemoEvent(`/demo/gated-${from}`);
    onSignupClick();
  };

  const pickPrompt = (key: string) => {
    if (hasRunRef.current) {
      gate("another-idea");
      return;
    }
    if (phase !== "idle") return;
    hasRunRef.current = true; // one shot — even if they abandon mid-way
    const fixture = DEMO_FIXTURES[key];
    setActive(fixture);
    setPhase("thinking");
    trackDemoEvent(`/demo/prompt-${key}`);
    timers.current.push(setTimeout(() => setPhase("parsed"), 1800));
  };

  const run = () => {
    setPhase("running");
    timers.current.push(
      setTimeout(() => {
        setPhase("done");
        trackDemoEvent("/demo/ran");
      }, 1300),
    );
  };

  return (
    <section className="relative px-4 pb-20 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-2xl border border-primary/20 bg-card/60 shadow-xl shadow-primary/5 backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3 sm:px-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Try it right now — no account needed</p>
              <p className="text-[11px] text-muted-foreground">
                Pick a strategy idea, watch Orca test it against real market history.
              </p>
            </div>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            {/* Prompt chips */}
            <div className="flex flex-col gap-2">
              {DEMO_ORDER.map((key) => {
                const f = DEMO_FIXTURES[key];
                const isActive = active === f;
                const locked = hasRunRef.current && !isActive;
                return (
                  <button
                    key={key}
                    onClick={() => pickPrompt(key)}
                    className={`group flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs transition-colors sm:text-[13px] ${
                      isActive
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/60 bg-background/50 hover:border-primary/40 hover:bg-primary/5"
                    }`}
                  >
                    {locked ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Play className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className={locked ? "text-muted-foreground" : ""}>“{f.prompt}”</span>
                  </button>
                );
              })}
            </div>

            {/* Fake input — typing is the hook that converts */}
            <button
              onClick={() => gate("own-idea")}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/40 px-3.5 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <User className="h-3.5 w-3.5 shrink-0" />
              Type your own idea… <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">free account</span>
            </button>

            {/* Conversation area */}
            <AnimatePresence>
              {active && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="space-y-3 overflow-hidden"
                >
                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-xl border border-primary/20 bg-primary/15 px-3 py-2 text-xs">
                      {active.prompt}
                    </div>
                  </div>

                  {/* AI thinking / parsed */}
                  <div className="flex gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    {phase === "thinking" ? (
                      <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
                            animate={{ opacity: [0.25, 1, 0.25] }}
                            transition={{ duration: 1, repeat: Infinity, delay: i * 0.22 }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="w-full max-w-md rounded-xl border border-border bg-card px-3 py-2.5">
                        <p className="mb-2 text-xs">
                          Got it — here's your strategy: <span className="font-semibold">{active.summary.direction} {active.summary.ticker}</span> on the {active.summary.timeframe.toLowerCase()} chart.
                        </p>
                        <div className="space-y-1 rounded-lg bg-secondary/30 p-2.5">
                          <SummaryRow label="Entry" value={active.summary.entry} />
                          <SummaryRow label="Exit" value={active.summary.exit} />
                          <SummaryRow label="Stop loss / Take profit" value={`${active.summary.stopLoss} / ${active.summary.takeProfit}`} />
                          <SummaryRow label="Tested over" value={active.summary.period} />
                        </div>
                        {phase === "parsed" && (
                          <Button size="sm" className="mt-2.5 w-full" onClick={run}>
                            <Play className="mr-1.5 h-3.5 w-3.5" /> Run backtest
                          </Button>
                        )}
                        {phase === "running" && (
                          <div className="mt-2.5 h-8 overflow-hidden rounded-md bg-secondary/50">
                            <motion.div
                              className="h-full bg-primary/25"
                              initial={{ width: "5%" }}
                              animate={{ width: "95%" }}
                              transition={{ duration: 1.2, ease: "easeOut" }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Results */}
                  {phase === "done" && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="rounded-xl border border-border bg-background/60 p-3.5"
                    >
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                        Results — ${active.stats.initialBalance.toLocaleString()} starting balance
                      </div>
                      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label="Return" value={`+${active.stats.returnPct}%`} accent />
                        <Stat label="Win rate" value={`${active.stats.winRate}%`} />
                        <Stat label="Trades" value={String(active.stats.trades)} />
                        <Stat label="Final" value={`$${Math.round(active.stats.finalBalance).toLocaleString()}`} accent />
                      </div>
                      <div className="h-36 sm:h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={active.equityCurve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="demoEq" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="t" tickFormatter={shortMonth} tick={{ fontSize: 10, fill: "rgba(148,163,184,0.7)" }}
                              interval="preserveStartEnd" minTickGap={48} axisLine={false} tickLine={false} />
                            <YAxis domain={["auto", "auto"]} width={44} tick={{ fontSize: 10, fill: "rgba(148,163,184,0.7)" }}
                              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                            <RTooltip
                              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                              formatter={(v) => [`$${Number(v).toLocaleString()}`, "Equity"]}
                              labelFormatter={(l) => shortMonth(String(l))}
                            />
                            <Area type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2} fill="url(#demoEq)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>

                      {/* The conversion moment */}
                      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <Button variant="hero" className="flex-1" onClick={() => gate("cta")}>
                          <Sparkles className="mr-1.5 h-4 w-4" /> Test your own idea — free
                        </Button>
                        <button
                          onClick={() => gate("trades")}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          View all {active.stats.trades} trades
                        </button>
                      </div>
                      <p className="mt-2 text-center text-[10px] text-muted-foreground/70 sm:text-left">
                        Real backtest, pre-run with Orca. Past performance doesn't guarantee future results.
                      </p>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default LandingDemo;
