import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  XCircle,
} from "lucide-react";

interface ToolCallCardProps {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  status?: "running" | "done" | "error";
}

export function ToolCallCard({
  name,
  input,
  result,
  status = result !== undefined ? "done" : "running",
}: ToolCallCardProps) {
  const [open, setOpen] = useState(false);

  const statusIcon = {
    running: <Loader2 className="size-4 animate-spin text-primary" />,
    done: <CheckCircle2 className="size-4 text-emerald-500" />,
    error: <XCircle className="size-4 text-destructive" />,
  }[status];

  const statusLabel = {
    running: "Running",
    done: "Completed",
    error: "Failed",
  }[status];

  // Compact input summary
  const inputSummary = Object.entries(input)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      const short = val.length > 40 ? val.slice(0, 37) + "\u2026" : val;
      return `${k}: ${short}`;
    })
    .join(", ");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        {statusIcon}
        <span className="font-mono text-xs font-medium text-foreground">
          {name}
        </span>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          ({inputSummary})
        </span>
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-2 rounded-lg border border-border bg-card/50 px-3 py-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Input
            </p>
            <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-xs text-foreground">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Result
              </p>
              <pre className="max-h-48 overflow-auto rounded bg-background p-2 font-mono text-xs text-foreground">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
