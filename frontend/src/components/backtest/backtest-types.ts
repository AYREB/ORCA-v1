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
        BBANDS: { args: ["period", "stddev", "timeframe", "offset"], defaults: { period: 20, stddev: 2, timeframe: "1h", offset: 0 } },
        ATR: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
        STOCH: { args: ["k_period", "d_period", "timeframe", "offset"], defaults: { k_period: 14, d_period: 3, timeframe: "1h", offset: 0 } },
        CCI: { args: ["period", "timeframe", "offset"], defaults: { period: 20, timeframe: "1h", offset: 0 } },
        OBV: { args: ["timeframe", "offset"], defaults: { timeframe: "1h", offset: 0 } },
      },
    },
    arguments: {
      ARGUMENTS: {
        LONG: {
          OPEN: {
            initialOpenPositionInvestType: { default: "percentCashBalance", options: ["percentCashBalance", "fixedAmount"] },
            initialOpenPositionInvestAmount: { default: 0.1 },
            recurring: { default: false },
            stopLossPercent: { default: 6 },
            takeProfitPercent: { default: 10 },
            recurringPeriod: { default: 5, parent: "recurring" },
            recurringInvestType: { default: "percentCashBalance", options: ["percentCashBalance", "fixedValue", "percentSharePrice", "numberShares"], parent: "recurring" },
            recurringInvestAmount: { default: 0.1, parent: "recurring" },
            maxRecurringCount: { default: 0, parent: "recurring" },
          },
          CLOSE: {},
        },
        SHORT: { OPEN: {}, CLOSE: {} },
      },
    },
  };
  