import { motion } from "framer-motion";
import { 
  BarChart3, 
  Layers, 
  Zap, 
  LineChart, 
  Shield, 
  Clock,
  TrendingUp,
  Settings2
} from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Visual Strategy Builder",
    description: "Build complex trading strategies using our intuitive drag-and-drop interface. No coding knowledge required.",
    color: "primary",
  },
  {
    icon: BarChart3,
    title: "100+ Technical Indicators",
    description: "Access RSI, MACD, Bollinger Bands, and over 100 other indicators to craft your perfect strategy.",
    color: "primary",
  },
  {
    icon: Zap,
    title: "Lightning-Fast Backtests",
    description: "Run 10+ years of historical data in seconds with our optimized backtesting engine.",
    color: "success",
  },
  {
    icon: LineChart,
    title: "Advanced Charting",
    description: "Professional-grade charts with candlesticks, trade markers, and equity curves.",
    color: "primary",
  },
  {
    icon: Shield,
    title: "Risk Management",
    description: "Built-in stop-loss, take-profit, and position sizing tools to protect your capital.",
    color: "warning",
  },
  {
    icon: Clock,
    title: "15+ Years of Data",
    description: "Backtest across multiple market conditions with extensive historical data.",
    color: "primary",
  },
  {
    icon: TrendingUp,
    title: "Performance Analytics",
    description: "Sharpe ratio, max drawdown, win rate, and 50+ performance metrics at your fingertips.",
    color: "success",
  },
  {
    icon: Settings2,
    title: "Strategy Optimization",
    description: "Automatically find the best parameters for your strategy with our optimization engine.",
    color: "primary",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 relative">
      <div className="absolute inset-0 grid-pattern opacity-20" />
      
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Everything You Need to
            <span className="text-gradient-primary"> Backtest Like a Quant</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Professional-grade tools that were once only available to hedge funds, 
            now accessible to every trader.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="group p-6 rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm hover:border-primary/30 hover:bg-card/50 transition-all duration-300"
            >
              <div className={`inline-flex p-3 rounded-lg mb-4 bg-${feature.color}/10 border border-${feature.color}/20`}>
                <feature.icon className={`h-6 w-6 text-${feature.color}`} />
              </div>
              <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
