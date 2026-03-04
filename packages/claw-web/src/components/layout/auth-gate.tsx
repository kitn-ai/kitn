import { useState, useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/api/client";
import { KeyRound, Loader2, Wifi, WifiOff } from "lucide-react";

export function AuthGate({ children }: { children: ReactNode }) {
  const { token, isConnected, setToken, setConnected } = useAuthStore();
  const [inputToken, setInputToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkConnection();
  }, [token]);

  async function checkConnection() {
    setChecking(true);
    setError(null);
    try {
      const health = await apiClient.getHealth();
      if (health) {
        // Try status (requires auth)
        const status = await apiClient.getStatus(token ?? undefined);
        if (status) {
          setConnected(true);
          setChecking(false);
          return;
        }
        // If status fails but health passes, might need a token
        if (!token) {
          setConnected(false);
          setChecking(false);
          return;
        }
      }
      setConnected(false);
    } catch {
      setConnected(false);
    }
    setChecking(false);
  }

  async function handleConnect() {
    setError(null);
    setChecking(true);
    try {
      const status = await apiClient.getStatus(inputToken || undefined);
      if (status) {
        setToken(inputToken || null);
        setConnected(true);
      } else {
        setError("Could not connect. Check your token and try again.");
      }
    } catch {
      setError("Connection failed. Is KitnClaw running?");
    }
    setChecking(false);
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Connecting to KitnClaw...</p>
        </div>
      </div>
    );
  }

  if (isConnected) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="mx-auto w-full max-w-sm space-y-8 px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <KeyRound className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold">KitnClaw</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect to your AI assistant
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">Auth Token</Label>
            <Input
              id="token"
              type="password"
              placeholder="Enter your gateway auth token"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty if your gateway has no auth token configured.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <WifiOff className="size-4 shrink-0" />
              {error}
            </div>
          )}

          <Button onClick={handleConnect} className="w-full" disabled={checking}>
            {checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wifi className="size-4" />
            )}
            Connect
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Make sure KitnClaw is running on{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            localhost:18800
          </code>
        </p>
      </div>
    </div>
  );
}
