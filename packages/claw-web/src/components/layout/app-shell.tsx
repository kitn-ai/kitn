import { Sidebar } from "./sidebar";
import { ChatView } from "@/components/chat/chat-view";
import { SettingsView } from "@/components/settings/settings-view";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { MemoryView } from "@/components/memory/memory-view";
import { AuditView } from "@/components/audit/audit-view";
import { GovernanceView } from "@/components/governance/governance-view";
import { useSettingsStore } from "@/stores/settings";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function AppShell() {
  const { sidebarOpen, activeView } = useSettingsStore();
  const isMobile = useIsMobile();

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main
        className={cn(
          "flex-1 transition-[margin] duration-200 ease-in-out",
          !isMobile && sidebarOpen && "ml-72",
        )}
      >
        {activeView === "chat" && <ChatView />}
        {activeView === "settings" && <SettingsView />}
        {activeView === "dashboard" && <DashboardView />}
        {activeView === "memory" && <MemoryView />}
        {activeView === "audit" && <AuditView />}
        {activeView === "governance" && <GovernanceView />}
      </main>
    </div>
  );
}
