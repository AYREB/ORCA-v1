import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { Play, Loader2, ArrowLeft, BarChart3, LineChart, Activity, Shuffle, Sliders, Code, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DSLEditor from "@/components/backtest/DSLEditor";
import BacktestForm from "@/components/backtest/BacktestForm";
import BacktestResults from "@/components/backtest/BacktestResults";
import ChartView from "@/components/backtest/ChartView";
import GarchAnalysis from "@/components/backtest/GarchAnalysis";
import MonteCarloAnalysis from "@/components/backtest/MonteCarloAnalysis";
import ParameterOptimizer from "@/components/backtest/ParameterOptimizer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, BacktestResult } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

type ViewMode = "editor" | "results";
type EntryMode = "form" | "dsl";

const Backtest = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dslText, setDslText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [entryMode, setEntryMode] = useState<EntryMode>("form");
  const [strategyName, setStrategyName] = useState("");
  const [strategyEditorText, setStrategyEditorText] = useState("");
  const [savedStrategyId, setSavedStrategyId] = useState<number | null>(null);
  const [prefillDslJson, setPrefillDslJson] = useState<Record<string, any> | null>(null);
  const [editedDslJson, setEditedDslJson] = useState<Record<string, any> | null>(null);
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
    const currentDslJson = (editedDslJson || prefillDslJson || results.json_dsl) as Record<string, any> | null;
    const dslPayload =
      (strategyEditorText || dslText).trim() ||
      (currentDslJson ? JSON.stringify(currentDslJson, null, 2) : "");
    try {
      const updated = await api.updateStrategy(savedStrategyId, {
        name: strategyName.trim(),
        dsl: dslPayload,
        dslJson: currentDslJson || undefined,
        lastResult: results,
      });
      setStrategyEditorText(updated.dsl);
      setStrategyName(updated.name);
      toast.success("Strategy updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update strategy";
      toast.error(message);
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
    <>
      <Helmet>
        <title>New Backtest - Orca</title>
        <meta name="description" content="Configure and run a new backtest for your trading strategy." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <main className={`transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between mb-6"
            >
              <div className="flex items-center gap-4">
                {viewMode === "results" && (
                  <Button variant="ghost" size="icon" onClick={handleBackToEditor}>
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                )}
                <div>
                  <h1 className="text-2xl font-bold">
                    {viewMode === "editor" ? "New Backtest" : "Backtest Results"}
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    {viewMode === "editor"
                      ? "Define your strategy and run a backtest"
                      : "Analyze your strategy performance"}
                  </p>
                </div>
              </div>

              {viewMode === "editor" && entryMode === "dsl" && (
                <Button
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
              )}
            </motion.div>

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
                    <TabsList className="mb-6 bg-card/50 border border-border p-1">
                      <TabsTrigger value="form" className="gap-2 data-[state=active]:bg-primary/20">
                        <Settings2 className="h-4 w-4" />
                        Easy Mode
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
                  <Tabs defaultValue="numerical" className="w-full">
                    <TabsList className="mb-6 bg-card/50 border border-border p-1">
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
                        GARCH
                      </TabsTrigger>
                      <TabsTrigger value="montecarlo" className="gap-2 data-[state=active]:bg-primary/20">
                        <Shuffle className="h-4 w-4" />
                        Monte Carlo
                      </TabsTrigger>
                      <TabsTrigger value="optimizer" className="gap-2 data-[state=active]:bg-primary/20">
                        <Sliders className="h-4 w-4" />
                        Optimizer
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
                      <GarchAnalysis />
                    </TabsContent>

                    <TabsContent value="montecarlo">
                      <MonteCarloAnalysis trades={results.trades} />
                    </TabsContent>

                    <TabsContent value="optimizer">
                      <ParameterOptimizer dslJson={results.json_dsl} />
                    </TabsContent>

                    <TabsContent value="strategy">
                      <div className="p-4 rounded-xl border border-border bg-card/50 space-y-6">
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
                            <Button variant="hero" className="flex-1" onClick={() => handleSaveStrategy(strategyName)}>
                              Save Strategy
                            </Button>
                            <Button
                              variant="secondary"
                              className="flex-1"
                              disabled={!savedStrategyId}
                              onClick={handleUpdateStrategy}
                            >
                              {savedStrategyId ? "Update Strategy" : "Update (save first)"}
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
          </div>
        </main>
      </div>
    </>
  );
};

export default Backtest;
