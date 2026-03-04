import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGate } from "@/components/layout/auth-gate";

export function App() {
  return (
    <TooltipProvider>
      <AuthGate>
        <AppShell />
      </AuthGate>
      <Toaster position="bottom-right" theme="dark" />
    </TooltipProvider>
  );
}
