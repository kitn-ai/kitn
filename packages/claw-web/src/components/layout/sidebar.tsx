import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";
import { useAuthStore } from "@/stores/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, getTimeBucket, truncate } from "@/lib/utils";
import {
  Plus,
  MessageSquare,
  Settings,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
  LogOut,
  Brain,
  Database,
  ClipboardList,
  Shield,
} from "lucide-react";
import { useState, useMemo } from "react";

export function Sidebar() {
  const isMobile = useIsMobile();
  const { sidebarOpen, toggleSidebar, setActiveView, activeView } = useSettingsStore();
  const { sessions, activeSessionId, createSession, setActiveSession, deleteSession, renameSession } = useChatStore();
  const { logout } = useAuthStore();

  function handleNewChat() {
    const id = createSession();
    setActiveSession(id);
    setActiveView("chat");
    if (isMobile) toggleSidebar();
  }

  function handleSelectSession(id: string) {
    setActiveSession(id);
    setActiveView("chat");
    if (isMobile) toggleSidebar();
  }

  function handleNav(view: "settings" | "dashboard" | "memory" | "audit" | "governance") {
    setActiveView(view);
    if (isMobile) toggleSidebar();
  }

  // Group sessions by time bucket
  const groupedSessions = useMemo(() => {
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    const groups: Record<string, typeof sessions> = {};
    for (const session of sorted) {
      const bucket = getTimeBucket(session.updatedAt);
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(session);
    }
    return groups;
  }, [sessions]);

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}

      {/* Toggle button (shown when sidebar is closed on desktop) */}
      {!sidebarOpen && !isMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-3 top-3 z-30"
          onClick={toggleSidebar}
        >
          <PanelLeft className="size-5" />
        </Button>
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Brain className="size-4" />
            </div>
            <span className="font-semibold text-sm">KitnClaw</span>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={toggleSidebar}>
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        {/* New Chat button */}
        <div className="px-3 pb-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-sm"
            onClick={handleNewChat}
          >
            <Plus className="size-4" />
            New conversation
          </Button>
        </div>

        <Separator />

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {Object.entries(groupedSessions).map(([bucket, items]) => (
            <div key={bucket} className="mb-3">
              <p className="px-2 py-1 text-xs font-medium text-sidebar-muted-foreground">
                {bucket}
              </p>
              {items.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId && activeView === "chat"}
                  onSelect={() => handleSelectSession(session.id)}
                  onDelete={() => deleteSession(session.id)}
                  onRename={(title) => renameSession(session.id, title)}
                />
              ))}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-sidebar-muted-foreground">
              No conversations yet
            </p>
          )}
        </div>

        <Separator />

        {/* Footer nav */}
        <div className="space-y-1 p-2">
          <Button
            variant={activeView === "dashboard" ? "secondary" : "ghost"}
            className="w-full justify-start gap-2 text-sm"
            onClick={() => handleNav("dashboard")}
          >
            <LayoutDashboard className="size-4" />
            Dashboard
          </Button>
          <Button
            variant={activeView === "memory" ? "secondary" : "ghost"}
            className="w-full justify-start gap-2 text-sm"
            onClick={() => handleNav("memory")}
          >
            <Database className="size-4" />
            Memory
          </Button>
          <Button
            variant={activeView === "audit" ? "secondary" : "ghost"}
            className="w-full justify-start gap-2 text-sm"
            onClick={() => handleNav("audit")}
          >
            <ClipboardList className="size-4" />
            Audit Log
          </Button>
          <Button
            variant={activeView === "governance" ? "secondary" : "ghost"}
            className="w-full justify-start gap-2 text-sm"
            onClick={() => handleNav("governance")}
          >
            <Shield className="size-4" />
            Governance
          </Button>
          <Separator className="my-1" />
          <Button
            variant={activeView === "settings" ? "secondary" : "ghost"}
            className="w-full justify-start gap-2 text-sm"
            onClick={() => handleNav("settings")}
          >
            <Settings className="size-4" />
            Settings
          </Button>
          <Separator className="my-1" />
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-sm text-muted-foreground hover:text-destructive"
            onClick={logout}
          >
            <LogOut className="size-4" />
            Disconnect
          </Button>
        </div>
      </aside>
    </>
  );
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  session: { id: string; title: string; messages: unknown[]; updatedAt: string };
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);

  function handleRename() {
    if (editTitle.trim() && editTitle !== session.title) {
      onRename(editTitle.trim());
    }
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50",
      )}
      onClick={() => !editing && onSelect()}
    >
      <MessageSquare className="mr-2 size-4 shrink-0 text-muted-foreground" />
      {editing ? (
        <input
          className="flex-1 bg-transparent text-sm outline-none"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate">{truncate(session.title, 32)}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-sidebar-muted group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => { setEditTitle(session.title); setEditing(true); }}>
            <Pencil className="mr-2 size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-2 size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
