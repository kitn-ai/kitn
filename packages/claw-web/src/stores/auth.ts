import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  token: string | null;
  isConnected: boolean;
  setToken: (token: string | null) => void;
  setConnected: (connected: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      isConnected: false,

      setToken: (token) => set({ token }),

      setConnected: (connected) => set({ isConnected: connected }),

      logout: () => set({ token: null, isConnected: false }),
    }),
    {
      name: "kitn-auth",
      partialize: (state) => ({ token: state.token }),
    }
  )
);
