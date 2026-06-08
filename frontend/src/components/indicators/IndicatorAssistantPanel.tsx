import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
  Wrench,
} from "lucide-react";
import {
  api,
  IndicatorAssistantContext,
  IndicatorAssistantMessage,
  IndicatorAssistantMode,
  IndicatorParameter,
} from "@/lib/api";
import MarkdownContent from "@/components/MarkdownContent";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

interface IndicatorAssistantPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: IndicatorAssistantContext;
  onApplyCode?: (code: string, parameters?: IndicatorParameter[] | null) => void;
}

const askPrompts = [
  {
    label: "Explain",
    icon: Sparkles,
    prompt:
      "Explain what my current draft does in plain language, in markdown. Reference the specific lines and parameters that matter.",
  },
  {
    label: "Debug",
    icon: Wrench,
    prompt:
      "My indicator's last test result is in the context above. Walk through what's most likely causing it, and what I should change.",
  },
  {
    label: "Lookahead check",
    icon: ShieldCheck,
    prompt:
      "Review my code specifically for lookahead bias — am I only ever reading data at or before context['i']?",
  },
];

const agentPrompts = [
  {
    label: "Write it",
    icon: Wand2,
    prompt:
      "Write the full body for this indicator based on its name, description, and declared parameters. Apply your best implementation.",
  },
  {
    label: "Fix the test",
    icon: Wrench,
    prompt:
      "My last compiler/tester run is in the context above. Rewrite the body so it fixes that result, and apply the corrected version.",
  },
  {
    label: "Add lookback safety",
    icon: ShieldCheck,
    prompt:
      "Rewrite my current body so it safely handles the warm-up period (not enough candles yet) and never reads beyond context['i']. Apply the corrected version.",
  },
];

const askIntro: IndicatorAssistantMessage = {
  role: "assistant",
  content:
    "I can read your current draft (name, parameters, code, and last test result) and explain it, suggest ideas, or help debug a failing test — grounded in the Custom Indicator guide. In **Ask** mode I never touch your code; switch to **Agent** above if you want me to write it for you.",
};

const agentIntro: IndicatorAssistantMessage = {
  role: "assistant",
  content:
    "I can write or rewrite the body of this indicator for you, in the correct shape for Orca's rigid contract, and apply it straight into the editor — just describe what you want. Run the tester afterward to confirm it passes. Switch to **Ask** above if you'd rather just talk it through first.",
};

const FENCED_BLOCK_PATTERN = /```(\w*)\r?\n([\s\S]*?)```/g;

// The agent is told to send only the function body (see assistant.py's "Output
// contract"), but models sometimes ignore that and wrap their own logic in the
// locked `def calculate(data, context, **params): ... return result` template
// anyway — which, applied verbatim as a "body", re-wraps into a *nested*
// `calculate` whose `result` is invisible to the outer `return result` (a
// runtime NameError, not a compile error). Orca's save/test gate already
// unwraps this defensively (api/indicator_sandbox.py: _strip_redundant_wrapper)
// so it never breaks — this mirrors that here purely so what lands in the
// editor reads as a clean body, not a confusing duplicate header.
const REDUNDANT_HEADER_PATTERN = /^def\s+calculate\s*\(\s*data\s*,\s*context\s*,\s*\*\*params\s*\)\s*:\s*$/;
const REDUNDANT_RETURN_PATTERN = /^return\s+result\s*$/;

const stripRedundantWrapper = (body: string): string => {
  const lines = body.split(/\r?\n/);

  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (start >= lines.length || !REDUNDANT_HEADER_PATTERN.test(lines[start].trim())) return body;

  let end = lines.length;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  if (end > start && REDUNDANT_RETURN_PATTERN.test(lines[end - 1].trim())) end -= 1;

  const inner = lines.slice(start + 1, end);
  const indents = inner.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return inner.map((line) => (line.trim() ? line.slice(commonIndent) : line)).join("\n");
};

const RESERVED_PARAM_NAMES = new Set([
  "data", "context", "params", "self", "result", "calculate",
  "ticker", "timeframe", "offset",
]);
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const sanitizeAgentParameters = (raw: unknown): IndicatorParameter[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const seen = new Set<string>();
  const cleaned: IndicatorParameter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const name = String((entry as Record<string, unknown>).name ?? "").trim();
    const value = (entry as Record<string, unknown>).default;
    if (!IDENTIFIER_PATTERN.test(name) || RESERVED_PARAM_NAMES.has(name) || seen.has(name)) return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    seen.add(name);
    cleaned.push({ name, default: value });
  }
  return cleaned;
};

interface AgentApplication {
  code: string | null;
  parameters: IndicatorParameter[] | null;
}

/** Pulls the agent's last ```python (or untagged) block as the body, and its last
 *  ```json block — if any — as a full-replacement parameter list. A malformed json
 *  block is ignored (code still applies); see sanitizeAgentParameters. */
const extractAgentApplication = (markdown: string): AgentApplication => {
  let match: RegExpExecArray | null;
  let code: string | null = null;
  let parameters: IndicatorParameter[] | null = null;
  FENCED_BLOCK_PATTERN.lastIndex = 0;
  while ((match = FENCED_BLOCK_PATTERN.exec(markdown)) !== null) {
    const lang = match[1].trim().toLowerCase();
    const block = match[2].replace(/\s+$/, "");
    if (!block.trim()) continue;

    if (lang === "json") {
      try {
        const sanitized = sanitizeAgentParameters(JSON.parse(block));
        if (sanitized) parameters = sanitized;
      } catch {
        // malformed JSON — ignore, keep the existing declared parameters
      }
    } else if (lang === "python" || lang === "") {
      code = stripRedundantWrapper(block);
    }
  }
  if (code === null) return { code: null, parameters };
  return { code: code.endsWith("\n") ? code : `${code}\n`, parameters };
};

const IndicatorAssistantPanel = ({ open, onOpenChange, context, onApplyCode }: IndicatorAssistantPanelProps) => {
  const [mode, setMode] = useState<IndicatorAssistantMode>("ask");
  const [messages, setMessages] = useState<IndicatorAssistantMessage[]>([askIntro]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  const quickPrompts = mode === "agent" ? agentPrompts : askPrompts;

  const handleModeChange = (value: string) => {
    const next = value === "agent" ? "agent" : "ask";
    if (next === mode) return;
    setMode(next);
    setMessages([next === "agent" ? agentIntro : askIntro]);
  };

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isLoading) return;
    if (!user) {
      toast.error("Log in to use the indicator assistant.");
      return;
    }

    const nextMessages: IndicatorAssistantMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setDraft("");
    setIsLoading(true);

    try {
      const response = await api.chatIndicatorAssistant(nextMessages, context, mode);
      setMessages([...nextMessages, { role: "assistant", content: response.answer }]);

      if (mode === "agent" && onApplyCode) {
        const { code, parameters } = extractAgentApplication(response.answer);
        if (code) {
          onApplyCode(code, parameters);
          toast.success(
            parameters
              ? "Agent updated the code and parameters — run the tester to verify it."
              : "Agent wrote new code into the editor — run the tester to verify it."
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant request failed";
      toast.error(message);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            "I could not reach the assistant service. Check the backend configuration and try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    sendMessage(draft);
  };

  const handleNewChat = () => {
    if (isLoading) return;
    setMessages([mode === "agent" ? agentIntro : askIntro]);
    setDraft("");
  };

  const draftLabel = context.name.trim() || "Untitled indicator";

  const modeBadge = useMemo(
    () =>
      mode === "agent"
        ? { label: "Agent · writes code", className: "border-amber-500/30 bg-amber-500/10 text-amber-500" }
        : { label: "Ask · read-only", className: "border-primary/30 bg-primary/10 text-primary" },
    [mode]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-2">
              <SheetTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Indicator Assistant
              </SheetTitle>
              <SheetDescription>{draftLabel} • {context.parameters.length} parameter(s)</SheetDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={handleNewChat}
                disabled={isLoading || messages.length <= 1}
                title="Start a new chat — useful if the assistant gets stuck or loses the thread"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </Button>
              <Badge variant="outline" className={modeBadge.className}>
                {modeBadge.label}
              </Badge>
            </div>
          </div>
        </SheetHeader>

        {/* Mode toggle — always visible, not hidden behind a menu */}
        <div className="border-b border-border p-3">
          <Tabs value={mode} onValueChange={handleModeChange}>
            <TabsList className="grid w-full grid-cols-2 bg-card/50 border border-border p-1">
              <TabsTrigger value="ask" className="gap-1.5 data-[state=active]:bg-primary/20">
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                Ask
              </TabsTrigger>
              <TabsTrigger value="agent" className="gap-1.5 data-[state=active]:bg-amber-500/20">
                <Wand2 className="h-3.5 w-3.5" />
                Agent
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {mode === "agent"
              ? "Agent writes the indicator body for you and applies it directly to the editor in the correct syntax — run the tester after each change."
              : "Ask reads your draft and the docs to explain, suggest, and debug — it never edits your code."}
          </p>
        </div>

        <div className="border-b border-border p-4">
          <div className="grid grid-cols-3 gap-2">
            {quickPrompts.map((item) => (
              <Button
                key={item.label}
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                disabled={isLoading || !user}
                onClick={() => sendMessage(item.prompt)}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              return (
                <div key={`${message.role}-${index}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                      isUser
                        ? "border-primary/30 bg-primary/15 text-foreground"
                        : "border-border bg-card/70 text-foreground"
                    }`}
                  >
                    {!isUser && (
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                        <MessageSquareText className="h-3.5 w-3.5" />
                        Orca
                      </div>
                    )}
                    {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <MarkdownContent content={message.content} />}
                  </div>
                </div>
              );
            })}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <form onSubmit={handleSubmit} className="border-t border-border p-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                mode === "agent"
                  ? "Describe what the indicator should do — the agent will write and apply the body..."
                  : "Ask about your indicator, the contract, or a failing test..."
              }
              className="max-h-32 min-h-[72px] resize-none bg-secondary/40"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(draft);
                }
              }}
            />
            <Button type="submit" size="icon" disabled={isLoading || !draft.trim() || !user} className="h-10 w-10 shrink-0">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default IndicatorAssistantPanel;
