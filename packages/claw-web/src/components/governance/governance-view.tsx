import { useState, useEffect, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { getClient } from "@/api/client";
import type { DraftEntry, BudgetSummary } from "@/api/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

type DraftFilter = "all" | "pending" | "approved" | "rejected";

function statusBadgeProps(status: DraftEntry["status"]) {
  switch (status) {
    case "pending":
      return {
        variant: "outline" as const,
        className: "border-amber-500/50 text-amber-600 dark:text-amber-400",
      };
    case "approved":
      return {
        variant: "default" as const,
        className: "bg-emerald-600 text-white",
      };
    case "rejected":
      return { variant: "destructive" as const, className: "" };
  }
}

export function GovernanceView() {
  const { setActiveView } = useSettingsStore();
  const { token } = useAuthStore();

  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [budget, setBudget] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<DraftFilter>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      if (token) client.setToken(token);

      const [draftsResult, budgetResult] = await Promise.all([
        client.listDrafts(),
        client.getBudget(),
      ]);

      setDrafts(draftsResult);
      setBudget(budgetResult);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load governance data"
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const client = getClient();
        if (token) client.setToken(token);

        const [draftsResult, budgetResult] = await Promise.all([
          client.listDrafts(),
          client.getBudget(),
        ]);

        if (!cancelled) {
          setDrafts(draftsResult);
          setBudget(budgetResult);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load governance data"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleApprove = useCallback(
    async (id: string) => {
      try {
        const client = getClient();
        if (token) client.setToken(token);
        await client.approveDraft(id);
        setDrafts((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to approve draft"
        );
      }
    },
    [token]
  );

  const handleReject = useCallback(
    async (id: string) => {
      try {
        const client = getClient();
        if (token) client.setToken(token);
        await client.rejectDraft(id);
        setDrafts((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to reject draft"
        );
      }
    },
    [token]
  );

  const filteredDrafts =
    activeFilter === "all"
      ? drafts
      : drafts.filter((d) => d.status === activeFilter);

  const budgetDomains = budget ? Object.keys(budget) : [];

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
        <Shield className="size-4 text-muted-foreground" />
        <h1 className="font-semibold text-sm">Governance</h1>
        <div className="flex-1" />
        {!loading && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => fetchData()}
          >
            <RefreshCw className="mr-1 size-3" />
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

          {!loading && !error && (
            <>
              {/* Draft Queue */}
              <div className="space-y-4">
                <h2 className="font-semibold text-sm">Draft Queue</h2>
                <Tabs
                  value={activeFilter}
                  onValueChange={(v) => setActiveFilter(v as DraftFilter)}
                >
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="pending">Pending</TabsTrigger>
                    <TabsTrigger value="approved">Approved</TabsTrigger>
                    <TabsTrigger value="rejected">Rejected</TabsTrigger>
                  </TabsList>

                  <TabsContent value={activeFilter} className="mt-4 space-y-3">
                    {filteredDrafts.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No drafts
                        {activeFilter !== "all"
                          ? ` with status "${activeFilter}"`
                          : ""}{" "}
                        found.
                      </p>
                    ) : (
                      filteredDrafts.map((draft) => {
                        const badgeProps = statusBadgeProps(draft.status);
                        return (
                          <Card key={draft.id}>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={badgeProps.variant}
                                    className={badgeProps.className}
                                  >
                                    {draft.status}
                                  </Badge>
                                  <CardTitle className="text-sm font-medium">
                                    {draft.action}
                                  </CardTitle>
                                </div>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {formatRelativeTime(draft.createdAt)}
                                </span>
                              </div>
                              <CardDescription className="mt-1">
                                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                  {draft.toolName}
                                </code>
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground">
                                {draft.preview}
                              </p>
                              {draft.status === "pending" && (
                                <div className="mt-3 flex gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                    onClick={() => handleApprove(draft.id)}
                                  >
                                    <CheckCircle2 className="mr-1 size-4" />
                                    Approve
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:bg-destructive/10"
                                    onClick={() => handleReject(draft.id)}
                                  >
                                    <XCircle className="mr-1 size-4" />
                                    Reject
                                  </Button>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Budget */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Budget</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {budgetDomains.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No budget data available.
                    </p>
                  ) : (
                    budgetDomains.map((domain) => {
                      const entry = budget![domain];
                      const pct =
                        entry.limit > 0
                          ? Math.min((entry.spent / entry.limit) * 100, 100)
                          : 0;
                      return (
                        <div key={domain} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{domain}</span>
                            <span className="text-xs text-muted-foreground">
                              {entry.remaining} / {entry.limit} remaining
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
