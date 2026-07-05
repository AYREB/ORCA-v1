import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, Send, AlertCircle, User, Bot, RotateCcw } from "lucide-react";
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

const EXAMPLE_PROMPTS = [
  "Buy AAPL when RSI drops below 30 and sell when it goes above 70. On the Daily timeframe and Use 10% stop loss.",
  "Long TSLA when the 50 EMA crosses above the 200 EMA on the 4h timeframe.",
  "Short SPY when price breaks below the lower Bollinger Band with a 5% take profit.",
];

const AIStrategyBuilder = ({ onRunBacktest }: AIStrategyBuilderProps) => {
  const { settings } = useSettings();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [parsedDsl, setParsedDsl] = useState<Record<string, unknown> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSentRef = useRef<string>("");

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
        setParsedDsl(withDefaultFees(data.dsl_json));
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

  const handleRun = async () => {
    if (!parsedDsl) return;
    setIsRunning(true);
    try {
      const result = await api.backtestDSLJSON(parsedDsl);
      onRunBacktest(result);
      toast.success("Backtest completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setIsRunning(false);
    }
  };

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
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="ml-auto h-7 text-[11px] text-muted-foreground"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              New chat
            </Button>
          )}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
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
        <p className="text-[10px] text-muted-foreground mt-1.5">Press Enter to send · Shift+Enter for new line</p>
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