import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sliders,
  Dna,
  Shuffle,
  Orbit,
  Thermometer,
  Network,
  Bookmark,
  AlertCircle,
  ArrowLeft,
  Check,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import ParameterOptimizer from "@/components/backtest/ParameterOptimizer";
import GeneticOptimizer from "@/components/backtest/GeneticOptimizer";
import MetaheuristicOptimizer, { type OptimiserSettingField } from "@/components/backtest/MetaheuristicOptimizer";
import SavedStrategies from "@/components/backtest/SavedStrategies";
import { api, OptimiserMethod, SavedStrategy } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

type OptimizerMethod = "parameter" | "genetic" | OptimiserMethod;
type WizardStep = 1 | 2 | 3;

interface MethodEntry {
  id: OptimizerMethod;
  label: string;
  blurb: string;
  icon: LucideIcon;
}

// Config for the metaheuristic optimizers that share MetaheuristicOptimizer.
interface MetaConfig {
  description: string;
  settingsSchema: OptimiserSettingField[];
  defaults: Record<string, number>;
  estimateRuns: (s: Record<string, number>) => number;
}

const META_CONFIGS: Record<OptimiserMethod, MetaConfig> = {
  random: {
    description: "Randomly sample parameter combinations from the search space",
    settingsSchema: [{ key: "iterations", label: "Iterations" }],
    defaults: { iterations: 30 },
    estimateRuns: (s) => s.iterations,
  },
  pso: {
    description: "Swarm of particles drawn toward the best parameters found",
    settingsSchema: [
      { key: "swarm_size", label: "Swarm Size" },
      { key: "iterations", label: "Iterations" },
      { key: "inertia", label: "Inertia (w)", step: 0.05 },
      { key: "cognitive", label: "Cognitive (c1)", step: 0.1 },
      { key: "social", label: "Social (c2)", step: 0.1 },
    ],
    defaults: { swarm_size: 15, iterations: 8, inertia: 0.7, cognitive: 1.5, social: 1.5 },
    estimateRuns: (s) => s.swarm_size * s.iterations,
  },
  annealing: {
    description: "Random walk that cools over time, escaping local optima early",
    settingsSchema: [
      { key: "iterations", label: "Iterations" },
      { key: "initial_temp", label: "Initial Temp", step: 0.1 },
      { key: "cooling_rate", label: "Cooling Rate", step: 0.01 },
    ],
    defaults: { iterations: 40, initial_temp: 1.0, cooling_rate: 0.95 },
    estimateRuns: (s) => s.iterations,
  },
  differential: {
    description: "Evolve candidates by combining the differences of others",
    settingsSchema: [
      { key: "population", label: "Population" },
      { key: "generations", label: "Generations" },
      { key: "mutation", label: "Mutation (F)", step: 0.1 },
      { key: "crossover", label: "Crossover (CR)", step: 0.05 },
    ],
    defaults: { population: 15, generations: 8, mutation: 0.8, crossover: 0.7 },
    estimateRuns: (s) => s.population * s.generations,
  },
};

const OPTIMIZER_METHODS: MethodEntry[] = [
  {
    id: "parameter",
    label: "Parameter Optimizer",
    blurb: "Grid, range, and auto search across your indicator parameters",
    icon: Sliders,
  },
  {
    id: "genetic",
    label: "Genetic Algorithm",
    blurb: "Evolve parameters over generations to find strong combinations",
    icon: Dna,
  },
  { id: "random", label: "Random Search", blurb: META_CONFIGS.random.description, icon: Shuffle },
  { id: "pso", label: "Particle Swarm", blurb: META_CONFIGS.pso.description, icon: Orbit },
  { id: "annealing", label: "Simulated Annealing", blurb: META_CONFIGS.annealing.description, icon: Thermometer },
  { id: "differential", label: "Differential Evolution", blurb: META_CONFIGS.differential.description, icon: Network },
];

const VALID_METHOD_IDS = new Set(OPTIMIZER_METHODS.map((m) => m.id));

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: "Optimizer" },
  { id: 2, label: "Strategy" },
  { id: 3, label: "Configure & Run" },
];

const Optimizers = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<SavedStrategy | null>(null);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [step, setStep] = useState<WizardStep>(1);
  const { user } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const methodParam = searchParams.get("method") as OptimizerMethod | null;
  const method: OptimizerMethod = methodParam && VALID_METHOD_IDS.has(methodParam) ? methodParam : "parameter";
  const activeMethod = useMemo(
    () => OPTIMIZER_METHODS.find((m) => m.id === method) ?? OPTIMIZER_METHODS[0],
    [method],
  );

  const setMethodParam = (next: OptimizerMethod) => {
    setSearchParams(
      (params) => {
        const updated = new URLSearchParams(params);
        updated.set("method", next);
        return updated;
      },
      { replace: true },
    );
  };

  const refreshStrategies = async () => {
    const data = await api.fetchStrategies();
    setStrategies(data);
    return data;
  };

  useEffect(() => {
    if (!user) return;
    refreshStrategies().catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to load strategies";
      toast.error(message);
    });
  }, [user]);

  // Step 1 -> pick optimizer and advance to strategy selection.
  const handlePickMethod = (next: OptimizerMethod) => {
    setMethodParam(next);
    setStep(2);
  };

  // Step 2 -> pick strategy and advance to configure/run.
  const handleSelectStrategy = (strategy: SavedStrategy) => {
    setSelectedStrategy(strategy);
    setStep(3);
  };

  const handleDeleteStrategy = async (id: number) => {
    try {
      await api.deleteStrategy(id);
      const data = await refreshStrategies();
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(null);
        if (step === 3) setStep(2);
      }
      toast.success("Strategy deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete strategy";
      toast.error(message);
    }
  };

  const handleBestApplied = async (_result: unknown, strategy?: { id?: number; name: string }) => {
    const data = await refreshStrategies();
    if (strategy?.id) {
      const updated = data.find((s) => s.id === strategy.id);
      if (updated) setSelectedStrategy(updated);
    }
    toast.success("Best result applied");
  };

  // A step is reachable if its prerequisites are met (method always has a default;
  // configure/run needs a selected strategy).
  const canGoToStep = (target: WizardStep) => {
    if (target === 3) return !!selectedStrategy;
    return true;
  };

  const goToStep = (target: WizardStep) => {
    if (canGoToStep(target)) setStep(target);
  };

  return (
    <>
      <Helmet>
        <title>Optimizers - Orca</title>
        <meta
          name="description"
          content="Optimize your trading strategies with grid/parameter search or a genetic algorithm."
        />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <main className={`transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="p-6 max-w-5xl mx-auto">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <activeMethod.icon className="h-6 w-6 text-primary" />
                </div>
                <h1 className="text-2xl font-bold">Optimizers</h1>
              </div>
            </motion.div>

            {/* Stepper */}
            <div className="mb-8 flex items-center">
              {STEPS.map((s, index) => {
                const isActive = s.id === step;
                const isComplete = s.id < step;
                const reachable = canGoToStep(s.id);
                return (
                  <div key={s.id} className="flex items-center flex-1 last:flex-none">
                    <button
                      type="button"
                      onClick={() => goToStep(s.id)}
                      disabled={!reachable}
                      className={`group flex items-center gap-2 ${reachable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : isComplete
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        {isComplete ? <Check className="h-4 w-4" /> : s.id}
                      </span>
                      <span
                        className={`hidden sm:block text-sm font-medium ${
                          isActive ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {s.label}
                      </span>
                    </button>
                    {index < STEPS.length - 1 && (
                      <div
                        className={`mx-3 h-px flex-1 ${s.id < step ? "bg-primary/40" : "bg-border"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {/* ---- Step 1: pick optimizer ---- */}
              {step === 1 && (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <h2 className="text-lg font-semibold mb-1">Choose an optimizer</h2>
                  <p className="text-sm text-muted-foreground mb-5">
                    Pick how you want to search for better strategy parameters.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {OPTIMIZER_METHODS.map((m) => {
                      const isSelected = m.id === method;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handlePickMethod(m.id)}
                          className={`group flex flex-col gap-3 rounded-xl border p-5 text-left transition-colors ${
                            isSelected
                              ? "border-primary/40 bg-primary/10"
                              : "border-border bg-card/40 hover:border-primary/30 hover:bg-card/60"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div
                              className={`p-2.5 rounded-lg border ${
                                isSelected
                                  ? "bg-primary/15 border-primary/30 text-primary"
                                  : "bg-secondary border-border text-muted-foreground group-hover:text-primary"
                              }`}
                            >
                              <m.icon className="h-6 w-6" />
                            </div>
                            <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                          </div>
                          <div>
                            <div className="font-semibold">{m.label}</div>
                            <p className="text-sm text-muted-foreground mt-1">{m.blurb}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ---- Step 2: pick strategy ---- */}
              {step === 2 && (
                <motion.div
                  key="step-2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-lg font-semibold mb-1">Select a strategy</h2>
                      <p className="text-sm text-muted-foreground">
                        Choose a saved strategy to run the {activeMethod.label.toLowerCase()} on.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </button>
                  </div>

                  {strategies.length > 0 ? (
                    <div className="max-w-xl">
                      <SavedStrategies
                        strategies={strategies}
                        onSelect={handleSelectStrategy}
                        onDelete={handleDeleteStrategy}
                        selectedId={selectedStrategy?.id || null}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-card/30">
                      <div className="p-4 rounded-full bg-muted/30 mb-4">
                        <AlertCircle className="h-12 w-12 text-muted-foreground/50" />
                      </div>
                      <h3 className="text-lg font-semibold mb-2">No saved strategies yet</h3>
                      <p className="text-muted-foreground text-center max-w-md">
                        Run a backtest and save it first — your saved strategies will show up here to
                        optimize.
                      </p>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ---- Step 3: configure & run ---- */}
              {step === 3 && selectedStrategy && (
                <motion.div
                  key="step-3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-lg font-semibold mb-1">Configure & run</h2>
                      <p className="text-sm text-muted-foreground">
                        Set up the {activeMethod.label.toLowerCase()} and run it.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Change strategy
                    </button>
                  </div>

                  <div className="mb-4 flex items-center justify-between p-4 rounded-xl border border-primary/30 bg-primary/5">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Bookmark className="h-4 w-4 text-primary" />
                        <span className="font-semibold">{selectedStrategy.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(selectedStrategy.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <activeMethod.icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{activeMethod.label}</span>
                    </div>
                  </div>

                  {method === "parameter" ? (
                    <ParameterOptimizer
                      dslJson={selectedStrategy.dslJson || null}
                      strategyId={selectedStrategy.id}
                      strategyName={selectedStrategy.name}
                      onBestApplied={handleBestApplied}
                    />
                  ) : method === "genetic" ? (
                    <GeneticOptimizer
                      dslJson={selectedStrategy.dslJson || null}
                      strategyId={selectedStrategy.id}
                      strategyName={selectedStrategy.name}
                      onBestApplied={handleBestApplied}
                    />
                  ) : (
                    <MetaheuristicOptimizer
                      method={method}
                      label={activeMethod.label}
                      description={META_CONFIGS[method].description}
                      icon={activeMethod.icon}
                      settingsSchema={META_CONFIGS[method].settingsSchema}
                      defaults={META_CONFIGS[method].defaults}
                      estimateRuns={META_CONFIGS[method].estimateRuns}
                      dslJson={selectedStrategy.dslJson || null}
                      strategyId={selectedStrategy.id}
                      strategyName={selectedStrategy.name}
                      onBestApplied={handleBestApplied}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </>
  );
};

export default Optimizers;
