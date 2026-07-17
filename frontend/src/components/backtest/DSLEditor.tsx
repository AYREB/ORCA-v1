import { useState } from "react";
import { motion } from "framer-motion";
import { Code2, Copy, Save, Play, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface DSLEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  onSave?: (name: string) => Promise<void> | void;
}

const DSL_EXAMPLES = [
  {
    name: "RSI Mean Reversion",
    dsl: `:TICKER(MSFT,GOOGL,NVDA)

:EXECUTION_TIMEFRAME(1h)

:DATEFRAME(2025-06-01, 2026-06-01)

:LONG(
    OPEN{
        CONDITIONS{
            RSI(period=14) < 30
        }
        |ARGUMENTS{
            initialOpenPositionInvestType = percentCashBalance
            |initialOpenPositionInvestAmount = 0.1
            |stopLossPercent = 6
            |takeProfitPercent = 10
        }
    }
    |CLOSE{
        CONDITIONS{
            RSI(period=14) > 70
        }
    }
)`,
  },
  {
    name: "SMA Crossover",
    dsl: `:TICKER(AAPL,TSLA)

:EXECUTION_TIMEFRAME(4h)

:DATEFRAME(2025-06-01, 2026-06-01)

:LONG(
    OPEN{
        CONDITIONS{
            SMA(period=20, timeframe=4h) > SMA(period=50, timeframe=4h)
        }
        |ARGUMENTS{
            initialOpenPositionInvestType = percentCashBalance
            |initialOpenPositionInvestAmount = 0.1
            |stopLossPercent = 5
            |takeProfitPercent = 10
        }
    }
    |CLOSE{
        CONDITIONS{
            SMA(period=20, timeframe=4h) < SMA(period=50, timeframe=4h)
        }
    }
)`,
  },
  {
    name: "Price Below SMA",
    dsl: `:TICKER(SPY,QQQ)

:EXECUTION_TIMEFRAME(1D)

:DATEFRAME(2023-01-01, 2026-06-01)

:LONG(
    OPEN{
        CONDITIONS{
            PRICE(close) < SMA(period=50, timeframe=1D) * 0.95
        }
        |ARGUMENTS{
            initialOpenPositionInvestType = percentCashBalance
            |initialOpenPositionInvestAmount = 0.2
            |stopLossPercent = 5
            |takeProfitPercent = 10
        }
    }
    |CLOSE{
        CONDITIONS{
            PRICE(close) > SMA(period=50, timeframe=1D)
        }
    }
)`,
  },
];

const DSLEditor = ({ value, onChange, onRun, onSave }: DSLEditorProps) => {
  const [strategyName, setStrategyName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    toast.success("DSL copied to clipboard");
  };

  const handleSave = async () => {
    if (!strategyName.trim()) {
      toast.error("Please enter a strategy name");
      return;
    }

    try {
      await onSave?.(strategyName);
      setShowSaveDialog(false);
      setStrategyName("");
      toast.success("Strategy saved successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save strategy";
      toast.error(message);
    }
  };

  const loadExample = (dsl: string) => {
    onChange(dsl);
    toast.success("Example loaded");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Code2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Strategy DSL</h3>
            <p className="text-sm text-muted-foreground">Write your trading logic</p>
          </div>
        </div>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="text-sm">
                Use our Domain Specific Language (DSL) to define entry/exit conditions.
                Supports RSI, MACD, SMA, EMA, BBANDS, STOCH, CCI, ATR, OBV, PRICE and VOLUME.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Quick Examples */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Label className="w-full text-xs text-muted-foreground mb-1">Quick Examples:</Label>
        {DSL_EXAMPLES.map((example) => (
          <Button
            key={example.name}
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => loadExample(example.dsl)}
          >
            {example.name}
          </Button>
        ))}
      </div>

      {/* Editor */}
      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`:TICKER(MSFT,GOOGL,NVDA)

:EXECUTION_TIMEFRAME(1h)

:DATEFRAME(2025-06-01, 2026-06-01)

:LONG(
    OPEN{
        CONDITIONS{
            RSI(period=14) < 30
        }
        |ARGUMENTS{
            initialOpenPositionInvestType = percentCashBalance
            |initialOpenPositionInvestAmount = 0.1
            |stopLossPercent = 6
            |takeProfitPercent = 10
        }
    }
    |CLOSE{
        CONDITIONS{
            RSI(period=14) > 70
        }
    }
)`}
          className="min-h-[250px] font-mono text-sm bg-secondary/50 border-border resize-none"
        />
        <div className="absolute top-2 right-2 flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-4">
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" className="flex-1">
              <Save className="h-4 w-4 mr-2" />
              Save Strategy
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Strategy</DialogTitle>
              <DialogDescription>
                Give your strategy a name to save it for later use.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="strategyName">Strategy Name</Label>
                <Input
                  id="strategyName"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="My RSI Strategy"
                  className="bg-secondary border-border"
                />
              </div>
              <Button onClick={handleSave} className="w-full">
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {onRun && (
          <Button variant="hero" className="flex-1" onClick={onRun}>
            <Play className="h-4 w-4 mr-2" />
            Run Backtest
          </Button>
        )}
      </div>
    </motion.div>
  );
};

export default DSLEditor;
