import { useEffect, useMemo, useState } from "react";
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
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import ParameterOptimizer from "@/components/backtest/ParameterOptimizer";
import GeneticOptimizer from "@/components/backtest/GeneticOptimizer";
import MetaheuristicOptimizer, { type OptimiserSettingField } from "@/components/backtest/MetaheuristicOptimizer";
import SavedStrategies from "@/components/backtest/SavedStrategies";
import { api, OptimiserMethod, SavedStrategy } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

type OptimizerMethod = "parameter" | "genetic" | OptimiserMethod;
type WizardStep = 1 | 2 | 3;

type MethodGroup = "Recommended" | "General";

interface MethodEntry {
  id: OptimizerMethod;
  label: string;
  blurb: string;
  icon: LucideIcon;
  group: MethodGroup;
}

// Sections render in this order; "General" (the metaheuristics) sits at the bottom.
const METHOD_GROUP_ORDER: { group: MethodGroup; caption: string }[] = [
  { group: "Recommended", caption: "Start here — the most common ways to tune a strategy." },
  { group: "General", caption: "General-purpose metaheuristics — flexible searches for fine-tuning numeric parameters." },
];

// Config for the metaheuristic optimizers that share MetaheuristicOptimizer.
interface MetaConfig {
  description: string;
  howItWorks: string;
  settingsSchema: OptimiserSettingField[];
  defaults: Record<string, number>;
  estimateRuns: (s: Record<string, number>) => number;
}

const META_CONFIGS: Record<OptimiserMethod, MetaConfig> = {
  random: {
    description: "Randomly sample parameter combinations from the search space",
    howItWorks:
      "Random Search tries completely random combinations of your parameters and keeps the best one. It doesn't learn between tries, but it's simple, unbiased, and surprisingly effective for a quick, broad sweep. Each iteration is one backtest.",
    settingsSchema: [
      {
        key: "iterations",
        label: "Iterations",
        description:
          "How many random parameter combinations to test. Each iteration = one backtest. More iterations explore more of the space (better odds of finding a strong combo) but take longer, and this equals your total run count.",
      },
    ],
    defaults: { iterations: 30 },
    estimateRuns: (s) => s.iterations,
  },
  pso: {
    description: "Swarm of particles drawn toward the best parameters found",
    howItWorks:
      "Particle Swarm sends a group of 'particles' roaming the parameter space; each is pulled toward its own best find and the swarm's best find, so they converge together on promising regions. Total backtests = swarm size × iterations.",
    settingsSchema: [
      {
        key: "swarm_size",
        label: "Swarm Size",
        description:
          "Number of particles searching at once. Larger = broader coverage each round and less chance of missing a good region, but more backtests per iteration.",
      },
      {
        key: "iterations",
        label: "Iterations",
        description:
          "How many rounds the swarm moves and refines. More iterations let the swarm settle deeper into the best region, at the cost of more runs.",
      },
      {
        key: "inertia",
        label: "Inertia (w)",
        step: 0.05,
        description:
          "How much a particle keeps its current momentum. Higher (≈0.8–0.9) explores more widely; lower (≈0.4–0.6) settles faster on what's found.",
      },
      {
        key: "cognitive",
        label: "Cognitive (c1)",
        step: 0.1,
        description:
          "Pull toward each particle's own best result. Higher makes particles trust their individual discoveries more (more exploration, more spread out).",
      },
      {
        key: "social",
        label: "Social (c2)",
        step: 0.1,
        description:
          "Pull toward the swarm's shared best result. Higher makes the swarm converge together faster (more exploitation, risk of local optima).",
      },
    ],
    defaults: { swarm_size: 10, iterations: 8, inertia: 0.7, cognitive: 1.5, social: 1.5 },
    estimateRuns: (s) => s.swarm_size * s.iterations,
  },
  annealing: {
    description: "Random walk that cools over time, escaping local optima early",
    howItWorks:
      "Simulated Annealing wanders from a starting point, sometimes accepting worse results early on to escape local optima, then 'cools' so it accepts fewer bad moves and settles on the best area. Total backtests ≈ iterations.",
    settingsSchema: [
      {
        key: "iterations",
        label: "Iterations",
        description:
          "How many steps the walk takes (≈ your total backtests). More iterations = a more thorough search and a better final result, but longer runtime.",
      },
      {
        key: "initial_temp",
        label: "Initial Temp",
        step: 0.1,
        description:
          "How adventurous the search starts. Higher temperature accepts more 'worse' moves early (explores widely before narrowing); lower stays near the start.",
      },
      {
        key: "cooling_rate",
        label: "Cooling Rate",
        step: 0.01,
        description:
          "How fast it stops exploring (per step, e.g. 0.95). Closer to 1 cools slowly = more exploration; lower cools fast = converges quickly but may miss better areas.",
      },
    ],
    defaults: { iterations: 40, initial_temp: 1.0, cooling_rate: 0.95 },
    estimateRuns: (s) => s.iterations,
  },
  differential: {
    description: "Evolve candidates by combining the differences of others",
    howItWorks:
      "Differential Evolution keeps a population of candidates and creates new ones by adding the scaled difference between others, keeping a new candidate only if it backtests better. Strong at fine-tuning numeric parameters. Total backtests = population × generations.",
    settingsSchema: [
      {
        key: "population",
        label: "Population",
        description:
          "How many candidate strategies evolve in parallel. Larger keeps more diversity (less likely to get stuck) but adds backtests every generation.",
      },
      {
        key: "generations",
        label: "Generations",
        description:
          "How many rounds of evolution to run. More generations refine the parameters further, at the cost of more runs.",
      },
      {
        key: "mutation",
        label: "Mutation (F)",
        step: 0.1,
        description:
          "How big the jumps are when combining candidates (typically 0.5–1.0). Higher = bolder exploration; lower = smaller, careful refinements.",
      },
      {
        key: "crossover",
        label: "Crossover (CR)",
        step: 0.05,
        description:
          "Chance each parameter is taken from the new mutated candidate (0–1). Higher changes more parameters at once (faster, bolder); lower changes fewer (steadier).",
      },
    ],
    defaults: { population: 10, generations: 8, mutation: 0.8, crossover: 0.7 },
    estimateRuns: (s) => s.population * s.generations,
  },
};

const OPTIMIZER_METHODS: MethodEntry[] = [
  {
    id: "parameter",
    label: "Parameter Optimizer",
    blurb: "Grid, range, and auto search across your indicator parameters",
    icon: Sliders,
    group: "Recommended",
  },
  {
    id: "genetic",
    label: "Genetic Algorithm",
    blurb: "Evolve parameters over generations to find strong combinations",
    icon: Dna,
    group: "Recommended",
  },
  { id: "random", label: "Random Search", blurb: META_CONFIGS.random.description, icon: Shuffle, group: "General" },
  { id: "pso", label: "Particle Swarm", blurb: META_CONFIGS.pso.description, icon: Orbit, group: "General" },
  { id: "annealing", label: "Simulated Annealing", blurb: META_CONFIGS.annealing.description, icon: Thermometer, group: "General" },
  { id: "differential", label: "Differential Evolution", blurb: META_CONFIGS.differential.description, icon: Network, group: "General" },
];

const VALID_METHOD_IDS = new Set(OPTIMIZER_METHODS.map((m) => m.id));

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: "Optimizer" },
  { id: 2, label: "Strategy" },
  { id: 3, label: "Configure & Run" },
];

const Optimizers = () => {
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
    <DashboardLayout
      title="Optimizers"
      metaDescription="Optimize your trading strategies with grid/parameter search or a genetic algorithm."
      maxWidth="max-w-5xl"
    >
      <PageHeader
        icon={activeMethod.icon}
        eyebrow="Parameter tuning"
        title="Optimizers"
        description="Search for stronger strategy parameters with grid search, genetic algorithms, and metaheuristics."
      />

      <div>
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
                              : "border-border bg-card/60 text-muted-foreground backdrop-blur"
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
                    Pick how you want to search for stronger strategy parameters. Each optimizer explores your
                    indicator settings differently — you'll get a full explanation of the one you choose, and of every
                    setting, on the next screens.
                  </p>
                  {METHOD_GROUP_ORDER.map(({ group, caption }) => {
                    const entries = OPTIMIZER_METHODS.filter((m) => m.group === group);
                    if (!entries.length) return null;
                    return (
                      <div key={group} className="mb-8 last:mb-0">
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                          <p className="text-xs text-muted-foreground">{caption}</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {entries.map((m) => {
                            const isSelected = m.id === method;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => handlePickMethod(m.id)}
                                className={`group flex flex-col gap-3 rounded-xl border p-5 text-left transition-colors ${
                                  isSelected
                                    ? "border-primary/40 bg-primary/10 shadow-[0_0_24px_-8px_hsl(var(--primary)/0.4)]"
                                    : "glass-card glass-hover border-border/70"
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
                      </div>
                    );
                  })}
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
                    <div className="glass-card flex h-[400px] flex-col items-center justify-center border-dashed">
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

                  <div className="mb-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 p-4 backdrop-blur-xl">
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
                      howItWorks={META_CONFIGS[method].howItWorks}
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
    </DashboardLayout>
  );
};

export default Optimizers;
