// Backtest Types and Registry Configuration

export interface ConditionSideOperation {
    operator: "+" | "-" | "*" | "/";
    operand: number;
  }
  
  export interface ConditionSide {
    type: "value" | "indicator";
    value: number;
    func: string;
    args: Record<string, any>;
    operation?: ConditionSideOperation;
  }
  
  export interface SingleCondition {
    id: string;
    left: ConditionSide;
    operator: string;
    right: ConditionSide;
    nextLogicalOperator: "AND" | "OR"; // Connects to next condition
  }
  
  export interface ConditionGroup {
    conditions: SingleCondition[];
  }
  
  export interface Registry {
    commands: { COMMANDS: Record<string, any> };
    indicators: { INDICATORS: Record<string, { args: string[]; defaults: Record<string, any> }> };
    arguments: { ARGUMENTS: Record<string, Record<string, Record<string, any>>> };
    customIndicatorMeta?: Record<string, { description: string }>;
    tickers?: Record<string, { name: string; available_timeframes: string[] }>;
    timeframes?: Record<string, string>;
  }
  
  export const generateId = () => Math.random().toString(36).substring(2, 9);
  
  export const createDefaultCondition = (): SingleCondition => ({
    id: generateId(),
    left: { type: "indicator", value: 0, func: "RSI", args: { period: 14, timeframe: "1h", offset: 0 }, operation: undefined },
    operator: "<",
    right: { type: "value", value: 30, func: "", args: {}, operation: undefined },
    nextLogicalOperator: "AND",
  });

  export interface IndicatorMeta {
    category: "Trend" | "Momentum" | "Volume" | "Price" | "Volatility";
    description: string;
  }

  export const INDICATOR_META: Record<string, IndicatorMeta> = {
    PRICE: { category: "Price", description: "Raw price data (OHLC)" },
    VOLUME: { category: "Volume", description: "Trading volume" },
    SMA: { category: "Trend", description: "Simple Moving Average" },
    EMA: { category: "Trend", description: "Exponential Moving Average" },
    RSI: { category: "Momentum", description: "Relative Strength Index" },
    MACD: { category: "Momentum", description: "Moving Avg Convergence Divergence" },
    BBANDS: { category: "Volatility", description: "Bollinger Bands" },
    ATR: { category: "Volatility", description: "Average True Range" },
    STOCH: { category: "Momentum", description: "Stochastic Oscillator" },
    CCI: { category: "Momentum", description: "Commodity Channel Index" },
    OBV: { category: "Volume", description: "On-Balance Volume" },
  };
  
  export const INDICATOR_CATEGORIES = ["Price", "Trend", "Momentum", "Volatility", "Volume", "Custom"] as const;
  
  const INVEST_TYPE_OPTIONS = ["percentCashBalance", "fixedValue", "percentSharePrice", "numberShares"];
  const INVEST_TYPE_LABELS = {
    percentCashBalance: "% of Cash Balance",
    fixedValue: "Fixed Dollar Amount",
    percentSharePrice: "% of Share Price",
    numberShares: "Number of Shares",
  };

  // Mirrors backend/core/registries/argumentsRegistry.json — used only when the
  // registry endpoint is unreachable, so labels/descriptions must stay in sync.
  const FALLBACK_CLOSE_ARGUMENTS: Record<string, any> = {
    minHoldBars: {
      label: "Minimum Hold (bars)",
      default: 0,
      description: "Ignore the close condition for the first N bars after entry (0 = off). Stop loss and take profit still apply.",
    },
    maxHoldBars: {
      label: "Max Hold (bars)",
      default: 0,
      description: "Force-close the position after holding for this many bars, regardless of conditions (0 = off).",
    },
    reentryCooldownBars: {
      label: "Re-entry Cooldown (bars)",
      default: 0,
      description: "After closing, wait this many bars before a new position can be opened (0 = off).",
    },
  };

  function makeFallbackOpenArguments(side: "LONG" | "SHORT"): Record<string, any> {
    const isShort = side === "SHORT";
    return {
      initialOpenPositionInvestType: {
        label: "Position Size Type",
        options: INVEST_TYPE_OPTIONS,
        optionLabels: INVEST_TYPE_LABELS,
        default: "percentCashBalance",
        description: `How the size of each opening ${isShort ? "short" : "trade"} is calculated.`,
      },
      initialOpenPositionInvestAmount: {
        label: "Position Size Amount",
        default: 0.2,
        description:
          "Size value for the chosen type: a fraction for percent types (0.2 = 20% of cash), dollars for Fixed Dollar Amount, or a share count for Number of Shares.",
      },
      recurring: {
        label: isShort ? "Recurring Entries" : "Recurring Entries (DCA)",
        default: false,
        description: `Keep adding to the ${isShort ? "short " : ""}position at set intervals while it stays open${isShort ? "" : " (dollar-cost averaging)"}.`,
      },
      recurringPeriod: {
        label: "Bars Between Entries",
        default: 5,
        parent: "recurring",
        description: "Minimum number of bars to wait before each additional recurring entry.",
      },
      recurringInvestType: {
        label: "Recurring Size Type",
        options: INVEST_TYPE_OPTIONS,
        optionLabels: INVEST_TYPE_LABELS,
        default: "percentCashBalance",
        parent: "recurring",
        description: "How the size of each recurring entry is calculated.",
      },
      recurringInvestAmount: {
        label: "Recurring Size Amount",
        default: 0.1,
        parent: "recurring",
        description: "Size of each recurring entry, interpreted according to the Recurring Size Type (0.1 = 10% for percent types).",
      },
      maxRecurringCount: {
        label: "Max Recurring Entries",
        default: 0,
        parent: "recurring",
        description: "Maximum number of recurring entries per position. 0 = unlimited.",
      },
      spread: {
        label: "Spread %",
        default: 0,
        description: "Bid/ask spread applied to entry and exit prices (0.1 = 0.1%).",
      },
      stopLossPercent: {
        label: "Stop Loss %",
        default: 5,
        description: isShort
          ? "Closes the short if price rises this percent above entry (5 = 5%) — shorts lose when price climbs."
          : "Closes the position if price falls this percent below entry (5 = 5%).",
      },
      takeProfitPercent: {
        label: "Take Profit %",
        default: 10,
        description: isShort
          ? "Closes the short if price falls this percent below entry (10 = 10%)."
          : "Closes the position if price rises this percent above entry (10 = 10%).",
      },
    };
  }

  export const FALLBACK_REGISTRY: Registry = {
    commands: { COMMANDS: { LONG: {}, SHORT: {} } },
    indicators: {
      INDICATORS: {
        PRICE: { args: ["field", "offset"], defaults: { field: "close", offset: 0 } },
        VOLUME: { args: ["offset"], defaults: { offset: 0 } },
        SMA: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
        EMA: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
        RSI: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
        MACD: { args: ["fast", "slow", "signal", "timeframe", "offset"], defaults: { fast: 12, slow: 26, signal: 9, timeframe: "1h", offset: 0 } },
        BBANDS: { args: ["period", "stddev", "timeframe", "offset", "band"], defaults: { period: 20, stddev: 2, timeframe: "1h", offset: 0, band: "upper" } },
        ATR: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
        STOCH: { args: ["k_period", "d_period", "timeframe", "offset"], defaults: { k_period: 14, d_period: 3, timeframe: "1h", offset: 0 } },
        CCI: { args: ["period", "timeframe", "offset"], defaults: { period: 20, timeframe: "1h", offset: 0 } },
        OBV: { args: ["timeframe", "offset"], defaults: { timeframe: "1h", offset: 0 } },
      },
    },
    arguments: {
      ARGUMENTS: {
        LONG: {
          OPEN: makeFallbackOpenArguments("LONG"),
          CLOSE: { ...FALLBACK_CLOSE_ARGUMENTS },
        },
        SHORT: {
          OPEN: makeFallbackOpenArguments("SHORT"),
          CLOSE: { ...FALLBACK_CLOSE_ARGUMENTS },
        },
      },
    },
  };
  