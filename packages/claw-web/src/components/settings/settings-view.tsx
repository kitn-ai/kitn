import { useState, useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { getClient } from "@/api/client";
import type { StatusResponse, GatewayStatus } from "@/api/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Server, Shield, Settings, Loader2 } from "lucide-react";

export function SettingsView() {
  const { setActiveView } = useSettingsStore();
  const { token } = useAuthStore();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const client = getClient();
        if (token) client.setToken(token);

        const [statusResult, gatewayResult] = await Promise.all([
          client.getStatus(),
          client.getGatewayStatus(),
        ]);

        if (!cancelled) {
          setStatus(statusResult);
          setGateway(gatewayResult);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setActiveView("chat")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Settings className="size-4 text-muted-foreground" />
        <h1 className="font-semibold text-sm">Settings</h1>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && (
            <Tabs defaultValue="general">
              <TabsList className="mb-6">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="gateway">Gateway</TabsTrigger>
                <TabsTrigger value="permissions">Permissions</TabsTrigger>
              </TabsList>

              {/* Tab: General */}
              <TabsContent value="general" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Model</CardTitle>
                    <CardDescription>
                      The AI model currently in use by KitnClaw.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Active model</Label>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {status?.model ?? "—"}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Version</Label>
                      <span className="text-sm">{status?.version ?? "—"}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Safety Profile</CardTitle>
                    <CardDescription>
                      Current safety and permission configuration profile.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Profile</Label>
                      <Badge variant="outline">
                        {gateway?.configured ? "Configured" : "Default"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab: Gateway */}
              <TabsContent value="gateway" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Server className="size-4" />
                      Gateway Configuration
                    </CardTitle>
                    <CardDescription>
                      Connection and runtime details for the KitnClaw gateway.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Provider</Label>
                      <span className="text-sm">{gateway?.provider ?? "—"}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Model</Label>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {gateway?.model ?? "—"}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Config path</Label>
                      <span className="max-w-[260px] truncate text-right font-mono text-xs text-muted-foreground">
                        {gateway?.configPath ?? "—"}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Home path</Label>
                      <span className="max-w-[260px] truncate text-right font-mono text-xs text-muted-foreground">
                        {gateway?.homePath ?? "—"}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Auth token</Label>
                      <Badge
                        variant={token ? "default" : "outline"}
                        className="text-xs"
                      >
                        {token ? "Configured" : "None"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Channels</CardTitle>
                    <CardDescription>
                      Active communication channels on this gateway.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {status?.channels && status.channels.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {status.channels.map((ch) => (
                          <Badge key={ch} variant="secondary" className="font-mono text-xs">
                            {ch}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No channels configured.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab: Permissions */}
              <TabsContent value="permissions" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Shield className="size-4" />
                      Permissions
                    </CardTitle>
                    <CardDescription>
                      Tool access controls and workspace safety settings.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Workspace tools</Label>
                      <Badge variant="secondary">
                        {gateway?.workspaceTools ?? 0}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Workspace agents</Label>
                      <Badge variant="secondary">
                        {gateway?.workspaceAgents ?? 0}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">Memory database</Label>
                      <Badge
                        variant={gateway?.memoryDbExists ? "default" : "outline"}
                        className="text-xs"
                      >
                        {gateway?.memoryDbExists ? "Available" : "Not found"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Denied Tools</CardTitle>
                    <CardDescription>
                      Tools that are blocked from execution in this session.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      No tools are currently denied. Denied tools will appear here once configured.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
