import { create } from "zustand";
import { persist } from "zustand/middleware";

type ActiveView =
  | "chat"
  | "settings"
  | "dashboard"
  | "memory"
  | "audit"
  | "governance";

interface SettingsState {
  sidebarOpen: boolean;
  activeView: ActiveView;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      activeView: "chat",

      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      setActiveView: (view) => set({ activeView: view }),
    }),
    {
      name: "kitn-settings",
      partialize: (state) => ({ sidebarOpen: state.sidebarOpen }),
    }
  )
);
