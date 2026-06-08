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

interface AIStrategyBuilderProps {
  onRunBacktest: (result: BacktestResult) => void;
}

interface ChatMessage extends StrategyAssistantMessage {
  examples?: string[];
}

const EXAMPLE_PROMPTS = [
  "Buy AAPL when RSI drops below 30 and sell when it goes above 70. Use 10% stop loss.",
  "Long TSLA when the 50 EMA crosses above the 200 EMA on the 1h timeframe.",
  "Short SPY when price breaks below the lower Bollinger Band with a 5% take profit.",
];

const AIStrategyBuilder = ({ onRunBacktest }: AIStrategyBuilderProps) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [parsedDsl, setParsedDsl] = useState<Record<string, unknown> | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [readyToRun, setReadyToRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

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
        setParsedDsl(data.dsl_json);
        setReadyToRun(true);
        setWarnings(data.warnings ?? []);
        setSessionId(null);
        setMessages([
          ...history,
          { role: "assistant", content: data.explanation || "Strategy ready." },
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
    setConfidence(null);
    setWarnings([]);
    setReadyToRun(false);
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
        <p className="text-xs text-muted-foreground mb-3">
          Chat with the AI to refine your strategy. It will ask questions and build the rules with you.
        </p>

        {/* Chat history */}
        <div
          ref={scrollRef}
          className="min-h-[280px] max-h-[420px] overflow-y-auto rounded border border-border bg-background/40 p-3 space-y-3 mb-3"
        >
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground space-y-2">
              <p>Start by describing your strategy idea. Try one of these:</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(ex)}
                    className="text-[10px] text-left px-2 py-1.5 rounded border border-border bg-background/60 hover:bg-primary/10 hover:border-primary/40 transition-colors max-w-xs"
                    disabled={isSending}
                  >
                    {ex}
                  </button>
                ))}
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
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply to the assistant or describe a change..."
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
            <div className="text-xs">
              <div className="font-medium text-destructive mb-0.5">Assistant error</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </div>
        </Card>
      )}

      {parsedDsl && (
        <>
          <EditableStrategyCard
            dsl={parsedDsl}
            onChange={setParsedDsl}
            onRun={handleRun}
            isRunning={isRunning}
            warnings={warnings}
            confidence={confidence}
          />
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              View raw JSON
            </summary>
            <pre className="mt-2 p-3 rounded bg-background/70 border border-border overflow-auto max-h-[400px] font-mono text-[11px]">
              {JSON.stringify(parsedDsl, null, 2)}
            </pre>
          </details>
        </>
      )}
    </motion.div>
  );
};

export default AIStrategyBuilder;