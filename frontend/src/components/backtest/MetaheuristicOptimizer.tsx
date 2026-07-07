import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Trophy, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  api,
  OptimiserJobStatus,
  OptimiserMethod,
  OptimizationResult,
  ParameterChoice,
  BacktestResult,
  SavedStrategy,
} from "@/lib/api";

export interface OptimiserSettingField {
  key: string;
  label: string;
  step?: number;
  /** Explains what the parameter controls and how changing it affects the search. */
  description?: string;
}

interface MetaheuristicOptimizerProps {
  method: OptimiserMethod;
  label: string;
  description: string;
  icon: LucideIcon;
  settingsSchema: OptimiserSettingField[];
  defaults: Record<string, number>;
  estimateRuns: (settings: Record<string, number>) => number;
  /** Plain-language explanation of how this optimizer works, shown at the top. */
  howItWorks?: string;
  dslJson: Record<string, unknown> | null;
  strategyId?: number | null;
  strategyName?: string | null;
  onBestApplied?: (result: BacktestResult, strategy?: { id?: number; name: string }) => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

import { isOptimizableParameterPath } from "@/lib/paramDomains";

function extractOptimizableParameters(
  node: unknown,
  path = "",
  parentIndicator: string | null = null
): Record<string, { value: number; indicator: string | null }> {
  const params: Record<string, { value: number; indicator: string | null }> = {};

  if (typeof node === "number" && Number.isFinite(node)) {
    if (path && isOptimizableParameterPath(path)) params[path] = { value: node, indicator: parentIndicator };
    return params;
  }

  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      Object.assign(params, extractOptimizableParameters(item, itemPath, parentIndicator));
    });
  } else if (typeof node === "object" && node !== null) {
    let currentIndicator = parentIndicator;
    const nodeObj = node as Record<string, unknown>;
    if (nodeObj.func && typeof nodeObj.func === "string") {
      currentIndicator = nodeObj.func;
    }
    Object.entries(nodeObj).forEach(([key, value]) => {
      const newPath = path ? `${path}.${key}` : key;
      Object.assign(params, extractOptimizableParameters(value, newPath, currentIndicator));
    });
  }

  return params;
}

function getDisplayName(paramPath: string, indicator: string | null): string {
  const parts = paramPath.split(".");
  const paramName = parts[parts.length - 1];
  if (paramPath.includes(".arg.") && indicator) return `${indicator} - ${paramName}`;
  return paramName;
}

const MetaheuristicOptimizer = ({
  method,
  label,
  description,
  icon: Icon,
  settingsSchema,
  defaults,
  estimateRuns,
  howItWorks,
  dslJson,
  strategyId,
  strategyName,
  onBestApplied,
}: MetaheuristicOptimizerProps) => {
  const [paramChoices, setParamChoices] = useState<Record<string, ParameterChoice>>({});
  const [optSettings, setOptSettings] = useState<Record<string, number>>(defaults);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [runErrors, setRunErrors] = useState<OptimizationResult["errors"]>([]);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyMode, setApplyMode] = useState<"overwrite" | "new">("overwrite");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [strategiesCache, setStrategiesCache] = useState<SavedStrategy[]>([]);
  const [sampledCycleCount, setSampledCycleCount] = useState(0);
  const [sampledCycleSeconds, setSampledCycleSeconds] = useState(0);
  const lastCompletedRef = useRef(0);
  const lastSampleTsRef = useRef<number | null>(null);

  // Reset settings to this method's defaults whenever the method changes.
  useEffect(() => {
    setOptSettings(defaults);
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  useEffect(() => {
    if (dslJson) {
      const params = extractOptimizableParameters(dslJson);
      const initialChoices: Record<string, ParameterChoice> = {};
      Object.entries(params).forEach(([param, info]) => {
        initialChoices[param] = {
          mode: "auto",
          indicator: info.indicator || undefined,
          start: undefined,
          end: undefined,
          steps: undefined,
          enabled: true,
        } as ParameterChoice;
      });
      setParamChoices(initialChoices);
    }
  }, [dslJson]);

  const setGroupEnabled = (group: "arguments" | "conditions", enabled: boolean) => {
    setParamChoices((prev) => {
      const next: Record<string, ParameterChoice> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const upper = key.toUpperCase();
        const isArg = upper.includes("ARGUMENT");
        const isCond = upper.includes("CONDITION");
        const match = group === "arguments" ? isArg : isCond;
        next[key] = match ? ({ ...val, enabled } as ParameterChoice) : val;
      });
      return next;
    });
  };

  const toggleParam = (param: string, enabled: boolean) => {
    setParamChoices((prev) => ({
      ...prev,
      [param]: { ...prev[param], enabled, mode: enabled ? "auto" : "nochange" } as ParameterChoice,
    }));
  };

  const handleRangeChange = (param: string, field: "start" | "end" | "steps", value: number) =>
    setParamChoices((prev) => {
      const enabled = (prev[param] as ParameterChoice)?.enabled !== false;
      return {
        ...prev,
        [param]: { ...prev[param], [field]: value, mode: enabled ? "range" : "nochange", enabled } as ParameterChoice,
      };
    });

  const setAllEnabled = () =>
    setParamChoices((prev) => {
      const next: Record<string, ParameterChoice> = {};
      Object.entries(prev).forEach(([key, val]) => (next[key] = { ...val, mode: "auto", enabled: true } as ParameterChoice));
      return next;
    });

  const ensureStrategies = async () => {
    if (strategiesCache.length > 0) return strategiesCache;
    try {
      const list = await api.fetchStrategies();
      setStrategiesCache(list);
      return list;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load strategies for apply");
      return [];
    }
  };

  const bestDsl = result?.best_result?.dsl as Record<string, unknown> | undefined;

  const handleOpenApply = async () => {
    if (!result?.best_result) {
      toast.error("Run optimizer first");
      return;
    }
    setApplyMode(strategyId ? "overwrite" : "new");
    setNewStrategyName(strategyName || "");
    setApplyError(null);
    await ensureStrategies();
    setShowApplyDialog(true);
  };

  const validateName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a strategy name");
    const list = await ensureStrategies();
    if (list.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A strategy with that name already exists");
    }
    return trimmed;
  };

  const handleApplyBest = async () => {
    if (!result?.best_result || !bestDsl) return;
    setApplying(true);
    setApplyError(null);
    try {
      let chosenName = newStrategyName || strategyName || "";
      const mode = applyMode;
      if (mode === "new" || (!strategyId && mode === "overwrite")) {
        chosenName = await validateName(chosenName);
      }
      const backtestResult = await api.backtestDSLJSON(bestDsl);
      api.setLastBacktestResult(backtestResult);
      let savedMeta: { id?: number; name: string } | undefined;
      if (mode === "overwrite" && strategyId) {
        const updated = await api.updateStrategy(strategyId, {
          name: chosenName || strategyName || undefined,
          dsl: JSON.stringify(bestDsl, null, 2),
          dslJson: bestDsl,
          lastResult: backtestResult,
        });
        savedMeta = { id: updated.id, name: updated.name };
      } else {
        const created = await api.createStrategy({
          name: chosenName,
          dsl: JSON.stringify(bestDsl, null, 2),
          dslJson: bestDsl,
          lastResult: backtestResult,
        });
        savedMeta = { id: created.id, name: created.name };
      }
      onBestApplied?.(backtestResult, savedMeta);
      toast.success("Best parameters applied to backtest");
      setShowApplyDialog(false);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply best result");
    } finally {
      setApplying(false);
    }
  };

  const activeParams = useMemo(
    () => Object.entries(paramChoices).filter(([, choice]) => (choice as ParameterChoice).enabled !== false).length,
    [paramChoices]
  );

  const estimatedRuns = useMemo(() => Math.max(0, Math.round(estimateRuns(optSettings))), [estimateRuns, optSettings]);

  const runningEtaSeconds = useMemo(() => {
    if (!loading) return null;
    if (sampledCycleCount < 3 || totalRuns <= 0) return null;
    const avgSecondsPerRun = sampledCycleSeconds / sampledCycleCount;
    const remainingRuns = Math.max(0, totalRuns - completedRuns);
    return Math.max(0, Math.ceil(avgSecondsPerRun * remainingRuns));
  }, [loading, sampledCycleCount, sampledCycleSeconds, totalRuns, completedRuns]);

  const submit = async () => {
    if (!dslJson) {
      toast.error("No DSL available. Load a strategy first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setRunErrors([]);
    setProgress(0);
    setCompletedRuns(0);
    setTotalRuns(0);
    setSampledCycleCount(0);
    setSampledCycleSeconds(0);
    lastCompletedRef.current = 0;
    lastSampleTsRef.current = Date.now();

    try {
      const payload: Record<string, ParameterChoice> = {};
      Object.entries(paramChoices).forEach(([param, choice]) => {
        if (!isOptimizableParameterPath(param)) return;
        const enabled = (choice as ParameterChoice).enabled !== false;
        if (!enabled) return;
        const hasRange = choice.start !== undefined && choice.end !== undefined && (choice.steps || 0) >= 2;
        payload[param] = {
          ...choice,
          mode: hasRange ? "range" : "auto",
          start: hasRange ? choice.start : undefined,
          end: hasRange ? choice.end : undefined,
          steps: hasRange ? choice.steps : undefined,
        };
      });

      if (Object.keys(payload).length === 0) {
        throw new Error("Select at least one parameter to optimize");
      }

      const start = await api.startOptimiserJob(method, dslJson, payload, initialBalance, optSettings);
      setTotalRuns(start.total_runs || estimatedRuns);

      const poll = async () => {
        const status: OptimiserJobStatus = await api.getOptimiserJobStatus(start.job_id);
        const nowTs = Date.now();
        const currentCompleted = status.completed_runs || 0;
        const previousCompleted = lastCompletedRef.current;
        const previousTs = lastSampleTsRef.current;

        if (previousTs !== null && currentCompleted > previousCompleted) {
          const deltaRuns = currentCompleted - previousCompleted;
          const deltaSeconds = Math.max(0, (nowTs - previousTs) / 1000);
          setSampledCycleCount((prev) => prev + deltaRuns);
          setSampledCycleSeconds((prev) => prev + deltaSeconds);
        }

        lastCompletedRef.current = currentCompleted;
        lastSampleTsRef.current = nowTs;

        setCompletedRuns(currentCompleted);
        setTotalRuns(status.total_runs);
        setProgress(status.progress);
        if (status.status === "completed" && status.result) {
          setResult(status.result);
          setRunErrors(status.result.errors || []);
          setLoading(false);
          toast.success(`${label} complete`);
          return;
        }
        if (status.status === "error") {
          setError(status.error || `${label} failed`);
          setLoading(false);
          return;
        }
        window.setTimeout(poll, 1000);
      };
      poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Optimizer request failed";
      setError(message);
      toast.error(message);
      setLoading(false);
    }
  };

  if (!dslJson) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-card/30"
      >
        <div className="text-center">
          <Icon className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold mb-2">No Strategy Loaded</h3>
          <p className="text-muted-foreground max-w-sm">Select a strategy to run the {label.toLowerCase()}.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6">
      <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">{label}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>

        {howItWorks && (
          <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
              How this optimizer works
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">{howItWorks}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {settingsSchema.map((field) => (
            <div key={field.key}>
              <Label className="text-sm text-muted-foreground">{field.label}</Label>
              <Input
                type="number"
                step={field.step ?? 1}
                value={optSettings[field.key] ?? ""}
                onChange={(e) => setOptSettings((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                className="mt-1 bg-secondary border-border font-mono"
              />
              {field.description && (
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{field.description}</p>
              )}
            </div>
          ))}
          <div>
            <Label className="text-sm text-muted-foreground">Initial Balance</Label>
            <Input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-primary">{activeParams}</span> parameters selected
            </p>
            <p className="text-xs text-muted-foreground">Estimated runs: {estimatedRuns}</p>
            <p className="text-xs text-muted-foreground">Estimated time: measured live from the first few runs</p>
          </div>
          <Button variant="outline" size="sm" onClick={setAllEnabled}>
            Enable all
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Button variant="secondary" size="sm" onClick={() => setGroupEnabled("arguments", true)}>
            Enable arguments
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setGroupEnabled("arguments", false)}>
            Disable arguments
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setGroupEnabled("conditions", true)}>
            Enable conditions
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setGroupEnabled("conditions", false)}>
            Disable conditions
          </Button>
        </div>

        <ScrollArea className="h-[340px] pr-4">
          <div className="space-y-4">
            {Object.entries(paramChoices).map(([param, choice]) => (
              <div key={param} className="p-4 rounded-lg bg-secondary/30 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={(choice as ParameterChoice).enabled !== false}
                      onCheckedChange={(checked) => toggleParam(param, Boolean(checked))}
                    />
                    <Label className="font-medium font-mono text-sm">
                      {getDisplayName(param, choice.indicator || null)}
                    </Label>
                  </div>
                  <div className="text-xs text-muted-foreground">Auto search</div>
                </div>

                {(choice as ParameterChoice).enabled !== false && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Start (optional)</Label>
                      <Input
                        type="number"
                        value={choice.start ?? ""}
                        onChange={(e) => handleRangeChange(param, "start", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                        placeholder="auto"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">End (optional)</Label>
                      <Input
                        type="number"
                        value={choice.end ?? ""}
                        onChange={(e) => handleRangeChange(param, "end", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                        placeholder="auto"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Steps (≥2)</Label>
                      <Input
                        type="number"
                        value={choice.steps ?? ""}
                        onChange={(e) => handleRangeChange(param, "steps", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                        placeholder="3"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="mt-4 p-4 rounded-lg bg-secondary/30 border border-border space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="font-mono">
              {completedRuns}/{totalRuns || estimatedRuns} ({progress.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden border border-border">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Estimated Time</span>
            <span className="font-mono">
              {loading
                ? runningEtaSeconds !== null
                  ? `${formatDuration(runningEtaSeconds)} remaining`
                  : `Calibrating… ${Math.min(sampledCycleCount, 3)}/3 runs`
                : "Available once running"}
            </span>
          </div>
        </div>

        <Button className="w-full mt-4" onClick={submit} disabled={loading || activeParams === 0}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running {label}...
            </>
          ) : (
            `Run ${label}`
          )}
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive">Error: {error}</div>
      )}

      {result && (
        <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm space-y-6">
          {runErrors && runErrors.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-300/50 bg-amber-100/10 text-amber-600">
              <p className="text-sm font-semibold mb-1">Some runs failed</p>
              <ul className="list-disc ml-4 space-y-1 text-xs">
                {runErrors.slice(0, 3).map((e, i) => (
                  <li key={i} className="font-mono">
                    {JSON.stringify(e.params)} → {e.error}
                  </li>
                ))}
                {runErrors.length > 3 && <li className="font-mono">...and {runErrors.length - 3} more</li>}
              </ul>
            </div>
          )}

          <div className="p-4 rounded-lg bg-success/10 border border-success/30">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-5 w-5 text-success" />
              <h4 className="font-semibold text-success">Best Result</h4>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleOpenApply}>
                  Apply Best
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-muted-foreground">Return</p>
                <p className="text-xl font-bold font-mono text-success">
                  {result.best_result.results.pct_change?.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Final Balance</p>
                <p className="text-xl font-bold font-mono">
                  ${result.best_result.results.final_balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trades</p>
                <p className="text-xl font-bold font-mono">{result.best_result.results.num_trades}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">Optimized Parameters</p>
              <pre className="p-3 rounded bg-secondary/50 text-sm font-mono overflow-x-auto">
                {JSON.stringify(result.best_result.params, null, 2)}
              </pre>
            </div>
          </div>

          <Button variant="ghost" className="w-full" onClick={() => setShowAllResults(!showAllResults)}>
            {showAllResults ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Hide All Results ({result.all_backtests.length})
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Show All Results ({result.all_backtests.length})
              </>
            )}
          </Button>

          {showAllResults && (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {result.all_backtests.map((backtest, index) => (
                  <div key={index} className="p-3 rounded-lg bg-secondary/30 border border-border flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground font-mono text-sm">#{index + 1}</span>
                      <span className={`font-mono font-semibold ${backtest.results.pct_change >= 0 ? "text-success" : "text-destructive"}`}>
                        {backtest.results.pct_change?.toFixed(2)}%
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground font-mono">
                      ${backtest.results.final_balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply Best Result</DialogTitle>
            <DialogDescription>Apply the best DSL to a backtest and save it as a strategy.</DialogDescription>
          </DialogHeader>

          <RadioGroup value={applyMode} onValueChange={(v) => setApplyMode(v as "overwrite" | "new")} className="space-y-2">
            <label className="flex items-center gap-2">
              <RadioGroupItem value="overwrite" />
              <span>Overwrite existing strategy {strategyName ? `(${strategyName})` : "(unsaved)"}</span>
            </label>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="new" />
              <span>Create new strategy</span>
            </label>
          </RadioGroup>

          {(applyMode === "new" || (!strategyId && applyMode === "overwrite")) && (
            <div className="mt-2 space-y-1">
              <Label className="text-sm">Strategy Name</Label>
              <Input value={newStrategyName} onChange={(e) => setNewStrategyName(e.target.value)} placeholder="My Optimized Strategy" />
            </div>
          )}

          {applyError && <p className="text-xs text-destructive">{applyError}</p>}

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setShowApplyDialog(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={handleApplyBest} disabled={applying}>
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default MetaheuristicOptimizer;
