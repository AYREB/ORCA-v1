import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Loader2, ArrowLeft, BarChart3, LineChart, Activity, Shuffle, FlaskConical, Code, Settings2, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import RiskDisclaimer from "@/components/RiskDisclaimer";
import DSLEditor from "@/components/backtest/DSLEditor";
import BacktestForm from "@/components/backtest/BacktestForm";
import AIStrategyBuilder from "@/components/backtest/AIStrategyBuilder";
import BacktestResults from "@/components/backtest/BacktestResults";
import ChartView from "@/components/backtest/ChartView";
import GarchAnalysis from "@/components/backtest/GarchAnalysis";
import MonteCarloAnalysis from "@/components/backtest/MonteCarloAnalysis";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, BacktestResult } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

type ViewMode = "editor" | "results";
type EntryMode = "form" | "dsl" | "ai";

const Backtest = () => {
  const [dslText, setDslText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [resultsKey, setResultsKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [entryMode, setEntryMode] = useState<EntryMode>("form");
  const [strategyName, setStrategyName] = useState("");
  const [strategyEditorText, setStrategyEditorText] = useState("");
  const [savedStrategyId, setSavedStrategyId] = useState<number | null>(null);
  const [prefillDslJson, setPrefillDslJson] = useState<Record<string, any> | null>(null);
  const [editedDslJson, setEditedDslJson] = useState<Record<string, any> | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const { user } = useAuth();

  // Load last backtest on mount
  useEffect(() => {
    const lastResult = api.getLastBacktestResult();
    if (lastResult) {
      setResults(lastResult);
    }
  }, []);

  // Handler for DSL Editor mode
  const handleRunBacktest = async () => {
    if (!dslText.trim()) {
      toast.error("Please enter a DSL strategy");
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.backtestDSLText(dslText);
      setResults(result);
      setResultsKey((k) => k + 1);
      api.setLastBacktestResult(result);
      setViewMode("results");
      setStrategyEditorText(dslText);
      toast.success("Backtest completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Backtest failed";
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for Easy Mode - receives results directly from BacktestForm
  const handleEasyModeResults = (result: BacktestResult) => {
    setResults(result);
    setResultsKey((k) => k + 1);
    api.setLastBacktestResult(result);
    setViewMode("results");
    setPrefillDslJson(result.json_dsl as Record<string, any>);
    setEditedDslJson(result.json_dsl as Record<string, any>);
    if (!dslText.trim()) {
      setStrategyEditorText(JSON.stringify(result.json_dsl ?? {}, null, 2));
    }
  };

  const handleSaveStrategy = async (name: string) => {
    if (!user) {
      toast.error("Please log in to save strategies");
      return;
    }

    if (!results) {
      toast.error("Run a backtest before saving the strategy");
      return;
    }

    const currentDslJson = (editedDslJson || prefillDslJson || results.json_dsl) as Record<string, any> | null;
    const dslPayload =
      (strategyEditorText || dslText).trim() ||
      (currentDslJson ? JSON.stringify(currentDslJson, null, 2) : "");

    try {
      const created = await api.createStrategy({
        name,
        dsl: dslPayload,
        dslJson: currentDslJson || undefined,
        lastResult: results,
      });
      setSavedStrategyId(created.id);
      setStrategyName(created.name);
      setStrategyEditorText(created.dsl);
      toast.success("Strategy saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save strategy";
      toast.error(message);
    }
  };

  const handleUpdateStrategy = async () => {
    if (!user) {
      toast.error("Please log in to save strategies");
      return;
    }
    if (!results) {
      toast.error("Run a backtest before saving the strategy");
      return;
    }
    if (!savedStrategyId) {
      toast.error("Save the strategy first, then you can update it.");
      return;
    }
    if (!strategyName.trim()) {
      toast.error("Please enter a strategy name");
      return;
    }
    setIsUpdating(true);
    const dslTextPayload = (strategyEditorText || dslText).trim();
    const currentDslJson = (editedDslJson || prefillDslJson || results.json_dsl) as Record<string, any> | null;
    const dslPayload = dslTextPayload || (currentDslJson ? JSON.stringify(currentDslJson, null, 2) : "");

    try {
      // Re-run backtest to refresh results + charts
      let refreshedResult: BacktestResult;
      if (currentDslJson && Object.keys(currentDslJson).length > 0) {
        refreshedResult = await api.backtestDSLJSON(currentDslJson, {
          strategyId: savedStrategyId,
          strategyName: strategyName.trim(),
        });
      } else if (dslPayload) {
        refreshedResult = await api.backtestDSLText(dslPayload, {
          strategyId: savedStrategyId,
          strategyName: strategyName.trim(),
        });
      } else {
        throw new Error("No strategy DSL to run. Please enter DSL or use the builder.");
      }

      setResults(refreshedResult);
      setResultsKey((k) => k + 1);
      api.setLastBacktestResult(refreshedResult);
      const refreshedDslJson = (refreshedResult.json_dsl || currentDslJson) as Record<string, any> | null;
      setPrefillDslJson(refreshedDslJson);
      setEditedDslJson(refreshedDslJson);

      const updated = await api.updateStrategy(savedStrategyId, {
        name: strategyName.trim(),
        dsl: dslPayload,
        dslJson: refreshedDslJson || undefined,
        lastResult: refreshedResult,
      });
      setStrategyEditorText(updated.dsl);
      setStrategyName(updated.name);
      setViewMode("results");
      toast.success("Strategy updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update strategy";
      toast.error(message);
    }
    setIsUpdating(false);
  };

  // Rerun the backtest with whatever is currently in the Strategy tab's builder /
  // raw DSL — no save required. Updates the saved strategy's results only if one
  // is already linked to this run.
  const handleRerunEdited = async () => {
    const currentDslJson = (editedDslJson || prefillDslJson || results?.json_dsl) as Record<string, any> | null;
    if (!currentDslJson || Object.keys(currentDslJson).length === 0) {
      toast.error("No strategy to run. Edit the builder or the raw DSL first.");
      return;
    }
    setIsRerunning(true);
    try {
      const result = await api.backtestDSLJSON(
        currentDslJson,
        savedStrategyId ? { strategyId: savedStrategyId, strategyName: strategyName.trim() || undefined } : undefined,
      );
      handleEasyModeResults(result);
      toast.success("Backtest re-run with your edits");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backtest failed";
      toast.error(message);
    } finally {
      setIsRerunning(false);
    }
  };

  const handleEditInBuilder = () => {
    const parsedJson =
      results?.json_dsl ||
      (() => {
        try {
          const parsed = JSON.parse(strategyEditorText || dslText || "{}");
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      })();

    if (parsedJson) {
      setPrefillDslJson(parsedJson as Record<string, any>);
      setEditedDslJson(parsedJson as Record<string, any>);
    } else {
      setDslText(strategyEditorText || dslText);
    }
  };

  const handleBackToEditor = () => {
    setViewMode("editor");
  };

  return (
    <DashboardLayout
      title="New Backtest"
      metaDescription="Configure and run a new backtest for your trading strategy."
    >
      <PageHeader
        icon={FlaskConical}
        eyebrow={viewMode === "editor" ? "Strategy lab" : "Run analysis"}
        title={
          <span className="flex items-center gap-3">
            {viewMode === "results" && (
              <Button variant="ghost" size="icon" onClick={handleBackToEditor}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            {viewMode === "editor" ? "New Backtest" : "Backtest Results"}
          </span>
        }
        description={
          viewMode === "editor"
            ? "Define your strategy with the visual builder, AI assistant, or raw DSL — then run it."
            : "Analyze your strategy performance across charts, risk models, and trade logs."
        }
        actions={
          viewMode === "editor" && entryMode === "dsl" ? (
            <Button
              variant="hero"
              onClick={handleRunBacktest}
              disabled={isLoading || !dslText.trim()}
              className="min-w-[140px]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Backtest
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <AnimatePresence mode="wait">
              {viewMode === "editor" ? (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Entry Mode Tabs */}
                  <Tabs value={entryMode} onValueChange={(v) => setEntryMode(v as EntryMode)} className="w-full">
                    <TabsList className="mb-6 flex w-full justify-start overflow-x-auto border border-border/70 bg-card/60 p-1 backdrop-blur-xl md:inline-flex md:w-auto">
                      <TabsTrigger value="form" className="gap-2 data-[state=active]:bg-primary/20">
                        <Settings2 className="h-4 w-4" />
                        Easy Mode
                      </TabsTrigger>
                      <TabsTrigger value="ai" className="gap-2 data-[state=active]:bg-primary/20">
                        <Sparkles className="h-4 w-4" />
                        AI Assistant
                      </TabsTrigger>
                      <TabsTrigger value="dsl" className="gap-2 data-[state=active]:bg-primary/20">
                        <Code className="h-4 w-4" />
                        DSL Editor
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="form">
                      <BacktestForm
                        onRunBacktest={handleEasyModeResults}
                        initialDslJson={prefillDslJson}
                        onDslChange={(json, text) => {
                          setPrefillDslJson(json);
                          setStrategyEditorText(text);
                        }}
                      />
                    </TabsContent>
                    <TabsContent value="ai">
                      <AIStrategyBuilder onRunBacktest={handleEasyModeResults} />
                    </TabsContent>

                    <TabsContent value="dsl">
                      <DSLEditor
                        value={dslText}
                        onChange={setDslText}
                        onRun={handleRunBacktest}
                        onSave={handleSaveStrategy}
                      />
                    </TabsContent>
                  </Tabs>
                </motion.div>
              ) : results ? (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  <RiskDisclaimer className="mb-6" />
                  <Tabs defaultValue="numerical" className="w-full" key={resultsKey}>
                    <TabsList className="mb-6 flex w-full justify-start overflow-x-auto border border-border/70 bg-card/60 p-1 backdrop-blur-xl md:inline-flex md:w-auto">
                      <TabsTrigger value="numerical" className="gap-2 data-[state=active]:bg-primary/20">
                        <BarChart3 className="h-4 w-4" />
                        Numerical
                      </TabsTrigger>
                      <TabsTrigger value="chart" className="gap-2 data-[state=active]:bg-primary/20">
                        <LineChart className="h-4 w-4" />
                        Chart
                      </TabsTrigger>
                      <TabsTrigger value="garch" className="gap-2 data-[state=active]:bg-primary/20">
                        <Activity className="h-4 w-4" />
                        Risk
                      </TabsTrigger>
                      <TabsTrigger value="montecarlo" className="gap-2 data-[state=active]:bg-primary/20">
                        <Shuffle className="h-4 w-4" />
                        Monte Carlo
                      </TabsTrigger>
                      <TabsTrigger value="strategy" className="gap-2 data-[state=active]:bg-primary/20">
                        <Settings2 className="h-4 w-4" />
                        Strategy
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="numerical">
                      <BacktestResults results={results} />
                    </TabsContent>

                    <TabsContent value="chart">
                      <ChartView results={results} />
                    </TabsContent>

                    <TabsContent value="garch">
                      <GarchAnalysis results={results} />
                    </TabsContent>

                    <TabsContent value="montecarlo">
                      <MonteCarloAnalysis trades={results.trades} />
                    </TabsContent>

                    <TabsContent value="strategy">
                      <div className="glass-card space-y-6 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm font-medium">Strategy Name</label>
                            <Input
                              value={strategyName}
                              onChange={(e) => setStrategyName(e.target.value)}
                              placeholder="My Strategy"
                              className="mt-2 bg-secondary border-border"
                            />
                          </div>
                          <div className="flex items-end gap-2">
                            <Button
                              variant="hero"
                              className="flex-1"
                              disabled={isRerunning}
                              onClick={handleRerunEdited}
                            >
                              {isRerunning ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Running...
                                </>
                              ) : (
                                <>
                                  <Play className="h-4 w-4 mr-2" />
                                  Rerun with Edits
                                </>
                              )}
                            </Button>
                            <Button variant="secondary" className="flex-1" onClick={() => handleSaveStrategy(strategyName)}>
                              Save Strategy
                            </Button>
                            <Button
                              variant="secondary"
                              className="flex-1"
                              disabled={!savedStrategyId}
                              onClick={handleUpdateStrategy}
                            >
                              {isUpdating ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Updating...
                                </>
                              ) : savedStrategyId ? (
                                "Update & Rerun"
                              ) : (
                                "Update (save first)"
                              )}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="text-sm font-medium flex items-center gap-2">
                              Visual Strategy Builder
                            </label>
                            <div className="mt-3 border border-border rounded-xl overflow-hidden bg-card/30">
                              <BacktestForm
                                onRunBacktest={handleEasyModeResults}
                                initialDslJson={prefillDslJson || results.json_dsl || null}
                                onDslChange={(json, text) => {
                                  setEditedDslJson(json);
                                  setStrategyEditorText(text);
                                }}
                                showActions={false}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">Raw DSL (optional)</label>
                            <Textarea
                              value={strategyEditorText}
                              onChange={(e) => {
                                const text = e.target.value;
                                setStrategyEditorText(text);
                                try {
                                  const parsed = JSON.parse(text);
                                  if (parsed && typeof parsed === "object") {
                                    setPrefillDslJson(parsed as Record<string, any>);
                                  }
                                } catch {
                                  // ignore parse errors
                                }
                              }}
                              className="min-h-[200px] font-mono text-sm bg-secondary/40 border-border"
                            />
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </motion.div>
        ) : null}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default Backtest;
