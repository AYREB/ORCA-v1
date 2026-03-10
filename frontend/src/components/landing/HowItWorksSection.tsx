import { motion } from "framer-motion";
import { MousePointer2, Cog, Play, BarChart2 } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: MousePointer2,
    title: "Choose Your Assets",
    description: "Select from stocks, forex, crypto, or futures. Pick your timeframe and date range.",
  },
  {
    number: "02",
    icon: Cog,
    title: "Build Your Strategy",
    description: "Use our visual builder to set entry and exit rules. Combine indicators, price action, and conditions.",
  },
  {
    number: "03",
    icon: Play,
    title: "Run the Backtest",
    description: "Hit run and watch as your strategy is tested against years of historical data in seconds.",
  },
  {
    number: "04",
    icon: BarChart2,
    title: "Analyze Results",
    description: "Review detailed metrics, equity curves, and trade-by-trade analysis. Optimize and repeat.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-16 relative bg-secondary/20">
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            From Idea to Results in
            <span className="text-gradient-primary"> 4 Simple Steps</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No PhD in finance required. Our intuitive workflow makes professional backtesting accessible to everyone.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.15 }}
              className="relative"
            >
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-full w-full h-px bg-gradient-to-r from-primary/50 to-transparent z-0" />
              )}
              
              <div className="relative z-10 text-center">
                {/* Step number */}
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl border border-primary/30 bg-card mb-6 relative overflow-hidden group hover:border-primary/50 transition-colors">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="font-mono text-2xl font-bold text-primary/30 absolute top-2 left-3">{step.number}</span>
                  <step.icon className="h-8 w-8 text-primary relative z-10" />
                </div>
                
                <h3 className="text-lg font-semibold mb-3">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
