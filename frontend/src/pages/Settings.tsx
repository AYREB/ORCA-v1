import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { User, Palette, SlidersHorizontal, Save, Moon, Sun, Monitor } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useSettings } from "@/hooks/useSettings.ts";
import { useToast } from "@/hooks/use-toast";

const Settings = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  // Local form state
  const [profile, setProfile] = useState(settings.profile);
  const [appearance, setAppearance] = useState(settings.appearance);
  const [defaults, setDefaults] = useState(settings.backtestDefaults);

  const initials = profile.displayName
    ? profile.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : profile.email ? profile.email[0].toUpperCase() : "?";

  const saveSection = (section: "profile" | "appearance" | "backtestDefaults", data: any) => {
    updateSettings({ [section]: data });
    toast({ title: "Settings saved", description: "Your changes have been saved." });
  };

  const themeOptions = [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: Sun },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  const chartSchemes = [
    { value: "classic", label: "Classic", colors: ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--destructive))"] },
    { value: "neon", label: "Neon", colors: ["#00ff88", "#00ccff", "#ff00cc"] },
    { value: "muted", label: "Muted", colors: ["#8b9dc3", "#a3c1ad", "#c3a38b"] },
  ] as const;

  return (
    <div className="min-h-screen bg-background flex">
      <Helmet>
        <title>Settings | ORCA</title>
        <meta name="description" content="Configure your ORCA trading platform settings" />
      </Helmet>

      <DashboardSidebar
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <main className={`flex-1 transition-all duration-300 ${isSidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <div className="p-6 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <h1 className="text-2xl font-bold text-foreground mb-1">Settings</h1>
            <p className="text-sm text-muted-foreground mb-6">Manage your profile, appearance, and backtest defaults.</p>

            <Tabs defaultValue="profile" className="space-y-6">
              <TabsList className="bg-muted/50 border border-border">
                <TabsTrigger value="profile" className="gap-1.5 text-xs">
                  <User className="h-3.5 w-3.5" /> Profile
                </TabsTrigger>
                <TabsTrigger value="appearance" className="gap-1.5 text-xs">
                  <Palette className="h-3.5 w-3.5" /> Appearance
                </TabsTrigger>
                <TabsTrigger value="defaults" className="gap-1.5 text-xs">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Backtest Defaults
                </TabsTrigger>
              </TabsList>

              {/* Profile */}
              <TabsContent value="profile">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Profile</CardTitle>
                    <CardDescription>Your display name and email.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-16 w-16 border-2 border-primary/20">
                        <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="text-sm text-muted-foreground">
                        Avatar is generated from your initials.
                      </div>
                    </div>
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="displayName">Display Name</Label>
                        <Input
                          id="displayName"
                          value={profile.displayName}
                          onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                          placeholder="Your name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={profile.email}
                          onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                          placeholder="you@example.com"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={() => saveSection("profile", profile)}
                      className="gap-1.5"
                    >
                      <Save className="h-3.5 w-3.5" /> Save Profile
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Appearance */}
              <TabsContent value="appearance">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Appearance</CardTitle>
                    <CardDescription>Theme, chart colors, and layout density.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Theme */}
                    <div className="space-y-3">
                      <Label>Theme</Label>
                      <div className="flex gap-2">
                        {themeOptions.map(({ value, label, icon: Icon }) => (
                          <button
                            key={value}
                            onClick={() => setAppearance({ ...appearance, theme: value })}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                              appearance.theme === value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Chart Color Scheme */}
                    <div className="space-y-3">
                      <Label>Chart Color Scheme</Label>
                      <div className="flex gap-3">
                        {chartSchemes.map(({ value, label, colors }) => (
                          <button
                            key={value}
                            onClick={() => setAppearance({ ...appearance, chartColorScheme: value })}
                            className={`flex flex-col items-center gap-2 px-4 py-3 rounded-lg border text-sm transition-all ${
                              appearance.chartColorScheme === value
                                ? "border-primary bg-primary/10"
                                : "border-border bg-muted/30 hover:bg-muted/50"
                            }`}
                          >
                            <div className="flex gap-1">
                              {colors.map((c, i) => (
                                <div key={i} className="w-5 h-5 rounded-full" style={{ backgroundColor: c }} />
                              ))}
                            </div>
                            <span className={appearance.chartColorScheme === value ? "text-primary font-medium" : "text-muted-foreground"}>
                              {label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Layout Density */}
                    <div className="space-y-3">
                      <Label>Layout Density</Label>
                      <div className="flex gap-2">
                        {(["compact", "comfortable"] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setAppearance({ ...appearance, layoutDensity: d })}
                            className={`px-4 py-2.5 rounded-lg border text-sm font-medium capitalize transition-all ${
                              appearance.layoutDensity === d
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Button
                      onClick={() => saveSection("appearance", appearance)}
                      className="gap-1.5"
                    >
                      <Save className="h-3.5 w-3.5" /> Save Appearance
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Backtest Defaults */}
              <TabsContent value="defaults">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Default Backtest Parameters</CardTitle>
                    <CardDescription>Pre-fill values when creating a new backtest.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="balance">Starting Balance ($)</Label>
                        <Input
                          id="balance"
                          type="number"
                          value={defaults.initialBalance}
                          onChange={(e) => setDefaults({ ...defaults, initialBalance: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="spread">Spread</Label>
                        <Input
                          id="spread"
                          type="number"
                          step="0.001"
                          value={defaults.spread}
                          onChange={(e) => setDefaults({ ...defaults, spread: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tp">Take Profit %</Label>
                        <Input
                          id="tp"
                          type="number"
                          value={defaults.takeProfitPercent}
                          onChange={(e) => setDefaults({ ...defaults, takeProfitPercent: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sl">Stop Loss %</Label>
                        <Input
                          id="sl"
                          type="number"
                          value={defaults.stopLossPercent}
                          onChange={(e) => setDefaults({ ...defaults, stopLossPercent: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timeframe">Default Timeframe</Label>
                      <Select
                        value={defaults.timeframe}
                        onValueChange={(v) => setDefaults({ ...defaults, timeframe: v })}
                      >
                        <SelectTrigger id="timeframe" className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                            <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => saveSection("backtestDefaults", defaults)}
                      className="gap-1.5"
                    >
                      <Save className="h-3.5 w-3.5" /> Save Defaults
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default Settings;
