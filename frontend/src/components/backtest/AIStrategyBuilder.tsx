import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, Send, AlertCircle, User, Bot, RotateCcw, HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRegistry } from "@/context/RegistryContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, BacktestResult, StrategyAssistantMessage } from "@/lib/api";
import { toast } from "sonner";
import EditableStrategyCard from "./EditableStrategyCard";
import { useSettings } from "@/hooks/useSettings";

interface AIStrategyBuilderProps {
  onRunBacktest: (result: BacktestResult) => void;
}

interface ChatMessage extends StrategyAssistantMessage {
  examples?: string[];
}

// Keep in sync with the backend cap (settings.MAX_NL_MESSAGE_CHARS).
const MAX_MESSAGE_CHARS = 2000;

const EXAMPLE_PROMPTS = [
  "Buy AAPL when RSI drops below 30 and sell when it goes above 70, on the daily timeframe with a 10% stop loss.",
  "Long TSLA when the 50 SMA crosses above the 200 SMA on the 4h timeframe, with a 20% take profit and 10% stop loss.",
  "Short SPY when price falls below the 100-period SMA on the 1h timeframe, with a 5% stop loss.",
];

const AIStrategyBuilder = ({ onRunBacktest }: AIStrategyBuilderProps) => {
  const { settings } = useSettings();
  const { tickers: registryTickers, registry } = useRegistry();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [parsedDsl, setParsedDsl] = useState<Record<string, unknown> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSentRef = useRef<string>("");
  // Snapshot of the strategy exactly as the AI produced it (post fee-inject),
  // plus its chat session — used to report which fields the user corrected
  // before running (the model-quality ground-truth signal).
  const originalParsedRef = useRef<Record<string, unknown> | null>(null);
  const completedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  // When the strategy card appears (it renders below the chat), bring it into
  // view — otherwise users with a tall chat never notice it arrived.
  useEffect(() => {
    if (parsedDsl) {
      const id = window.setTimeout(
        () => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        150,
      );
      return () => window.clearTimeout(id);
    }
  }, [parsedDsl]);

  // Keep the keyboard flowing: focus the input once the assistant replies.
  useEffect(() => {
    if (!isSending) inputRef.current?.focus();
  }, [isSending]);

  // Parsing takes 8–30s (local model) — show staged progress instead of a
  // static "Thinking..." so the wait feels intentional, not broken.
  useEffect(() => {
    if (!isSending) {
      setThinkingSeconds(0);
      return;
    }
    const id = window.setInterval(() => setThinkingSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isSending]);

  const thinkingLabel =
    thinkingSeconds < 4
      ? "Reading your strategy…"
      : thinkingSeconds < 12
        ? "Building the trading rules…"
        : thinkingSeconds < 30
          ? "Structuring conditions — nearly there…"
          : "Still working — the first request after a restart loads the model (~30s)…";

  // The model outputs pure strategy logic — transaction costs are account
  // settings, not strategy language. Inject the user's saved fee defaults so
  // AI-mode backtests price in costs exactly like Easy Mode (previously they
  // ran commission-free, quietly inflating results).
  const withDefaultFees = (dsl: Record<string, unknown>): Record<string, unknown> => {
    const bt = settings.backtestDefaults;
    const next = JSON.parse(JSON.stringify(dsl)) as Record<string, any>;
    const dirKey = "LONG" in next ? "LONG" : "SHORT" in next ? "SHORT" : null;
    if (!dirKey) return next;
    const block = next[dirKey];
    if (!block.OPEN || typeof block.OPEN !== "object") block.OPEN = {};
    if (!block.OPEN.ARGUMENTS || typeof block.OPEN.ARGUMENTS !== "object") block.OPEN.ARGUMENTS = {};
    const args = block.OPEN.ARGUMENTS;
    if (args.fee_value === undefined && args.spread === undefined) {
      args.fee_mode = bt.feeMode;
      args.fee_value = bt.feeValue;
    }
    if (args.fee_fixed === undefined && (bt.feeFixed ?? 0) > 0) {
      args.fee_fixed = bt.feeFixed;
    }
    return next;
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    lastSentRef.current = trimmed;
    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const data = await api.strategyChatMessage(trimmed, sessionId);

      if (data.status === "clarify") {
        setSessionId(data.session_id);
        setMessages([
          ...history,
          { role: "assistant", content: data.question, examples: data.examples },
        ]);
      } else if (data.status === "complete") {
        const seeded = withDefaultFees(data.dsl_json);
        originalParsedRef.current = JSON.parse(JSON.stringify(seeded));
        completedSessionRef.current = data.session_id ?? null;
        setParsedDsl(seeded);
        setWarnings(data.warnings ?? []);
        setSessionId(null);
        const explanation = data.explanation || "Strategy ready.";
        setMessages([
          ...history,
          {
            role: "assistant",
            content: `${explanation}\n\nReview the card below — tweak any field, then hit Run Backtest. Want something different? Just describe a new strategy.`,
          },
        ]);
      } else {
        throw new Error(data.error || "Assistant failed to respond");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach assistant";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = () => sendMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setSessionId(null);
    setParsedDsl(null);
    setWarnings([]);
    setError(null);
    setInput("");
  };

  // Compare the strategy the AI produced with what the user actually ran.
  const diffEditedFields = (orig: Record<string, any>, cur: Record<string, any>): string[] => {
    const edits: string[] = [];
    const dirOf = (d: Record<string, any>) => ("LONG" in d ? "LONG" : "SHORT");
    if (dirOf(orig) !== dirOf(cur)) edits.push("direction");
    const o = orig[dirOf(orig)] ?? {};
    const c = cur[dirOf(cur)] ?? {};
    const octx = o.context ?? {}, cctx = c.context ?? {};
    if (JSON.stringify(octx.tickers) !== JSON.stringify(cctx.tickers)) edits.push("tickers");
    if (octx.execution_timeframe !== cctx.execution_timeframe) edits.push("timeframe");
    if (JSON.stringify(octx.dateframe) !== JSON.stringify(cctx.dateframe)) edits.push("dates");
    const oa = o.OPEN?.ARGUMENTS ?? {}, ca = c.OPEN?.ARGUMENTS ?? {};
    if (oa.takeProfitPercent !== ca.takeProfitPercent) edits.push("takeProfit");
    if (oa.stopLossPercent !== ca.stopLossPercent) edits.push("stopLoss");
    if (oa.fee_mode !== ca.fee_mode || oa.fee_value !== ca.fee_value || (oa.fee_fixed ?? 0) !== (ca.fee_fixed ?? 0)) {
      edits.push("fees");
    }
    return edits;
  };

  const handleRun = async () => {
    if (!parsedDsl) return;
    setIsRunning(true);
    try {
      const result = await api.backtestDSLJSON(parsedDsl);
      if (completedSessionRef.current && originalParsedRef.current) {
        api.reportAiParseOutcome(
          completedSessionRef.current,
          diffEditedFields(originalParsedRef.current, parsedDsl),
        );
      }
      onRunBacktest(result);
      toast.success("Backtest completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setIsRunning(false);
    }
  };

  // What the assistant actually understands — surfaced up front so users phrase
  // ideas in supported terms instead of guessing (and hitting a dead end).
  const supportedMarkets = Object.keys(registryTickers);
  const supportedIndicators =
    Object.keys(registry.indicators?.INDICATORS ?? {}).length > 0
      ? Object.keys(registry.indicators!.INDICATORS as Record<string, unknown>)
      : ["RSI", "MACD", "SMA", "EMA", "BBANDS", "STOCH", "CCI", "OBV", "ATR", "PRICE", "VOLUME"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Card className="p-5 bg-card/50 border-border">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Strategy Assistant</h3>
          <Badge variant="outline" className="text-[10px]">Beta</Badge>
          <div className="ml-auto flex items-center gap-1">
            <Popover open={helpOpen} onOpenChange={setHelpOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground gap-1">
                  <HelpCircle className="h-3 w-3" />
                  What can I say?
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 max-h-[420px] overflow-y-auto text-xs space-y-3">
                <div>
                  <p className="font-semibold mb-1">Markets</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(registryTickers).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-secondary/60 font-mono text-[10px]">{t}</span>
                    ))}
                  </div>
                  <p className="mt-1 text-muted-foreground text-[11px]">
                    Plain names work too — “apple”, “bitcoin”, “the S&P”.
                  </p>
                </div>
                <div>
                  <p className="font-semibold mb-1">Indicators</p>
                  <p className="text-muted-foreground text-[11px]">
                    {supportedIndicators.join(" · ")}
                  </p>
                </div>
                <div>
                  <p className="font-semibold mb-1">Details you can include</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5 text-[11px]">
                    <li>Direction — “buy” / “go long” / “short”</li>
                    <li>Entry rules — combine with “and” / “or”</li>
                    <li>An exit rule — “sell when RSI goes above 70”</li>
                    <li>Take profit &amp; stop loss — “TP 15%, SL 5%”</li>
                    <li>Timeframe — 1m, 15m, 1h, 4h, daily…</li>
                    <li>Date range — “last 2 years”, “throughout 2024”</li>
                    <li>DCA — “add 5% every 10 candles, up to 3 times”</li>
                  </ul>
                </div>
                <div className="rounded border border-border bg-background/50 p-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Tips:</span> one full sentence works
                  best · typos are fine · anything you leave out gets a sensible default or a quick
                  follow-up question · after parsing, edit everything on the review card — no need
                  to re-prompt for small tweaks.
                </div>
              </PopoverContent>
            </Popover>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-7 text-[11px] text-muted-foreground"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                New chat
              </Button>
            )}
          </div>
        </div>
        {/* Chat history */}
        <div
          ref={scrollRef}
          className="min-h-[280px] max-h-[420px] overflow-y-auto rounded border border-border bg-background/40 p-3 space-y-3 mb-3"
        >
          {messages.length === 0 && (
            <div className="flex h-full min-h-[250px] flex-col items-center justify-center gap-4 text-center px-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Describe a strategy in plain English</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                  The AI turns your words into trading rules, shows you exactly what it
                  understood, and runs the backtest — no coding, typos welcome.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                <span className="flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">1</span> Describe</span>
                <span className="text-muted-foreground/30">→</span>
                <span className="flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">2</span> Review</span>
                <span className="text-muted-foreground/30">→</span>
                <span className="flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">3</span> Backtest</span>
              </div>
              <div className="w-full max-w-md space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Try one of these</p>
                <div className="flex flex-col gap-1.5">
                  {EXAMPLE_PROMPTS.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(ex)}
                      className="text-[11px] text-left px-3 py-2 rounded-lg border border-border bg-background/60 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                      disabled={isSending}
                    >
                      “{ex}”
                    </button>
                  ))}
                </div>
              </div>

              {/* What the AI understands — nudge users toward supported terms so
                  they don't waste a prompt on indicators/markets we don't handle. */}
              <div className="w-full max-w-md space-y-1.5 border-t border-border/60 pt-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Indicators it understands
                </p>
                <div className="flex flex-wrap gap-1">
                  {supportedIndicators.map((ind) => (
                    <span
                      key={ind}
                      className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {ind}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/70">
                  Plus {supportedMarkets.length} markets. Stick to these so the AI understands your
                  idea —{" "}
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    className="text-primary hover:underline"
                  >
                    see the full list
                  </button>
                  .
                </p>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="h-6 w-6 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div className="max-w-[80%] flex flex-col gap-1.5">
                <div
                  className={`rounded-lg px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary/15 text-foreground border border-primary/20"
                      : "bg-card border border-border text-foreground"
                  }`}
                >
                  {m.content}
                </div>
                {m.role === "assistant" && m.examples && m.examples.length > 0 && i === messages.length - 1 && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1.5">
                      {m.examples.map((ex, j) => (
                        <button
                          key={j}
                          onClick={() => sendMessage(ex)}
                          disabled={isSending}
                          className="text-[10px] px-2 py-1 rounded-full border border-primary/30 bg-primary/10 hover:bg-primary/20 text-foreground transition-colors"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60">Tap an option or type your own answer</p>
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="h-6 w-6 shrink-0 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {isSending && (
            <div className="flex gap-2">
              <div className="h-6 w-6 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="rounded-lg px-3 py-2 text-xs bg-card border border-border flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{thinkingLabel}</span>
                {thinkingSeconds >= 4 && (
                  <span className="text-muted-foreground/50 font-mono text-[10px]">{thinkingSeconds}s</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            onKeyDown={handleKeyDown}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={
              messages.length === 0
                ? "Describe your strategy in plain English — typos welcome…"
                : "Reply to the assistant or describe a new strategy…"
            }
            className="min-h-[60px] text-sm bg-background/50 resize-none"
            disabled={isSending}
          />
          <Button
            onClick={handleSend}
            disabled={isSending || !input.trim()}
            size="icon"
            className="h-auto"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[10px] text-muted-foreground">Press Enter to send · Shift+Enter for new line</p>
          <span
            className={
              "text-[10px] tabular-nums " +
              (input.length >= MAX_MESSAGE_CHARS
                ? "text-destructive font-medium"
                : input.length >= MAX_MESSAGE_CHARS * 0.9
                ? "text-amber-500"
                : "text-muted-foreground")
            }
          >
            {input.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
          </span>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-xs flex-1">
              <div className="font-medium text-destructive mb-0.5">Something went wrong</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
            {lastSentRef.current && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] shrink-0"
                onClick={() => {
                  setError(null);
                  setMessages((prev) => prev.filter((_, i) => i !== prev.length - 1));
                  sendMessage(lastSentRef.current);
                }}
                disabled={isSending}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Try again
              </Button>
            )}
          </div>

          {/* Catch people at the moment of failure: a common cause is an
              indicator/market we don't support, so show what we do handle. */}
          <div className="mt-3 border-t border-destructive/20 pt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
              Indicators it understands
            </p>
            <div className="flex flex-wrap gap-1">
              {supportedIndicators.map((ind) => (
                <span
                  key={ind}
                  className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {ind}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">
              Using an indicator or market that isn't listed is a common cause —{" "}
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="text-primary hover:underline"
              >
                see the full list
              </button>
              .
            </p>
          </div>
        </Card>
      )}

      {parsedDsl && (
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <EditableStrategyCard
            dsl={parsedDsl}
            onChange={setParsedDsl}
            onRun={handleRun}
            isRunning={isRunning}
            warnings={warnings}
          />
        </motion.div>
      )}
    </motion.div>
  );
};

export default AIStrategyBuilder;