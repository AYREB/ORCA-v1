import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Sliders, Loader2, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api, OptimizationResult, ParameterChoice, OptimizerJobStatus, BacktestResult, SavedStrategy } from "@/lib/api";

interface ParameterOptimizerProps {
  dslJson: Record<string, unknown> | null;
  strategyId?: number | null;
  strategyName?: string | null;
  onBestApplied?: (result: BacktestResult, strategy?: { id?: number; name: string }) => void;
}

// Extract optimizable parameters from DSL
function extractOptimizableParameters(
  node: unknown,
  path = "",
  parentIndicator: string | null = null
): Record<string, { value: number; indicator: string | null }> {
  const params: Record<string, { value: number; indicator: string | null }> = {};

  // Capture numeric leaf nodes (skip booleans masquerading as numbers)
  if (typeof node === "number" && Number.isFinite(node)) {
    if (path) {
      params[path] = { value: node, indicator: parentIndicator };
    }
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

  if (paramPath.includes(".arg.") && indicator) {
    return `${indicator} - ${paramName}`;
  }

  return paramName;
}

const ParameterOptimizer = ({ dslJson, strategyId, strategyName, onBestApplied }: ParameterOptimizerProps) => {
  const [paramChoices, setParamChoices] = useState<Record<string, ParameterChoice>>({});
  const [initialBalance, setInitialBalance] = useState(10000);
  const [optimizerResult, setOptimizerResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [totalRunsState, setTotalRunsState] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [runErrors, setRunErrors] = useState<OptimizationResult["errors"]>([]);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyMode, setApplyMode] = useState<"overwrite" | "new">("overwrite");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [strategiesCache, setStrategiesCache] = useState<SavedStrategy[]>([]);

  // Extract parameters when DSL changes
  useEffect(() => {
    if (dslJson) {
      const params = extractOptimizableParameters(dslJson);
      const initialChoices: Record<string, ParameterChoice> = {};
      Object.entries(params).forEach(([param, info]) => {
        initialChoices[param] = { mode: "nochange", indicator: info.indicator || undefined };
      });
      setParamChoices(initialChoices);
    }
  }, [dslJson]);

  const handleModeChange = (param: string, mode: ParameterChoice["mode"]) => {
    setParamChoices((prev) => {
      const current = prev[param] || {};
      const updated = { ...prev };

      if (mode === "manual") {
        updated[param] = { ...current, mode, values: [0] };
      } else if (mode === "range") {
        updated[param] = { ...current, mode, start: 0, end: 1, steps: 4 };
      } else if (mode === "auto") {
        updated[param] = { ...current, mode: "auto" };
      } else if (mode === "nochange") {
        updated[param] = { ...current, mode: "nochange" };
      }

      return updated;
    });
  };

  const handleValueChange = (param: string, index: number, value: number) => {
    setParamChoices((prev) => {
      const newValues = [...(prev[param].values || [])];
      newValues[index] = value;
      return { ...prev, [param]: { ...prev[param], values: newValues } };
    });
  };

  const handleRangeChange = (param: string, field: "start" | "end" | "steps", value: number) => {
    setParamChoices((prev) => ({
      ...prev,
      [param]: { ...prev[param], [field]: value },
    }));
  };

  const addManualValue = (param: string) => {
    setParamChoices((prev) => {
      const current = prev[param] || { mode: "manual", values: [] };
      return {
        ...prev,
        [param]: { ...current, values: [...(current.values || []), 0] },
      };
    });
  };

  const removeManualValue = (param: string, index: number) => {
    setParamChoices((prev) => {
      const current = prev[param];
      if (!current || !current.values) return prev;
      const newValues = [...current.values];
      newValues.splice(index, 1);
      return {
        ...prev,
        [param]: { ...current, values: newValues },
      };
    });
  };

  const submitOptimizer = async () => {
    if (!dslJson) {
      toast.error("No DSL available. Run a backtest first.");
      return;
    }

    setLoading(true);
    setError(null);
    setOptimizerResult(null);
    setRunErrors([]);
    setCompletedRuns(0);
    setTotalRunsState(0);
    setProgress(0);

    try {
      const payload: Record<string, ParameterChoice> = {};
      Object.entries(paramChoices).forEach(([param, choice]) => {
        if (choice.mode !== "nochange") {
          if (choice.mode === "manual" && (!choice.values || choice.values.length === 0)) {
            throw new Error(`Add at least one value for ${param}`);
          }
          if (choice.mode === "range" && (!choice.steps || choice.steps < 2)) {
            throw new Error(`Range for ${param} needs at least 2 steps`);
          }
          payload[param] = choice;
        }
      });

      if (Object.keys(payload).length === 0) {
        toast.error("Select at least one parameter to optimize");
        setLoading(false);
        return;
      }

      const start = await api.startOptimizeJob(dslJson, payload, initialBalance);
      setTotalRunsState(start.total_runs || totalRuns);

      const poll = async () => {
        if (!start.job_id) return;
        const status: OptimizerJobStatus = await api.getOptimizeJobStatus(start.job_id);
        setCompletedRuns(status.completed_runs);
        setTotalRunsState(status.total_runs);
        setProgress(status.progress);

        if (status.status === "completed" && status.result) {
          setOptimizerResult(status.result);
          setRunErrors(status.result.errors || []);
          setLoading(false);
          toast.success("Optimization complete!");
          return;
        }
        if (status.status === "error") {
          setError(status.error || "Optimizer failed");
          setLoading(false);
          return;
        }
        window.setTimeout(poll, 1000);
      };

      poll();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Optimizer request failed";
      setError(errorMessage);
      toast.error(errorMessage);
      setProgress(0);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 500);
    }
  };

  const activeParams = useMemo(() => {
    return Object.entries(paramChoices).filter(([_, choice]) => choice.mode !== "nochange").length;
  }, [paramChoices]);

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

  const bestDsl = optimizerResult?.best_result?.dsl as Record<string, unknown> | undefined;

  const handleOpenApply = async () => {
    if (!optimizerResult?.best_result) {
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
    if (!optimizerResult?.best_result || !bestDsl) return;
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

      let savedMeta: { id?: number; name: string } | undefined = undefined;

      if (mode === "overwrite") {
        if (strategyId) {
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

  const setAllToAuto = () => {
    setParamChoices((prev) => {
      const next: Record<string, ParameterChoice> = {};
      Object.entries(prev).forEach(([key, val]) => {
        next[key] = { ...val, mode: "auto" };
      });
      return next;
    });
  };

  const totalRuns = useMemo(() => {
    const active = Object.entries(paramChoices).filter(([_, c]) => c.mode !== "nochange");
    if (active.length === 0) return 0;

    let total = 1;
    for (const [, choice] of active) {
      let count = 0;
      if (choice.mode === "auto") {
        count = 3; // auto generates a small neighborhood
      } else if (choice.mode === "manual") {
        count = choice.values?.length || 0;
      } else if (choice.mode === "range") {
        count = choice.steps || 0;
      }
      if (count === 0) return 0;
      total *= count;
    }
    return total;
  }, [paramChoices]);

  if (!dslJson) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-card/30"
      >
        <div className="text-center">
          <Sliders className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold mb-2">No Strategy Loaded</h3>
          <p className="text-muted-foreground max-w-sm">
            Run a backtest first to load a strategy, then you can optimize its parameters.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Sliders className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Parameter Optimizer</h3>
            <p className="text-sm text-muted-foreground">
              Configure parameters to optimize
            </p>
          </div>
        </div>

        {/* Initial Balance */}
        <div className="mb-6">
          <Label className="text-sm text-muted-foreground">Initial Balance</Label>
          <Input
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
            className="mt-1 w-48 bg-secondary border-border font-mono"
          />
        </div>

        {/* Parameters List */}
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {Object.entries(paramChoices).map(([param, choice]) => (
              <div
                key={param}
                className="p-4 rounded-lg bg-secondary/30 border border-border"
              >
                <div className="flex items-center justify-between mb-3">
                  <Label className="font-medium font-mono text-sm">
                    {getDisplayName(param, choice.indicator || null)}
                  </Label>
                  <Select
                    value={choice.mode}
                    onValueChange={(value) => handleModeChange(param, value as ParameterChoice["mode"])}
                  >
                    <SelectTrigger className="w-32 h-8 bg-secondary border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nochange">No Change</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="range">Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {choice.mode === "manual" && (
                  <div className="space-y-2">
                    {choice.values?.map((val, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={val}
                          onChange={(e) => handleValueChange(param, i, Number(e.target.value))}
                          className="w-24 h-8 bg-secondary border-border font-mono"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeManualValue(param, i)}
                          className="h-8 px-2 text-destructive"
                        >
                          −
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addManualValue(param)}
                      className="h-8"
                    >
                      + Add Value
                    </Button>
                  </div>
                )}

                {choice.mode === "range" && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Start</Label>
                      <Input
                        type="number"
                        value={choice.start || 0}
                        onChange={(e) => handleRangeChange(param, "start", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">End</Label>
                      <Input
                        type="number"
                        value={choice.end || 0}
                        onChange={(e) => handleRangeChange(param, "end", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Steps</Label>
                      <Input
                        type="number"
                        value={choice.steps || 0}
                        onChange={(e) => handleRangeChange(param, "steps", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Run Button */}
        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-primary">{activeParams}</span> parameters selected
            </p>
            <p className="text-sm text-muted-foreground">
              {totalRunsState || totalRuns ? `${totalRunsState || totalRuns} runs` : "Add values to run"}
            </p>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <Button variant="outline" size="sm" className="w-full" onClick={setAllToAuto}>
              Set all to Auto
            </Button>
          </div>
          <Button
            className="w-full"
            onClick={submitOptimizer}
            disabled={loading || activeParams === 0}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running Optimizer...
              </>
            ) : (
              "Run Optimizer"
            )}
          </Button>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span className="font-mono">
                {completedRuns}/{totalRunsState || totalRuns} ({progress.toFixed(0)}%)
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden border border-border">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive">
          Error: {error}
        </div>
      )}

      {/* Results */}
      {optimizerResult && (
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
          {/* Best Result */}
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
                  {optimizerResult.best_result.results.pct_change?.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Final Balance</p>
                <p className="text-xl font-bold font-mono">
                  ${optimizerResult.best_result.results.final_balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trades</p>
                <p className="text-xl font-bold font-mono">
                  {optimizerResult.best_result.results.num_trades}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">Optimized Parameters</p>
              <pre className="p-3 rounded bg-secondary/50 text-sm font-mono overflow-x-auto">
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(optimizerResult.best_result.params).filter(
                      ([_, val]) => val !== undefined && val !== null
                    )
                  ),
                  null,
                  2
                )}
              </pre>
            </div>
          </div>

          {/* All Results Toggle */}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setShowAllResults(!showAllResults)}
          >
            {showAllResults ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Hide All Results ({optimizerResult.all_backtests.length})
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Show All Results ({optimizerResult.all_backtests.length})
              </>
            )}
          </Button>

          {showAllResults && (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {optimizerResult.all_backtests.map((backtest, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg bg-secondary/30 border border-border flex items-center justify-between"
                  >
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
            <DialogDescription>
              Apply the optimized DSL to a backtest and save it as a strategy.
            </DialogDescription>
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
              <Input
                value={newStrategyName}
                onChange={(e) => setNewStrategyName(e.target.value)}
                placeholder="My Optimized Strategy"
              />
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
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Applying...
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

export default ParameterOptimizer;
