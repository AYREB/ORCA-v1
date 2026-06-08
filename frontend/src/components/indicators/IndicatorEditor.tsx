import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import {
  api,
  CustomIndicator,
  IndicatorParameter,
  IndicatorTestResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import IndicatorAssistantPanel from "@/components/indicators/IndicatorAssistantPanel";
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha } from "@/lib/chartTheme";

interface IndicatorEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indicator: CustomIndicator | null;
  onSaved: (indicator: CustomIndicator) => void;
}

const DEFAULT_CODE = `period = int(params.get("period", 14))
start = max(0, context["i"] - period + 1)
window = data["Close"].iloc[start : context["i"] + 1]

if len(window) < period:
    result = float("nan")
else:
    result = float(data["Close"].iloc[context["i"]] - window.mean())
`;

const parseParamDefault = (raw: string): number | string => {
  const trimmed = raw.trim();
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return raw;
};

const signatureOf = (code: string, parameters: IndicatorParameter[]) =>
  JSON.stringify({ code, parameters });

const IndicatorEditor = ({ open, onOpenChange, indicator, onSaved }: IndicatorEditorProps) => {
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parameters, setParameters] = useState<IndicatorParameter[]>([]);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [testResult, setTestResult] = useState<IndicatorTestResult | null>(null);
  const [testedSignature, setTestedSignature] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const isEditing = Boolean(indicator);

  useEffect(() => {
    if (!open) return;
    if (indicator) {
      setName(indicator.name);
      setDescription(indicator.description);
      setParameters(indicator.parameters.length > 0 ? indicator.parameters : []);
      setCode(indicator.code || DEFAULT_CODE);
      setTestResult(indicator.lastTestResult);
      setTestedSignature(
        indicator.lastTestResult?.passed ? signatureOf(indicator.code || "", indicator.parameters) : null
      );
    } else {
      setName("");
      setDescription("");
      setParameters([{ name: "period", default: 14 }]);
      setCode(DEFAULT_CODE);
      setTestResult(null);
      setTestedSignature(null);
    }
    setAssistantOpen(false);
  }, [open, indicator]);

  const currentSignature = useMemo(() => signatureOf(code, parameters), [code, parameters]);
  const canSave = testResult?.passed === true && testedSignature === currentSignature;

  const updateParameter = (index: number, patch: Partial<IndicatorParameter>) => {
    setParameters((prev) => prev.map((param, idx) => (idx === index ? { ...param, ...patch } : param)));
  };

  const removeParameter = (index: number) => {
    setParameters((prev) => prev.filter((_, idx) => idx !== index));
  };

  const addParameter = () => {
    setParameters((prev) => [...prev, { name: "", default: 0 }]);
  };

  const runTest = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.testCustomIndicator({ code, parameters });
      setTestResult(result);
      setTestedSignature(result.passed ? currentSignature : null);
      if (result.passed) {
        toast.success("Indicator passed the compiler/tester gate");
      } else {
        toast.error("Indicator failed the compiler/tester gate");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to run the compiler/tester";
      toast.error(message);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter an indicator name");
      return;
    }
    if (!canSave) {
      toast.error("Run the tester and get a passing result before saving");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        parameters,
        code,
      };
      const saved = indicator
        ? await api.updateCustomIndicator(indicator.id, payload)
        : await api.createCustomIndicator(payload);
      toast.success(indicator ? "Indicator updated" : "Indicator created");
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the indicator";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyCode = (nextCode: string, nextParameters?: IndicatorParameter[] | null) => {
    setCode(nextCode);
    if (nextParameters) setParameters(nextParameters);
    setTestResult(null);
    setTestedSignature(null);
  };

  const previewData = useMemo(() => {
    if (!testResult?.preview) return [];
    return testResult.preview.timestamps.map((timestamp, idx) => ({
      timestamp,
      value: testResult.preview!.values[idx],
    }));
  }, [testResult]);

  const indicatorContext = useMemo(
    () => ({
      name,
      description,
      parameters,
      code,
      lastTestResult: testResult,
    }),
    [name, description, parameters, code, testResult]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>{isEditing ? "Edit Custom Indicator" : "Create Custom Indicator"}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Write the body of your indicator. The function signature and return are fixed so every
                indicator runs the same way.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setAssistantOpen(true)}>
                <Bot className="h-4 w-4 mr-1.5" />
                Assistant
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard/indicators/docs" target="_blank" rel="noreferrer">
                  <BookOpen className="h-4 w-4 mr-1.5" />
                  Docs
                </Link>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="indicator-name">Name</Label>
              <Input
                id="indicator-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Distance From SMA"
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Function body</Label>
              <div className="rounded-lg border border-border overflow-hidden font-mono text-sm">
                <div className="px-4 py-2 text-muted-foreground bg-card border-b border-border/60">
                  def calculate(data, context, **params):
                </div>
                <CodeMirror
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    setTestResult(null);
                  }}
                  theme={oneDark}
                  extensions={[python()]}
                  basicSetup={{ lineNumbers: true, foldGutter: false }}
                  height="320px"
                />
                <div className="px-4 py-2 text-muted-foreground bg-card border-t border-border/60">
                  &nbsp;&nbsp;&nbsp;&nbsp;return result
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Write only the body — Orca wraps it in the locked function shown above and below. Assign your
                final value to <code className="rounded bg-muted px-1 py-0.5">result</code>.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={runTest} disabled={isTesting} variant="secondary">
                {isTesting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Run Test
              </Button>
              <Button onClick={handleSave} disabled={isSaving || !canSave}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {isEditing ? "Update" : "Save"}
              </Button>
              {!canSave && (
                <span className="text-xs text-muted-foreground">
                  Run the tester and get a pass before {isEditing ? "updating" : "saving"}.
                </span>
              )}
            </div>

            {testResult && (
              <div
                className={`rounded-lg border p-4 space-y-3 ${
                  testResult.passed ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {testResult.passed ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      Passed
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-destructive" />
                      Failed
                    </>
                  )}
                </div>

                {testResult.errors.length > 0 && (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {testResult.errors.map((error, idx) => (
                      <li key={idx} className="flex gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {testResult.preview && previewData.length > 0 && (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={previewData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={colorWithAlpha(chartColors.grid, 0.5, "hsl(222, 30%, 18%)")} />
                        <XAxis
                          dataKey="timestamp"
                          stroke="hsl(215, 20%, 55%)"
                          tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 11 }}
                          tickFormatter={(value: string) => new Date(value).toLocaleDateString()}
                          axisLine={{ stroke: "hsl(222, 30%, 18%)" }}
                          minTickGap={40}
                        />
                        <YAxis
                          stroke="hsl(215, 20%, 55%)"
                          tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 11 }}
                          axisLine={{ stroke: "hsl(222, 30%, 18%)" }}
                          domain={["auto", "auto"]}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(222, 47%, 8%)",
                            border: "1px solid hsl(222, 30%, 18%)",
                            borderRadius: "8px",
                            fontSize: 12,
                          }}
                          labelFormatter={(value: string) => new Date(value).toLocaleString()}
                          formatter={(value: number) => [value.toFixed(4), "result"]}
                        />
                        <Line type="monotone" dataKey="value" stroke={safeColor(chartColors.line, "hsl(175, 80%, 50%)")} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Parameters</Label>
              <Button variant="outline" size="sm" onClick={addParameter}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Declare the values your indicator needs (a lookback period, a multiplier, ...). They're passed
              into your function as <code className="rounded bg-muted px-1 py-0.5">**params</code> with these
              defaults.
            </p>
            <div className="space-y-2">
              {parameters.map((param, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={param.name}
                    onChange={(event) => updateParameter(idx, { name: event.target.value })}
                    placeholder="name"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={String(param.default)}
                    onChange={(event) => updateParameter(idx, { default: parseParamDefault(event.target.value) })}
                    placeholder="default"
                    className="font-mono text-sm w-28"
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeParameter(idx)} className="shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {parameters.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No parameters declared yet.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="indicator-description">Description (optional)</Label>
              <Textarea
                id="indicator-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What does this indicator measure, and when should it be used?"
                className="min-h-[120px] text-sm"
              />
            </div>
          </div>
        </div>
      </DialogContent>

      <IndicatorAssistantPanel
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        context={indicatorContext}
        onApplyCode={handleApplyCode}
      />
    </Dialog>
  );
};

export default IndicatorEditor;
