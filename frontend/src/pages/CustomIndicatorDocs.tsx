import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, CheckCircle2, Lock, ShieldCheck, TimerReset } from "lucide-react";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import MarkdownContent from "@/components/MarkdownContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { toast } from "sonner";

const gateSteps = [
  {
    icon: ShieldCheck,
    title: "Static safety check",
    description:
      "Your code is parsed and walked before it ever runs. Imports, file/network/system access, and dunder/builtin tricks (eval, exec, __import__, ...) are rejected outright.",
  },
  {
    icon: TimerReset,
    title: "Sandboxed dry run",
    description:
      "What passes the static check is wrapped in the locked def calculate(data, context, **params): / return result template and run against a sample window of real OHLCV data, with a wall-clock timeout.",
  },
  {
    icon: CheckCircle2,
    title: "Pass before you save",
    description:
      "Every value your function returns across that sample window must be a single number (or NaN). Once it passes, you'll see a preview chart and the Save/Update button unlocks for that exact code.",
  },
];

const CustomIndicatorDocs = () => {
  const [markdown, setMarkdown] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const guide = await api.getCustomIndicatorGuide();
        if (!cancelled) setMarkdown(guide);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load the indicator guide";
        toast.error(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardLayout
      title="Custom Indicator Docs"
      metaDescription="Learn the rigid input/output contract, what's allowed in the sandbox, and how the compiler/tester gate works for custom indicators."
      maxWidth="max-w-5xl"
    >
      <PageHeader
        icon={BookOpen}
        eyebrow="Documentation"
        title="Custom Indicator Docs"
        description="The rigid contract every indicator runs on, what the sandbox allows, and how the compiler/tester gate works."
        actions={
          <Button variant="outline" asChild>
            <Link to="/dashboard/indicators">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Indicators
            </Link>
          </Button>
        }
      />

      <div className="space-y-8">
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              className="space-y-4"
            >
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                How the compiler/tester gate works
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {gateSteps.map((step) => (
                  <Card key={step.title} className="glass-card glass-hover h-full border-border/70">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10">
                          <step.icon className="h-4 w-4 text-primary" />
                        </div>
                        <CardTitle className="text-sm font-semibold">{step.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{step.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <Card className="glass-card border-border/70">
                <CardContent className="p-6">
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div key={idx} className="h-4 rounded bg-muted/30 animate-pulse" style={{ width: `${85 - idx * 6}%` }} />
                      ))}
                    </div>
                  ) : markdown ? (
                    <MarkdownContent content={markdown} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      The guide couldn't be loaded right now. Try refreshing the page.
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.section>
      </div>
    </DashboardLayout>
  );
};

export default CustomIndicatorDocs;
