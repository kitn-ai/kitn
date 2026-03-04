import { useSettingsStore } from "@/stores/settings";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { PanelLeft } from "lucide-react";

export function ChatHeader() {
  const { sidebarOpen, toggleSidebar } = useSettingsStore();
  const isMobile = useIsMobile();

  return (
    <header className="flex h-14 items-center gap-2 border-b border-border bg-background px-4">
      {(!sidebarOpen || isMobile) && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={toggleSidebar}
        >
          <PanelLeft className="size-5" />
        </Button>
      )}
      <div className="flex-1" />
    </header>
  );
}
