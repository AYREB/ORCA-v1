import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Bot, Lightbulb, Loader2, MessageSquareText, Send, ShieldCheck, Sparkles } from "lucide-react";
import { api, StrategyAssistantContext, StrategyAssistantMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

interface StrategyAssistantDrawerProps {
  context: StrategyAssistantContext;
}

const quickPrompts = [
  {
    label: "Review",
    icon: Sparkles,
    prompt:
      "Review the current strategy in markdown. Answer directly, avoid a fixed template, and only use bullets where they make the review easier to scan.",
  },
  {
    label: "Risks",
    icon: ShieldCheck,
    prompt:
      "Identify the main trading risks: overfitting, market regime, volatility, spread/slippage, position sizing, and missing assumptions.",
  },
  {
    label: "Improve",
    icon: Lightbulb,
    prompt:
      "Suggest specific builder-level improvements, including sensible TP/SL, RSI, and moving-average values to test from the selected ticker data, without giving live buy/sell advice.",
  },
];

const initialMessages: StrategyAssistantMessage[] = [
  {
    role: "assistant",
    content:
      "I can read your builder fields, inspect cached ticker data, infer the trade thesis, check risk/reward, and suggest practical numeric values to test. I will not edit the strategy or give live buy/sell advice.",
  },
];

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+?\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

const MarkdownMessage = ({ content }: { content: string }) => {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ");
    blocks.push(
      <p key={`p-${blocks.length}`} className="whitespace-normal">
        {renderInlineMarkdown(text, `p-${blocks.length}`)}
      </p>
    );
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const Tag = listType;
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={`${listType === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}>
        {listItems.map((item, itemIndex) => (
          <li key={`${blocks.length}-${itemIndex}`}>{renderInlineMarkdown(item, `li-${blocks.length}-${itemIndex}`)}</li>
        ))}
      </Tag>
    );
    listType = null;
    listItems = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      blocks.push(
        <Tag key={`h-${index}`} className="font-semibold text-foreground">
          {renderInlineMarkdown(heading[2], `h-${index}`)}
        </Tag>
      );
      return;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      return;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      return;
    }

    flushList();
    paragraphLines.push(trimmed);
  });

  flushParagraph();
  flushList();

  return <div className="space-y-2">{blocks}</div>;
};

const StrategyAssistantDrawer = ({ context }: StrategyAssistantDrawerProps) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<StrategyAssistantMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isLoading) return;
    if (!user) {
      toast.error("Log in to use the strategy assistant.");
      return;
    }

    const nextMessages: StrategyAssistantMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setDraft("");
    setIsLoading(true);

    try {
      const response = await api.chatStrategyAssistant(nextMessages, context);
      setMessages([...nextMessages, { role: "assistant", content: response.answer }]);
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

  const tickerLabel = context.markets.tickers.length > 0 ? context.markets.tickers.join(", ") : "No ticker";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="gap-2">
          <Bot className="h-4 w-4" />
          Strategy Assistant
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[500px]">
        <SheetHeader className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-2">
              <SheetTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Strategy Assistant
              </SheetTitle>
              <SheetDescription>
                {context.currentStage} • {context.side} • {tickerLabel}
              </SheetDescription>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              Read-only
            </Badge>
          </div>
        </SheetHeader>

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
                    {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <MarkdownMessage content={message.content} />}
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
              placeholder="Ask about the strategy, indicators, risk, or what to test next..."
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

export default StrategyAssistantDrawer;
