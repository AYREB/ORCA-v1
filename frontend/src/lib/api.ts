// Django Backend API Configuration
// Backend runs on separate repo at http://127.0.0.1:8000
const API_BASE_URL = import.meta.env.VITE_DJANGO_API_URL || 'http://127.0.0.1:8000/api';

// Backend response types matching Django backend
export interface TradeEntry {
  type: 'BUY' | 'SELL' | 'Recurring_Entry';
  ticker: string;
  price: number;
  shares: number;
  balance: number;
  open_positions_value: number;
  timestamp: string;
  sl_price?: number;
  tp_price?: number;
  close_reason?: 'SL' | 'TP' | 'CLOSE_CONDITION' | 'MAX_HOLD';
}

export interface OHLCData {
  Datetime: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
  [key: string]: string | number; // For dynamic indicator columns
}

export interface BacktestResult {
  cash: number;
  invested: number;
  total_portfolio: number;
  pct_change: number;
  json_dsl: Record<string, unknown>;
  trades: TradeEntry[];
  data: {
    [ticker: string]: {
      [timeframe: string]: OHLCData[];
    };
  };
}

export interface DashboardBacktest {
  id: number;
  strategy_id?: number | null;
  strategy_name: string;
  pct_change: number;
  win_rate: number;
  trades: number;
  final_balance: number;
  created_at: string;
}

export interface DashboardSummary {
  strategyCount: number;
  backtestRunCount: number;
  totalReturnPct: number;
  winRate: number;
  equityCurve: Array<{ timestamp: string; equity: number }>;
  recentBacktests: DashboardBacktest[];
}

export interface BacktestRunRecord {
  id: number;
  strategy_id: number | null;
  strategy_name: string;
  pct_change: number;
  win_rate: number;
  trades: number;
  winning_trades: number;
  losing_trades: number;
  final_balance: number;
  cash: number;
  invested: number;
  equity_curve: Array<{ timestamp: string; equity: number }>;
  created_at: string;
}

export interface BacktestHistoryResponse {
  runs: BacktestRunRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ParameterChoice {
  mode: 'nochange' | 'auto' | 'manual' | 'range';
  indicator?: string;
  values?: number[];
  start?: number;
  end?: number;
  steps?: number;
  // UI-side toggle used by the optimizer panels; passed through and ignored by the backend.
  enabled?: boolean;
}

export interface OptimizationResult {
  all_backtests: Array<{
    dsl: Record<string, unknown>;
    params: Record<string, number>;
    results: Record<string, number>;
  }>;
  best_result: {
    dsl: Record<string, unknown>;
    params: Record<string, number>;
    results: {
      pct_change: number;
      final_balance: number;
      num_trades: number;
      [key: string]: number;
    };
  };
  errors?: Array<{
    params: Record<string, number>;
    error: string;
  }>;
  total_runs?: number;
}

export interface OptimizerJobStart {
  job_id: string;
  total_runs: number;
}

export interface OptimizerJobStatus {
  status: "queued" | "running" | "completed" | "error";
  completed_runs: number;
  total_runs: number;
  progress: number;
  result?: OptimizationResult;
  error?: string;
}

export type GeneticOptimizationResult = OptimizationResult;
export interface GeneticJobStart {
  job_id: string;
  total_runs: number;
}

export interface GeneticJobStatus {
  status: "queued" | "running" | "completed" | "error";
  completed_runs: number;
  total_runs: number;
  progress: number;
  result?: GeneticOptimizationResult;
  error?: string;
}

// Metaheuristic optimizers (random search, particle swarm, simulated annealing,
// differential evolution) — all share one endpoint, dispatched by `method`.
export type OptimiserMethod = "random" | "pso" | "annealing" | "differential";

export interface OptimiserJobStart {
  job_id: string;
  total_runs: number;
}

export interface OptimiserJobStatus {
  status: "queued" | "running" | "completed" | "error";
  completed_runs: number;
  total_runs: number;
  progress: number;
  result?: OptimizationResult;
  error?: string;
}

export interface RegistryResponse {
  commands: Record<string, unknown>;
  indicators: Record<string, unknown>;
  arguments: Record<string, unknown>;
  tickers?: Record<string, { name: string; available_timeframes: string[] }>;
  timeframes?: Record<string, string>;
}

export interface MonteCarloResult {
  paths: Array<{ trade: number; [key: string]: number }>;
  all_final_values: number[];
  metrics: {
    expected_return: number;
    median_return: number;
    var_95: number;
    cvar_95: number;
    prob_positive: number;
    prob_gt_10: number;
    prob_gt_20: number;
    prob_drawdown_20: number;
  };
  distribution: Array<{ return: number; frequency: number }>;
  params: {
    win_rate: number;
    avg_win: number;
    avg_loss: number;
    num_simulations: number;
    cooldown_buffer: number;
  };
}

export interface SavedStrategy {
  id: number;
  name: string;
  dsl: string;
  dslJson?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastRun?: string | null;
  lastResult?: BacktestResult | null;
}

interface RawSavedStrategy {
  id: number;
  name: string;
  dsl?: string | null;
  dsl_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  last_result?: BacktestResult | null;
}

interface RawDashboardBacktest {
  id: number;
  strategy_id?: number | null;
  strategy_name?: string;
  pct_change?: number;
  win_rate?: number;
  trades?: number;
  final_balance?: number;
  created_at?: string;
}

interface RawDashboardSummary {
  strategy_count?: number;
  backtest_run_count?: number;
  total_return_pct?: number;
  win_rate?: number;
  equity_curve?: Array<{ timestamp: string; equity: number }>;
  recent_backtests?: RawDashboardBacktest[];
}

export type StrategyAssistantRole = 'user' | 'assistant';

export interface StrategyAssistantMessage {
  role: StrategyAssistantRole;
  content: string;
}

export interface StrategyAssistantContext {
  currentStep: number;
  currentStage: string;
  strategyName: string;
  side: string;
  openConditions: unknown[];
  closeConditions: unknown[];
  openArguments: Record<string, unknown>;
  closeArguments: Record<string, unknown>;
  riskManagement: {
    takeProfitPercent: number;
    stopLossPercent: number;
    spread: number;
  };
  markets: {
    tickers: string[];
    executionTimeframe: string;
    dateStart: string;
    dateEnd: string;
  };
  account: {
    initialBalance: number;
  };
  jsonDsl: Record<string, unknown>;
  readOnly: true;
}

export interface StrategyAssistantChatResponse {
  answer: string;
  model?: string;
  provider?: string;
}

export interface StrategyAssistantMarketDataStatus {
  ticker: string;
  timeframe: string;
  status: 'already_cached' | 'cache_warmed' | 'unavailable';
  reason?: string;
  source_file?: string | null;
  rows?: number | null;
}

export interface StrategyAssistantMarketDataResponse {
  market_data: StrategyAssistantMarketDataStatus[];
}

export interface IndicatorParameter {
  name: string;
  default: number | string;
}

export interface NativeIndicator {
  name: string;
  function: string;
  args: string[];
  defaults: Record<string, unknown>;
  supportsTimeframe: boolean;
  family: string;
  typicalUse: string;
  watchout: string;
}

interface RawNativeIndicator {
  name: string;
  function?: string;
  args?: string[];
  defaults?: Record<string, unknown>;
  supports_timeframe?: boolean;
  family?: string;
  typical_use?: string;
  watchout?: string;
}

export interface IndicatorTestPreview {
  timestamps: string[];
  values: number[];
}

export interface IndicatorTestResult {
  passed: boolean;
  errors: string[];
  preview: IndicatorTestPreview | null;
}

export interface CustomIndicator {
  id: number;
  name: string;
  description: string;
  parameters: IndicatorParameter[];
  code: string;
  lastTestResult: IndicatorTestResult | null;
  createdAt: string;
  updatedAt: string;
}

interface RawCustomIndicator {
  id: number;
  name: string;
  description?: string | null;
  parameters?: IndicatorParameter[];
  code?: string;
  last_test_result?: IndicatorTestResult | null;
  created_at: string;
  updated_at: string;
}

export interface CustomIndicatorsResponse {
  native: NativeIndicator[];
  custom: CustomIndicator[];
}

export type IndicatorAssistantRole = 'user' | 'assistant';
export type IndicatorAssistantMode = 'ask' | 'agent';

export interface IndicatorAssistantMessage {
  role: IndicatorAssistantRole;
  content: string;
}

export interface IndicatorAssistantContext {
  name: string;
  description: string;
  parameters: IndicatorParameter[];
  code: string;
  lastTestResult: IndicatorTestResult | null;
}

export interface IndicatorAssistantChatResponse {
  answer: string;
  model?: string;
  provider?: string;
  mode?: IndicatorAssistantMode;
}

export interface AuthUser {
  id: number;
  email: string;
  name?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface StrategyAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface NLPStrategyResponse {
  success: boolean;
  reply?: string;
  dsl_json?: Record<string, unknown> | null;
  ready_to_run?: boolean;
  confidence?: number;
  warnings?: string[];
  error?: string;
}

export interface StrategyChatClarifyResponse {
  status: 'clarify';
  session_id: string;
  question: string;
  examples?: string[];
  field?: string;
}
export interface StrategyChatCompleteResponse {
  status: 'complete';
  session_id: string;
  dsl_json: Record<string, unknown>;
  explanation?: string;
  warnings?: string[];
}
export interface StrategyChatErrorResponse {
  status?: 'error';
  error?: string;
}
export type StrategyChatResponse =
  | StrategyChatClarifyResponse
  | StrategyChatCompleteResponse
  | StrategyChatErrorResponse;


class DjangoAPI {
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  setToken(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Token ${this.token}` }),
      ...options.headers,
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API Error: ${response.statusText}`);
    }

    return response.json();
  }

  private normalizeStrategy(raw: RawSavedStrategy): SavedStrategy {
    return {
      id: raw.id,
      name: raw.name,
      dsl: raw.dsl || "",
      dslJson: raw.dsl_json || null,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      lastRun: raw.last_run_at,
      lastResult: raw.last_result || null,
    };
  }

  private normalizeNativeIndicator(raw: RawNativeIndicator): NativeIndicator {
    return {
      name: raw.name,
      function: raw.function || '',
      args: raw.args || [],
      defaults: raw.defaults || {},
      supportsTimeframe: Boolean(raw.supports_timeframe),
      family: raw.family || '',
      typicalUse: raw.typical_use || '',
      watchout: raw.watchout || '',
    };
  }

  private normalizeCustomIndicator(raw: RawCustomIndicator): CustomIndicator {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description || '',
      parameters: raw.parameters || [],
      code: raw.code || '',
      lastTestResult: raw.last_test_result || null,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  // Authentication
  async register(email: string, password: string, name?: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/register/', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async loginWithGoogle(idToken: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/login/google/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
  }

  async logout(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/logout/', {
      method: 'POST',
    });
  }

  async getCurrentUser(): Promise<AuthUser> {
    return this.request<AuthUser>('/me/');
  }

  // Health check
  async healthCheck() {
    return this.request<{ status: string }>('/health/');
  }

  // Backtest with DSL text (raw DSL string)
  async backtestDSLText(
    dslText: string,
    options?: { strategyId?: number; strategyName?: string; initialBalance?: number }
  ): Promise<BacktestResult> {
    return this.request<BacktestResult>('/backtestDSLText/', {
      method: 'POST',
      body: JSON.stringify({
        dsl_text: dslText,
        strategy_id: options?.strategyId,
        strategy_name: options?.strategyName,
        initial_balance: options?.initialBalance,
      }),
    });
  }

  // Backtest with DSL JSON (parsed DSL object)
  async backtestDSLJSON(
    dslJson: Record<string, unknown>,
    options?: { strategyId?: number; strategyName?: string; initialBalance?: number }
  ): Promise<BacktestResult> {
    return this.request<BacktestResult>('/backtestDSLJSON/', {
      method: 'POST',
      body: JSON.stringify({
        dsl_json: dslJson,
        strategy_id: options?.strategyId,
        strategy_name: options?.strategyName,
        initial_balance: options?.initialBalance,
      }),
    });
  }

  async strategyChatMessage(
    message: string,
    sessionId: string | null
  ): Promise<StrategyChatResponse> {
    return this.request<StrategyChatResponse>('/strategy/chat/', {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
    });
  }

  // Parameter optimizer
  async optimizeParameters(
    dslJson: Record<string, unknown>,
    parameterChoice: Record<string, ParameterChoice>,
    initialBalance: number
  ): Promise<OptimizationResult> {
    return this.request<OptimizationResult>('/dslParameterOptimiser/', {
      method: 'POST',
      body: JSON.stringify({
        dsl_json: dslJson,
        parameter_choice: parameterChoice,
        initial_balance: initialBalance,
      }),
    });
  }

  // Async optimizer (job + polling)
  async startOptimizeJob(
    dslJson: Record<string, unknown>,
    parameterChoice: Record<string, ParameterChoice>,
    initialBalance: number
  ): Promise<OptimizerJobStart> {
    return this.request<OptimizerJobStart>("/dslParameterOptimiser/", {
      method: "POST",
      body: JSON.stringify({
        dsl_json: dslJson,
        parameter_choice: parameterChoice,
        initial_balance: initialBalance,
        async: true,
      }),
    });
  }

  async getOptimizeJobStatus(jobId: string): Promise<OptimizerJobStatus> {
    return this.request<OptimizerJobStatus>(`/dslParameterOptimiser/status/${jobId}/`);
  }

  // Genetic optimizer (async job)
  async startGeneticJob(
    dslJson: Record<string, unknown>,
    parameterChoice: Record<string, ParameterChoice>,
    initialBalance: number,
    gaSettings: {
      population: number;
      generations: number;
      mutation_rate: number;
      crossover_rate: number;
      elite_size: number;
    }
  ): Promise<GeneticJobStart> {
    return this.request<GeneticJobStart>("/dslGeneticOptimiser/", {
      method: "POST",
      body: JSON.stringify({
        dsl_json: dslJson,
        parameter_choice: parameterChoice,
        initial_balance: initialBalance,
        ga_settings: gaSettings,
        async: true,
      }),
    });
  }

  async getGeneticJobStatus(jobId: string): Promise<GeneticJobStatus> {
    return this.request<GeneticJobStatus>(`/dslGeneticOptimiser/status/${jobId}/`);
  }

  // Metaheuristic optimizers (async job) — random / pso / annealing / differential
  async startOptimiserJob(
    method: OptimiserMethod,
    dslJson: Record<string, unknown>,
    parameterChoice: Record<string, ParameterChoice>,
    initialBalance: number,
    settings: Record<string, number>
  ): Promise<OptimiserJobStart> {
    return this.request<OptimiserJobStart>("/dslOptimiser/", {
      method: "POST",
      body: JSON.stringify({
        method,
        dsl_json: dslJson,
        parameter_choice: parameterChoice,
        initial_balance: initialBalance,
        settings,
        async: true,
      }),
    });
  }

  async getOptimiserJobStatus(jobId: string): Promise<OptimiserJobStatus> {
    return this.request<OptimiserJobStatus>(`/dslOptimiser/status/${jobId}/`);
  }

  // Get registry (commands, indicators, arguments)
  async getRegistry(): Promise<RegistryResponse> {
    return this.request<RegistryResponse>('/registry/');
  }

  async chatStrategyAssistant(
    messages: StrategyAssistantMessage[],
    strategyContext: StrategyAssistantContext
  ): Promise<StrategyAssistantChatResponse> {
    return this.request<StrategyAssistantChatResponse>('/strategy-assistant/chat/', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        strategy_context: strategyContext,
      }),
    });
  }

  async prepareStrategyMarketData(
    markets: StrategyAssistantContext['markets']
  ): Promise<StrategyAssistantMarketDataResponse> {
    return this.request<StrategyAssistantMarketDataResponse>('/strategy-assistant/market-data/', {
      method: 'POST',
      body: JSON.stringify({ markets }),
    });
  }

  // Run Monte Carlo simulation
  async runMonteCarloSim(
    trades: TradeEntry[],
    numSimulations: number = 10000,
    numTradesForward: number = 100,
    cooldownBuffer: number = 3
  ): Promise<MonteCarloResult> {
    return this.request<MonteCarloResult>('/monteCarloSim/', {
      method: 'POST',
      body: JSON.stringify({
        trades,
        num_simulations: numSimulations,
        num_trades_forward: numTradesForward,
        cooldown_buffer: cooldownBuffer,
      }),
    });
  }

  // Strategies (persisted per user)
  async fetchStrategies(): Promise<SavedStrategy[]> {
    const data = await this.request<{ strategies: RawSavedStrategy[] }>('/strategies/');
    return data.strategies.map((strategy) => this.normalizeStrategy(strategy));
  }

  async createStrategy(payload: {
    name: string;
    dsl: string;
    dslJson?: Record<string, unknown> | null;
    lastResult?: BacktestResult | null;
  }): Promise<SavedStrategy> {
    const data = await this.request<{ strategy: RawSavedStrategy }>('/strategies/', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        dsl: payload.dsl,
        dsl_json: payload.dslJson,
        last_result: payload.lastResult,
      }),
    });
    return this.normalizeStrategy(data.strategy);
  }

  async updateStrategy(
    id: number,
    payload: Partial<{ name: string; dsl: string; dslJson: Record<string, unknown> | null; lastResult: BacktestResult | null }>
  ): Promise<SavedStrategy> {
    const data = await this.request<{ strategy: RawSavedStrategy }>(`/strategies/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.dsl !== undefined ? { dsl: payload.dsl } : {}),
        ...(payload.dslJson !== undefined ? { dsl_json: payload.dslJson } : {}),
        ...(payload.lastResult !== undefined ? { last_result: payload.lastResult } : {}),
      }),
    });
    return this.normalizeStrategy(data.strategy);
  }

  async deleteStrategy(id: number): Promise<void> {
    await this.request(`/strategies/${id}/`, { method: 'DELETE' });
  }

  async getStrategy(id: number): Promise<SavedStrategy> {
    const data = await this.request<{ strategy: RawSavedStrategy }>(`/strategies/${id}/`);
    return this.normalizeStrategy(data.strategy);
  }

  // Custom indicators (native = read-only reference, custom = user-owned CRUD)
  async getCustomIndicators(): Promise<CustomIndicatorsResponse> {
    const data = await this.request<{ native: RawNativeIndicator[]; custom: RawCustomIndicator[] }>(
      '/custom-indicators/'
    );
    return {
      native: data.native.map((indicator) => this.normalizeNativeIndicator(indicator)),
      custom: data.custom.map((indicator) => this.normalizeCustomIndicator(indicator)),
    };
  }

  async createCustomIndicator(payload: {
    name: string;
    description?: string;
    parameters: IndicatorParameter[];
    code: string;
  }): Promise<CustomIndicator> {
    const data = await this.request<{ indicator: RawCustomIndicator }>('/custom-indicators/', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        description: payload.description ?? '',
        parameters: payload.parameters,
        code: payload.code,
      }),
    });
    return this.normalizeCustomIndicator(data.indicator);
  }

  async updateCustomIndicator(
    id: number,
    payload: Partial<{ name: string; description: string; parameters: IndicatorParameter[]; code: string }>
  ): Promise<CustomIndicator> {
    const data = await this.request<{ indicator: RawCustomIndicator }>(`/custom-indicators/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.parameters !== undefined ? { parameters: payload.parameters } : {}),
        ...(payload.code !== undefined ? { code: payload.code } : {}),
      }),
    });
    return this.normalizeCustomIndicator(data.indicator);
  }

  async deleteCustomIndicator(id: number): Promise<void> {
    await this.request(`/custom-indicators/${id}/`, { method: 'DELETE' });
  }

  async testCustomIndicator(payload: { code: string; parameters: IndicatorParameter[] }): Promise<IndicatorTestResult> {
    const data = await this.request<{ test_result: IndicatorTestResult }>('/custom-indicators/test/', {
      method: 'POST',
      body: JSON.stringify({ code: payload.code, parameters: payload.parameters }),
    });
    return data.test_result;
  }

  async getCustomIndicatorGuide(): Promise<string> {
    const data = await this.request<{ markdown: string }>('/custom-indicators/guide/');
    return data.markdown;
  }

  async chatIndicatorAssistant(
    messages: IndicatorAssistantMessage[],
    indicatorContext: IndicatorAssistantContext,
    mode: IndicatorAssistantMode = 'ask'
  ): Promise<IndicatorAssistantChatResponse> {
    return this.request<IndicatorAssistantChatResponse>('/indicator-assistant/chat/', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        mode,
        indicator_context: {
          name: indicatorContext.name,
          description: indicatorContext.description,
          parameters: indicatorContext.parameters,
          code: indicatorContext.code,
          last_test_result: indicatorContext.lastTestResult,
        },
      }),
    });
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    const data = await this.request<RawDashboardSummary>('/dashboard/summary/');
    return {
      strategyCount: data.strategy_count ?? 0,
      backtestRunCount: data.backtest_run_count ?? 0,
      totalReturnPct: data.total_return_pct ?? 0,
      winRate: data.win_rate ?? 0,
      equityCurve: data.equity_curve ?? [],
      recentBacktests: (data.recent_backtests ?? []).map((run) => ({
        id: run.id,
        strategy_id: run.strategy_id ?? null,
        strategy_name: run.strategy_name ?? "Backtest",
        pct_change: run.pct_change ?? 0,
        win_rate: run.win_rate ?? 0,
        trades: run.trades ?? 0,
        final_balance: run.final_balance ?? 0,
        created_at: run.created_at ?? "",
      })),
    };
  }

  // Backtest run history
  async getBacktestHistory(options?: { limit?: number; offset?: number }): Promise<BacktestHistoryResponse> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    const query = params.toString();
    const data = await this.request<Partial<BacktestHistoryResponse>>(
      `/backtest-runs/${query ? `?${query}` : ''}`
    );
    return {
      runs: (data.runs ?? []).map((run) => ({
        ...run,
        strategy_id: run.strategy_id ?? null,
        strategy_name: run.strategy_name || 'Backtest',
        equity_curve: run.equity_curve ?? [],
      })),
      total: data.total ?? 0,
      limit: data.limit ?? 0,
      offset: data.offset ?? 0,
    };
  }

  async deleteBacktestRun(id: number): Promise<void> {
    await this.request(`/backtest-runs/${id}/`, { method: 'DELETE' });
  }

  // Store last backtest result for parameter optimizer
  getLastBacktestResult(): BacktestResult | null {
    const stored = localStorage.getItem('orca_last_backtest');
    return stored ? JSON.parse(stored) : null;
  }

  setLastBacktestResult(result: BacktestResult): void {
    localStorage.setItem('orca_last_backtest', JSON.stringify(result));
  }

  // NLP -> DSL conversion
  async convertNLPToDSL(
    message: string,
    conversationHistory?: StrategyAssistantMessage[]
  ): Promise<NLPStrategyResponse> {
      return this.request<NLPStrategyResponse>('/strategy-to-dsl/', {
      method: 'POST',
      body: JSON.stringify({
        message,
        conversation_history: conversationHistory || [],
      }),
    });
  }
}

export const api = new DjangoAPI();
