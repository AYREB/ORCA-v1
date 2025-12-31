import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import {
  Bookmark,
  Pencil,
  Trash2,
  BarChart3,
  Eye,
  Loader2,
  Play,
  Activity,
  Shuffle,
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { api, SavedStrategy } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BacktestResults from "@/components/backtest/BacktestResults";
import ChartView from "@/components/backtest/ChartView";
import GarchAnalysis from "@/components/backtest/GarchAnalysis";
import MonteCarloAnalysis from "@/components/backtest/MonteCarloAnalysis";
import BacktestForm from "@/components/backtest/BacktestForm";
import { api as djangoApi } from "@/lib/api";

const Strategies = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<SavedStrategy | null>(null);
  const [editStrategy, setEditStrategy] = useState<SavedStrategy | null>(null);
  const [editName, setEditName] = useState("");
  const [editDsl, setEditDsl] = useState("");
  const [editDslJson, setEditDslJson] = useState<Record<string, any> | null>(null);
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningId, setIsRunningId] = useState<number | null>(null);

  const loadStrategies = async () => {
    setIsLoading(true);
    try {
      const data = await api.fetchStrategies();
      setStrategies(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load strategies";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const runStrategy = async (strategy: SavedStrategy) => {
    setIsRunningId(strategy.id);
    try {
      let result;
      let dslJson: Record<string, any> | null = strategy.dslJson || null;

      if (dslJson && Object.keys(dslJson).length > 0) {
        result = await djangoApi.backtestDSLJSON(dslJson);
      } else {
        // Try to parse raw DSL as JSON first, otherwise treat as text
        try {
          const parsed = JSON.parse(strategy.dsl || "{}");
          if (parsed && typeof parsed === "object") {
            dslJson = parsed as Record<string, any>;
            result = await djangoApi.backtestDSLJSON(dslJson);
          } else {
            result = await djangoApi.backtestDSLText(strategy.dsl || "");
          }
        } catch {
          result = await djangoApi.backtestDSLText(strategy.dsl || "");
        }
      }

      const updated = await djangoApi.updateStrategy(strategy.id, {
        lastResult: result,
        dslJson: dslJson || undefined,
      });

      setStrategies((prev) => prev.map((s) => (s.id === strategy.id ? { ...updated } : s)));
      if (selectedStrategy?.id === strategy.id) {
        setSelectedStrategy(updated);
      }
      toast.success("Backtest re-run and saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run backtest";
      toast.error(message);
    } finally {
      setIsRunningId(null);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  const handleOpenResults = (strategy: SavedStrategy) => {
    setSelectedStrategy(strategy);
    setIsResultsOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteStrategy(id);
      await loadStrategies();
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(null);
        setIsResultsOpen(false);
      }
      toast.success("Strategy deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete strategy";
      toast.error(message);
    }
  };

  const handleOpenEdit = (strategy: SavedStrategy) => {
    setEditStrategy(strategy);
    setEditName(strategy.name);
    const parsedJson =
      strategy.dslJson ||
      (() => {
        try {
          const parsed = JSON.parse(strategy.dsl || "{}");
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      })();
    setEditDslJson(parsedJson);
    setEditDsl(strategy.dsl || JSON.stringify(parsedJson ?? {}, null, 2) || "");
    setIsEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!editStrategy) return;
    if (!editName.trim()) {
      toast.error("Please enter a strategy name");
      return;
    }
    setIsSaving(true);
    try {
      const updated = await api.updateStrategy(editStrategy.id, {
        name: editName.trim(),
        dsl: editDsl,
        dslJson: editDslJson ?? undefined,
      });
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? { ...updated } : s)));
      if (selectedStrategy?.id === updated.id) {
        setSelectedStrategy(updated);
      }
      toast.success("Strategy updated");
      setIsEditOpen(false);
      await loadStrategies();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update strategy";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const getPerformance = (strategy: SavedStrategy) => {
    const pctChange = strategy.lastResult?.pct_change;
    if (pctChange === undefined || pctChange === null) return null;
    return `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%`;
  };

  const hasStrategies = useMemo(() => strategies.length > 0, [strategies]);
  const selectedTrades = selectedStrategy?.lastResult?.trades ?? [];

  return (
    <>
      <Helmet>
        <title>Strategies - Orca</title>
        <meta name="description" content="Review, edit, and manage your saved trading strategies." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <main className={`transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Bookmark className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Saved Strategies</h1>
                  <p className="text-sm text-muted-foreground">
                    Browse, review results, and refine your saved playbook.
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={loadStrategies} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Refreshing
                  </>
                ) : (
                  <>
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Refresh
                  </>
                )}
              </Button>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-44 rounded-xl border border-border bg-card/50 animate-pulse"
                  />
                ))}
              </div>
            ) : hasStrategies ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {strategies.map((strategy, index) => (
                  <motion.div
                    key={strategy.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.05 }}
                  >
                    <Card
                      className="border-border bg-card/60 backdrop-blur cursor-pointer transition-shadow hover:shadow-lg"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        // Ignore clicks that originated from buttons inside the card
                        if ((e.target as HTMLElement).closest("button")) return;
                        handleOpenResults(strategy);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenResults(strategy);
                        }
                      }}
                    >
                      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                        <div className="space-y-1">
                          <CardTitle className="text-lg">{strategy.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(strategy.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(strategy);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(strategy.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="p-3 rounded-lg border border-border bg-secondary/30 min-h-[64px]">
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {strategy.dsl || "No DSL text saved yet."}
                          </p>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <BarChart3 className="h-4 w-4" />
                            <span>
                              Last run{" "}
                              {strategy.lastRun
                                ? new Date(strategy.lastRun).toLocaleDateString()
                                : "—"}
                            </span>
                          </div>
                          {getPerformance(strategy) && (
                            <span
                              className={`text-sm font-semibold ${
                                (strategy.lastResult?.pct_change || 0) >= 0
                                  ? "text-green-500"
                                  : "text-destructive"
                              }`}
                            >
                              {getPerformance(strategy)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenResults(strategy);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Results
                          </Button>
                          <Button
                            className="flex-1"
                            variant="hero"
                            onClick={(e) => {
                              e.stopPropagation();
                              runStrategy(strategy);
                            }}
                            disabled={isRunningId === strategy.id}
                          >
                            {isRunningId === strategy.id ? (
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
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                  <Bookmark className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No strategies yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Run a backtest and save it to see your strategies here. Your saved results stay private to your account.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      <Dialog open={isResultsOpen} onOpenChange={setIsResultsOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{selectedStrategy?.name}</DialogTitle>
          </DialogHeader>
          {selectedStrategy?.lastResult ? (
            <Tabs defaultValue="numerical" className="w-full">
              <TabsList className="mb-4 bg-card/50 border border-border">
                <TabsTrigger value="numerical">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Numerical
                </TabsTrigger>
                <TabsTrigger value="chart">
                  <Eye className="h-4 w-4 mr-2" />
                  Chart
                </TabsTrigger>
                <TabsTrigger value="garch">
                  <Activity className="h-4 w-4 mr-2" />
                  GARCH
                </TabsTrigger>
                <TabsTrigger value="montecarlo">
                  <Shuffle className="h-4 w-4 mr-2" />
                  Monte Carlo
                </TabsTrigger>
              </TabsList>
              <TabsContent value="numerical">
                <BacktestResults results={selectedStrategy.lastResult} />
              </TabsContent>
              <TabsContent value="chart">
                <ChartView results={selectedStrategy.lastResult} />
              </TabsContent>
              <TabsContent value="garch">
                <GarchAnalysis />
              </TabsContent>
              <TabsContent value="montecarlo">
                {selectedTrades.length >= 2 ? (
                  <MonteCarloAnalysis trades={selectedTrades} />
                ) : (
                  <div className="p-6 rounded-xl border border-border bg-card/60 text-sm text-muted-foreground">
                    Run this strategy to generate at least two completed trades before running Monte Carlo analysis.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="p-6 rounded-xl border border-border bg-card/60 text-sm text-muted-foreground">
              No saved results for this strategy yet. Run a backtest and save it to capture results.
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Strategy</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Visual Strategy Builder</label>
              <div className="border border-border rounded-xl bg-card/30 p-3">
                <BacktestForm
                  onRunBacktest={() => {}}
                  initialDslJson={editStrategy?.dslJson || editDslJson || null}
                  onDslChange={(json, text) => {
                    setEditDslJson(json);
                    setEditDsl(text);
                  }}
                  showActions={false}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Strategy DSL (raw)</label>
              <Textarea
                value={editDsl}
                onChange={(e) => {
                  const text = e.target.value;
                  setEditDsl(text);
                  try {
                    const parsed = JSON.parse(text);
                    if (parsed && typeof parsed === "object") {
                      setEditDslJson(parsed);
                    }
                  } catch {
                    // ignore parse errors, keep last valid json
                  }
                }}
                className="min-h-[160px] font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Strategies;
