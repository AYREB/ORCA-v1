import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, Lock, Pencil, Plus, Sigma, Trash2 } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import IndicatorEditor from "@/components/indicators/IndicatorEditor";
import { api, CustomIndicator, NativeIndicator } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const formatDefault = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
};

const NativeIndicatorCard = ({ indicator, index }: { indicator: NativeIndicator; index: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay: index * 0.04 }}
  >
    <Card className="border-border bg-card/50 backdrop-blur h-full">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-lg font-mono">{indicator.name}</CardTitle>
          {indicator.family && <p className="text-xs text-muted-foreground">{indicator.family}</p>}
        </div>
        <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
          <Lock className="h-3 w-3" />
          Built-in
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {indicator.typicalUse && <p className="text-sm text-muted-foreground">{indicator.typicalUse}</p>}
        {indicator.args.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {indicator.args.map((arg) => (
              <Badge key={arg} variant="secondary" className="font-mono text-[11px]">
                {arg}={formatDefault(indicator.defaults?.[arg])}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  </motion.div>
);

const CustomIndicators = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [native, setNative] = useState<NativeIndicator[]>([]);
  const [custom, setCustom] = useState<CustomIndicator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIndicator, setEditingIndicator] = useState<CustomIndicator | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await api.getCustomIndicators();
      setNative(data.native);
      setCustom(data.custom);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load indicators";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingIndicator(null);
    setEditorOpen(true);
  };

  const openEdit = (indicator: CustomIndicator) => {
    setEditingIndicator(indicator);
    setEditorOpen(true);
  };

  const handleSaved = (saved: CustomIndicator) => {
    setCustom((prev) => {
      const exists = prev.some((item) => item.id === saved.id);
      const next = exists ? prev.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...prev];
      return [...next].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
  };

  const handleDelete = async (indicator: CustomIndicator) => {
    try {
      await api.deleteCustomIndicator(indicator.id);
      setCustom((prev) => prev.filter((item) => item.id !== indicator.id));
      toast.success("Indicator deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete indicator";
      toast.error(message);
    }
  };

  const hasCustom = useMemo(() => custom.length > 0, [custom]);

  return (
    <>
      <Helmet>
        <title>Custom Indicators - Orca</title>
        <meta name="description" content="Browse native indicators and build, test, and manage your own." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar isCollapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

        <main className={`transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="p-6 max-w-7xl mx-auto space-y-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Sigma className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Custom Indicators</h1>
                  <p className="text-sm text-muted-foreground">
                    Browse native indicators and write, test, and manage your own.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" asChild>
                  <Link to="/dashboard/indicators/docs">
                    <BookOpen className="h-4 w-4 mr-2" />
                    Docs
                  </Link>
                </Button>
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Indicator
                </Button>
              </div>
            </div>

            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Native Indicators</h2>
                <p className="text-sm text-muted-foreground">
                  Ship with Orca and power the strategy builder. Reference only — they can't be edited or deleted.
                </p>
              </div>
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={idx} className="h-40 rounded-xl border border-border bg-card/50 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {native.map((indicator, index) => (
                    <NativeIndicatorCard key={indicator.name} indicator={indicator} index={index} />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Your Indicators</h2>
                <p className="text-sm text-muted-foreground">
                  Yours to write, test, edit, and delete — built on the same rigid contract as the native set.
                </p>
              </div>

              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {Array.from({ length: 2 }).map((_, idx) => (
                    <div key={idx} className="h-40 rounded-xl border border-border bg-card/50 animate-pulse" />
                  ))}
                </div>
              ) : hasCustom ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {custom.map((indicator, index) => (
                    <motion.div
                      key={indicator.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: index * 0.04 }}
                    >
                      <Card className="border-border bg-card/60 backdrop-blur h-full">
                        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                          <div className="space-y-1">
                            <CardTitle className="text-lg">{indicator.name}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                              Updated {new Date(indicator.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(indicator)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete indicator</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{indicator.name}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(indicator)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="p-3 rounded-lg border border-border bg-secondary/30 min-h-[56px]">
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {indicator.description || "No description yet."}
                            </p>
                          </div>
                          {indicator.parameters.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {indicator.parameters.map((param) => (
                                <Badge key={param.name} variant="secondary" className="font-mono text-[11px]">
                                  {param.name}={formatDefault(param.default)}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <Button variant="secondary" className="w-full" onClick={() => openEdit(indicator)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Open in editor
                          </Button>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
                  <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                    <Sigma className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No custom indicators yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                    Write your own indicator in the Python editor, run it through the compiler/tester, and save it
                    here once it passes.
                  </p>
                  <Button onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Indicator
                  </Button>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      <IndicatorEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        indicator={editingIndicator}
        onSaved={handleSaved}
      />
    </>
  );
};

export default CustomIndicators;
