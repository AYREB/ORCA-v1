import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Sliders, Loader2, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { api, OptimizationResult, ParameterChoice } from "@/lib/api";

interface ParameterOptimizerProps {
  dslJson: Record<string, unknown> | null;
}

// Extract optimizable parameters from DSL
function extractOptimizableParameters(
  node: unknown,
  path = "",
  parentIndicator: string | null = null
): Record<string, { value: number; indicator: string | null }> {
  const params: Record<string, { value: number; indicator: string | null }> = {};

  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      Object.assign(params, extractOptimizableParameters(item, `${path}[${i}]`, parentIndicator));
    });
  } else if (typeof node === "object" && node !== null) {
    let currentIndicator = parentIndicator;
    const nodeObj = node as Record<string, unknown>;

    if (nodeObj.func && typeof nodeObj.func === "string") {
      currentIndicator = nodeObj.func;
    }

    Object.entries(nodeObj).forEach(([key, value]) => {
      const newPath = path ? `${path}.${key}` : key;

      if (typeof value === "number" && /period|percent|threshold|offset|value|amount/i.test(key)) {
        params[newPath] = { value, indicator: currentIndicator };
      }

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

const ParameterOptimizer = ({ dslJson }: ParameterOptimizerProps) => {
  const [paramChoices, setParamChoices] = useState<Record<string, ParameterChoice>>({});
  const [initialBalance, setInitialBalance] = useState(10000);
  const [optimizerResult, setOptimizerResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);

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

    try {
      const payload: Record<string, ParameterChoice> = {};
      Object.entries(paramChoices).forEach(([param, choice]) => {
        if (choice.mode !== "nochange") {
          payload[param] = choice;
        }
      });

      if (Object.keys(payload).length === 0) {
        toast.error("Select at least one parameter to optimize");
        setLoading(false);
        return;
      }

      const result = await api.optimizeParameters(dslJson, payload, initialBalance);
      setOptimizerResult(result);
      toast.success("Optimization complete!");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Optimizer request failed";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const activeParams = useMemo(() => {
    return Object.entries(paramChoices).filter(([_, choice]) => choice.mode !== "nochange").length;
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
          {/* Best Result */}
          <div className="p-4 rounded-lg bg-success/10 border border-success/30">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-5 w-5 text-success" />
              <h4 className="font-semibold text-success">Best Result</h4>
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
    </motion.div>
  );
};

export default ParameterOptimizer;
