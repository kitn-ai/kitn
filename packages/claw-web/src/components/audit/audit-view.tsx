import { useState, useEffect, useMemo } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { getClient } from "@/api/client";
import type { AuditEntry } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  ClipboardList,
  Loader2,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";

function getEventBadgeClasses(event: string): string {
  if (event.startsWith("error") || event.includes("error")) {
    return "bg-destructive text-white";
  }
  if (event.startsWith("permission") || event.includes("permission")) {
    return "bg-amber-500/15 text-amber-700 border-amber-500/25 dark:text-amber-400";
  }
  // tool:execute and other events default to primary
  return "bg-primary/15 text-primary border-primary/25";
}

function getDecisionBadgeClasses(decision: string): string {
  switch (decision) {
    case "allow":
    case "trust":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:text-emerald-400";
    case "deny":
      return "bg-destructive text-white";
    case "confirm":
      return "bg-amber-500/15 text-amber-700 border-amber-500/25 dark:text-amber-400";
    default:
      return "";
  }
}

export function AuditView() {
  const { setActiveView } = useSettingsStore();
  const { token } = useAuthStore();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventFilter, setEventFilter] = useState<string>("all");
  const [toolFilter, setToolFilter] = useState("");

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      if (token) client.setToken(token);
      const result = await client.listAudit();
      setEntries(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load audit log"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const client = getClient();
        if (token) client.setToken(token);
        const result = await client.listAudit();
        if (!cancelled) setEntries(result);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load audit log"
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

  const uniqueEvents = useMemo(() => {
    const set = new Set(entries.map((e) => e.event));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (eventFilter !== "all" && entry.event !== eventFilter) return false;
      if (
        toolFilter &&
        (!entry.toolName ||
          !entry.toolName.toLowerCase().includes(toolFilter.toLowerCase()))
      ) {
        return false;
      }
      return true;
    });
  }, [entries, eventFilter, toolFilter]);

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
        <ClipboardList className="size-4 text-muted-foreground" />
        <h1 className="font-semibold text-sm">Audit Log</h1>
        <div className="flex-1" />
        {!loading && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={() => fetchData()}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
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
              {/* Filter row */}
              <div className="flex flex-wrap items-center gap-3">
                <Select value={eventFilter} onValueChange={setEventFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All events" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All events</SelectItem>
                    {uniqueEvents.map((event) => (
                      <SelectItem key={event} value={event}>
                        {event}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  placeholder="Filter by tool name..."
                  value={toolFilter}
                  onChange={(e) => setToolFilter(e.target.value)}
                  className="w-[200px]"
                />

                <Badge variant="secondary" className="ml-auto text-xs">
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "entry" : "entries"}
                </Badge>
              </div>

              {/* Entries */}
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <ClipboardList className="size-10 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    No audit entries found.
                  </p>
                </div>
              ) : (
                <div className="relative space-y-0">
                  {/* Timeline line */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

                  {filtered.map((entry, idx) => (
                    <AuditEntryItem key={`${entry.createdAt}-${idx}`} entry={entry} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditEntryItem({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const hasInput = entry.input && Object.keys(entry.input).length > 0;

  return (
    <div className="relative flex gap-4 py-3 pl-0">
      {/* Timeline dot */}
      <div className="relative z-10 mt-1.5 flex size-[30px] shrink-0 items-center justify-center rounded-full border bg-background">
        <div
          className={cn(
            "size-2.5 rounded-full",
            entry.event.includes("error")
              ? "bg-destructive"
              : entry.event.includes("permission")
                ? "bg-amber-500"
                : "bg-primary"
          )}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn("text-xs", getEventBadgeClasses(entry.event))}
          >
            {entry.event}
          </Badge>

          {entry.toolName && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {entry.toolName}
            </span>
          )}

          {entry.decision && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                getDecisionBadgeClasses(entry.decision)
              )}
            >
              {entry.decision}
            </Badge>
          )}

          {entry.duration !== undefined && (
            <span className="text-xs text-muted-foreground">
              {entry.duration}ms
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {entry.sessionId && (
            <span title={entry.sessionId}>
              session: {entry.sessionId.length > 12
                ? `${entry.sessionId.slice(0, 12)}...`
                : entry.sessionId}
            </span>
          )}
          {entry.channelType && <span>channel: {entry.channelType}</span>}
          {entry.reason && (
            <span className="italic" title={entry.reason}>
              {entry.reason.length > 60
                ? `${entry.reason.slice(0, 60)}...`
                : entry.reason}
            </span>
          )}
          <span>{formatRelativeTime(entry.createdAt)}</span>
        </div>

        {hasInput && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform",
                    open && "rotate-90"
                  )}
                />
                Input details
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
                {JSON.stringify(entry.input, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
