import { useState, useEffect, useMemo } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { getClient } from "@/api/client";
import type { MemoryEntry } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Database,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

export function MemoryView() {
  const { setActiveView } = useSettingsStore();
  const { token } = useAuthStore();

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const client = getClient();
        if (token) client.setToken(token);

        const result = await client.listMemory();

        if (!cancelled) {
          setEntries(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load memory"
          );
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

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(q) ||
        entry.value.toLowerCase().includes(q)
    );
  }, [entries, searchQuery]);

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleDelete(key: string) {
    const confirmed = window.confirm(
      `Delete memory entry "${key}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const client = getClient();
      if (token) client.setToken(token);
      await client.deleteMemoryEntry(key);
      setEntries((prev) => prev.filter((e) => e.key !== key));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete entry"
      );
    }
  }

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
        <Database className="size-4 text-muted-foreground" />
        <h1 className="font-semibold text-sm">Memory</h1>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
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
              {/* Search bar and count */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by key or value..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {filteredEntries.length === entries.length
                    ? `${entries.length} entries`
                    : `${filteredEntries.length} / ${entries.length}`}
                </Badge>
              </div>

              {/* Entry list */}
              {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Database className="mb-3 size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    No memory entries found
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredEntries.map((entry) => {
                    const isExpanded = expandedKeys.has(entry.key);
                    const valueLines = entry.value.split("\n");
                    const isTruncatable = valueLines.length > 3;

                    return (
                      <Card key={entry.key}>
                        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                          <CardTitle className="font-mono text-sm font-bold">
                            {entry.key}
                          </CardTitle>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(entry.key)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div
                            className={
                              !isExpanded && isTruncatable
                                ? "line-clamp-3"
                                : undefined
                            }
                          >
                            <p className="whitespace-pre-wrap text-sm text-foreground/80">
                              {entry.value}
                            </p>
                          </div>
                          {isTruncatable && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => toggleExpand(entry.key)}
                            >
                              {isExpanded ? "Show less" : "Show more"}
                            </Button>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            {entry.context && (
                              <Badge
                                variant="outline"
                                className="text-xs text-muted-foreground"
                              >
                                {entry.context}
                              </Badge>
                            )}
                            <span className="ml-auto text-xs text-muted-foreground">
                              {formatRelativeTime(entry.updatedAt)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
