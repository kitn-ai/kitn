import { useState, useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { getClient } from "@/api/client";
import type { GatewayStatus } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Cpu,
  MessageSquare,
  Wrench,
  Database,
  Loader2,
  LayoutDashboard,
} from "lucide-react";

interface StatCard {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail?: string;
  badge?: string;
}

export function DashboardView() {
  const { setActiveView } = useSettingsStore();
  const { token } = useAuthStore();

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

        const gatewayResult = await client.getGatewayStatus();

        if (!cancelled) {
          setGateway(gatewayResult);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard");
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

  const cards: StatCard[] = gateway
    ? [
        {
          icon: <Cpu className="size-5 text-muted-foreground" />,
          title: "Provider",
          value: gateway.provider ?? "Unknown",
          detail: gateway.model ?? undefined,
          badge: gateway.configured ? "Configured" : "Unconfigured",
        },
        {
          icon: <MessageSquare className="size-5 text-muted-foreground" />,
          title: "Sessions",
          value: String(gateway.sessions),
          detail: "active conversations",
        },
        {
          icon: <Wrench className="size-5 text-muted-foreground" />,
          title: "Tools",
          value: String(gateway.workspaceTools),
          detail: `${gateway.workspaceAgents} agent${gateway.workspaceAgents !== 1 ? "s" : ""} registered`,
        },
        {
          icon: <Database className="size-5 text-muted-foreground" />,
          title: "Memory",
          value: gateway.memoryDbExists ? "Available" : "Not found",
          detail: "persistent memory database",
          badge: gateway.memoryDbExists ? "Online" : "Offline",
        },
      ]
    : [];

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
        <LayoutDashboard className="size-4 text-muted-foreground" />
        <h1 className="font-semibold text-sm">Dashboard</h1>
        <div className="flex-1" />
        {!loading && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => {
              setGateway(null);
              setLoading(true);
              setError(null);
              const client = getClient();
              if (token) client.setToken(token);
              client
                .getGatewayStatus()
                .then((result) => {
                  setGateway(result);
                })
                .catch((err) => {
                  setError(err instanceof Error ? err.message : "Refresh failed");
                })
                .finally(() => setLoading(false));
            }}
          >
            Refresh
          </Button>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
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

          {!loading && !error && gateway && (
            <>
              {/* Status grid */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {cards.map((card) => (
                  <Card key={card.title}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {card.title}
                      </CardTitle>
                      {card.icon}
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-2xl font-semibold leading-none tracking-tight">
                            {card.value}
                          </p>
                          {card.detail && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {card.detail}
                            </p>
                          )}
                        </div>
                        {card.badge && (
                          <Badge
                            variant={
                              card.badge === "Online" || card.badge === "Configured"
                                ? "default"
                                : "outline"
                            }
                            className="mb-0.5 shrink-0 text-xs"
                          >
                            {card.badge}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Config paths */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Paths</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Config</span>
                    <span className="truncate font-mono text-xs">{gateway.configPath}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Home</span>
                    <span className="truncate font-mono text-xs">{gateway.homePath}</span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
