import { create } from "zustand";

interface AuthState {
  access: string | null;
  tier: string | null;
  setAuth: (access: string, tier: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  access: null,
  tier: null,
  setAuth: (access, tier) => set({ access, tier }),
  clear: () => set({ access: null, tier: null }),
}));
