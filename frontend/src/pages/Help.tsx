import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BookOpen, FlaskConical, LineChart, Sliders, BarChart3,
  TrendingUp, Lightbulb, HelpCircle, Keyboard, Zap,
  MousePointerClick, Code2, Play, Save, ArrowRightLeft, Search
} from "lucide-react";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";

const gettingStartedSteps = [
  {
    icon: FlaskConical,
    title: "1. Create a Strategy",
    description: "Head to the Backtest page. Choose Easy Mode to build conditions visually, or switch to the DSL Editor to write strategy code directly. Pick your indicators, set entry/exit rules, and you're ready.",
  },
  {
    icon: Sliders,
    title: "2. Configure Your Settings",
    description: "Set the ticker (e.g. BTCUSDT), pick a date range and timeframe (1h, 4h, 1d), then configure your starting balance, stop loss, take profit, and spread.",
  },
  {
    icon: Play,
    title: "3. Run the Backtest",
    description: "Hit the Run button. Orca will simulate your strategy across historical data and generate a full performance report with metrics, trades, and charts.",
  },
  {
    icon: TrendingUp,
    title: "4. Review & Optimize",
    description: "Check your equity curve, win rate, and individual trades. Then use the Parameter Optimizer to automatically find the best indicator settings.",
  },
];

const howToSections = [
  {
    icon: MousePointerClick,
    title: "Using Easy Mode (Visual Builder)",
    steps: [
      "Go to Backtest → Easy Mode tab",
      "Click \"Add Condition\" to create entry rules (e.g. RSI < 30)",
      "Each condition has a left side (indicator or price), an operator (>, <, =), and a right side (value or another indicator)",
      "Use the AND/OR toggles to combine multiple conditions",
      "Set your exit conditions the same way in the Close section",
      "Configure position size, stop loss, and take profit in the Arguments section",
      "Click Run Backtest to see results",
    ],
  },
  {
    icon: Code2,
    title: "Using the DSL Editor",
    steps: [
      "Go to Backtest → DSL tab",
      "Write or paste your strategy using the DSL format (see example below)",
      "Use the Quick Examples dropdown to load pre-built strategies as starting points",
      "Click Run to execute, or Save to store your strategy for later",
      "You can copy/paste DSL code to share strategies with others",
    ],
  },
  {
    icon: BarChart3,
    title: "Reading Your Results",
    steps: [
      "After running a backtest, switch between tabs: Results, Chart, GARCH, Monte Carlo, and Optimizer",
      "Results tab shows key metrics: total return, win rate, max drawdown, Sharpe ratio, and a full trade log",
      "Chart tab displays the price chart with your trade entries and exits overlaid",
      "Monte Carlo tab simulates thousands of random trade sequences to stress-test your strategy",
      "GARCH tab models volatility patterns in your returns",
    ],
  },
  {
    icon: Sliders,
    title: "Using the Parameter Optimizer",
    steps: [
      "Go to the Optimizer tab after running a backtest",
      "Choose which indicator parameters to sweep (e.g. RSI period from 10 to 30)",
      "Select Auto mode for smart defaults, or Range mode for custom control",
      "Run the optimization — Orca tests every combination and ranks them",
      "Pick the best result and apply it to your strategy",
    ],
  },
  {
    icon: Save,
    title: "Saving & Loading Strategies",
    steps: [
      "In the DSL editor, click Save and give your strategy a name",
      "Load saved strategies anytime from the Load dialog",
      "Strategies are saved to your account — they sync across all your devices automatically",
      "You can also copy the raw DSL text and paste it anywhere to share a strategy with others",
    ],
  },
];

const analysisTools = [
  {
    icon: BarChart3,
    title: "Monte Carlo Simulation",
    description: "Randomly resamples your trades thousands of times to show best-case, worst-case, and average outcomes. Use it to check if your strategy is robust or just lucky.",
  },
  {
    icon: LineChart,
    title: "GARCH Volatility Model",
    description: "Analyzes how volatile your returns are over time. Helps you understand if risk is stable or clustering — useful for sizing positions and setting stops.",
  },
  {
    icon: Sliders,
    title: "Parameter Optimizer",
    description: "Automatically tests different indicator settings to find what works best. Shows a ranked leaderboard so you can compare configurations side by side.",
  },
];

const faqItems = [
  {
    q: "What's the difference between Easy Mode and DSL?",
    a: "Easy Mode lets you build strategies by clicking — picking indicators, operators, and values from dropdowns. The DSL editor lets you write strategy code as text, which is faster once you know the syntax. Both produce the same result.",
  },
  {
    q: "How do I set a stop loss or take profit?",
    a: "In Easy Mode, use the Risk Management controls in Open Setup to set Stop Loss % and Take Profit %. In DSL, add stopLossPercent and takeProfitPercent inside the ARGUMENTS{} block.",
  },
  {
    q: "Can I test on multiple tickers at once?",
    a: "Yes. In the ticker field, enter multiple symbols separated by commas (e.g. BTCUSDT, ETHUSDT). Each ticker runs independently with its own results.",
  },
  {
    q: "How are trading fees simulated?",
    a: "In the Risk Management section, choose Commission (a % per trade, e.g. 0.1% like Binance) or Spread (bid-ask spread cost), and optionally add a flat $ fee per order for brokers that charge fixed amounts (e.g. $1–5 per trade). All costs apply on both entry and exit, each trade in the log shows the fee it paid, and total fees appear above the trade log.",
  },
  {
    q: "What does the offset parameter do?",
    a: "Offset looks back N candles. For example, RSI(period=14, offset=1) gives you last candle's RSI. This is how you detect crossovers — compare the current value to the previous one.",
  },
  {
    q: "Where are my saved strategies stored?",
    a: "Strategies are saved to your account on the server, so they're available on any device you log into. You can also copy the raw DSL text to back up or share a strategy.",
  },
  {
    q: "What timeframes are supported?",
    a: "Common timeframes include 1m, 5m, 15m, 1h, 4h, 1d, and 1w. The available options depend on the exchange and ticker you're using.",
  },
];

const tips = [
  "Start with a short date range (1-3 months) when prototyping — it runs much faster.",
  "Use the Quick Examples in the DSL editor as templates instead of writing from scratch.",
  "Always set a stop loss — strategies without one can have massive drawdowns.",
  "The Parameter Optimizer's \"auto\" mode picks smart ranges for you — great for beginners.",
  "Compare your strategy's Sharpe ratio against 1.0 — anything above is generally considered good.",
];

const dslKeywords = "dsl example ticker dateframe timeframe long short open close conditions arguments strategy code syntax format";

const Help = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    const lower = text.toLowerCase();
    return searchQuery.toLowerCase().split(/\s+/).every(word => lower.includes(word));
  };

  const filteredSteps = useMemo(() => gettingStartedSteps.filter(s => matchesSearch(s.title + " " + s.description)), [searchQuery]);
  const filteredHowTo = useMemo(() => howToSections.filter(s => matchesSearch(s.title + " " + s.steps.join(" "))), [searchQuery]);
  const filteredTools = useMemo(() => analysisTools.filter(t => matchesSearch(t.title + " " + t.description)), [searchQuery]);
  const filteredFaq = useMemo(() => faqItems.filter(f => matchesSearch(f.q + " " + f.a)), [searchQuery]);
  const filteredTips = useMemo(() => tips.filter(t => matchesSearch(t)), [searchQuery]);
  const showDsl = useMemo(() => matchesSearch(dslKeywords), [searchQuery]);

  const hasResults = filteredSteps.length > 0 || filteredHowTo.length > 0 || showDsl || filteredTools.length > 0 || filteredFaq.length > 0 || filteredTips.length > 0;

  return (
    <DashboardLayout
      title="Help & Documentation"
      metaDescription="Learn how to use Orca's backtesting platform to build, test, and optimize trading strategies."
      maxWidth="max-w-5xl"
    >
      <PageHeader
        icon={HelpCircle}
        eyebrow="Knowledge base"
        title="Help & Documentation"
        description="Learn how to build, test, and optimize your trading strategies on Orca."
      >
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search for help..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 border-border bg-secondary/60 pl-9"
          />
        </div>
      </PageHeader>

      <div>
            {!hasResults && (
              <div className="text-center py-12">
                <HelpCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No results found for "{searchQuery}"</p>
                <button onClick={() => setSearchQuery("")} className="text-sm text-primary hover:underline mt-1">Clear search</button>
              </div>
            )}

            {/* Getting Started */}
            {filteredSteps.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                className="mb-8"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Quick Start
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredSteps.map((step) => (
                    <Card key={step.title} className="bg-card/50">
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-md bg-primary/10">
                            <step.icon className="h-4 w-4 text-primary" />
                          </div>
                          <CardTitle className="text-sm font-semibold">{step.title}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </motion.section>
            )}

            {/* How To Guides */}
            {filteredHowTo.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="mb-8"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  How To
                </h2>
                <Card className="glass-card glass-hover border-border/70">
                  <CardContent className="p-4">
                    <Accordion type="multiple" className="w-full">
                      {filteredHowTo.map((section) => (
                        <AccordionItem key={section.title} value={section.title}>
                          <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                            <div className="flex items-center gap-2">
                              <section.icon className="h-4 w-4 text-primary" />
                              <span>{section.title}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="text-xs space-y-1.5 pl-6">
                            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground leading-relaxed">
                              {section.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </motion.section>
            )}

            {/* DSL Format Example */}
            {showDsl && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="mb-8"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Keyboard className="h-4 w-4 text-primary" />
                  DSL Example
                </h2>
                <Card className="glass-card glass-hover border-border/70">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-3">
                      Here's what a complete strategy looks like in DSL format. You can paste this directly into the DSL editor:
                    </p>
                    <pre className="text-xs font-mono bg-muted/50 rounded-md p-3 overflow-x-auto text-foreground leading-relaxed">
{`:TICKER
BTCUSDT

:DATEFRAME
2024-01-01 -> 2024-06-01

:TIMEFRAME
1h

:LONG
OPEN{
  CONDITIONS{
    RSI(period=14, timeframe=1h) < 30
  }|ARGUMENTS{
    initialOpenPositionInvestType=percentCashBalance
    initialOpenPositionInvestAmount=0.1
    stopLossPercent=6
    takeProfitPercent=10
  }
}
CLOSE{
  CONDITIONS{
    RSI(period=14, timeframe=1h) > 70
  }
}`}
                    </pre>
                    <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                      <p><code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono">:TICKER</code> — The trading pair to backtest</p>
                      <p><code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono">:DATEFRAME</code> — Start and end dates separated by <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono">-&gt;</code></p>
                      <p><code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono">:TIMEFRAME</code> — Candle interval (1m, 5m, 1h, 4h, 1d, etc.)</p>
                      <p><code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono">:LONG / :SHORT</code> — Direction of the trade</p>
                      <p><code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono">OPEN / CLOSE</code> — Entry and exit blocks with CONDITIONS and optional ARGUMENTS</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.section>
            )}

            {/* Analysis Tools */}
            {filteredTools.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="mb-8"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <LineChart className="h-4 w-4 text-primary" />
                  Analysis Tools
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {filteredTools.map((tool) => (
                    <Card key={tool.title} className="bg-card/50">
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-md bg-primary/10">
                            <tool.icon className="h-4 w-4 text-primary" />
                          </div>
                          <CardTitle className="text-sm font-semibold">{tool.title}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground leading-relaxed">{tool.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </motion.section>
            )}

            {/* FAQ */}
            {filteredFaq.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.25 }}
                className="mb-8"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  Frequently Asked Questions
                </h2>
                <Card className="glass-card glass-hover border-border/70">
                  <CardContent className="p-4">
                    <Accordion type="multiple" className="w-full">
                      {filteredFaq.map((item, i) => (
                        <AccordionItem key={i} value={`faq-${i}`}>
                          <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                            {item.q}
                          </AccordionTrigger>
                          <AccordionContent className="text-xs text-muted-foreground leading-relaxed">
                            {item.a}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </motion.section>
            )}

            {/* Tips */}
            {filteredTips.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
                className="mb-8"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  Tips & Tricks
                </h2>
                <Card className="glass-card glass-hover border-border/70">
                  <CardContent className="p-4">
                    <ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
                      {filteredTips.map((tip, i) => (
                        <li key={i}>• {tip}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </motion.section>
            )}
      </div>
    </DashboardLayout>
  );
};

export default Help;
