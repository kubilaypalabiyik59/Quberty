import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface PosSessionState {
  session:      any | null;
  terminalName: string;
  setSession:   (s: any) => void;
  setTerminal:  (name: string) => void;
  clearSession: () => void;
}

export const usePosSessionStore = create<PosSessionState>()(
  persist(
    (set) => ({
      session:      null,
      terminalName: 'Terminal-1',
      setSession:   (session)      => set({ session }),
      setTerminal:  (terminalName) => set({ terminalName }),
      clearSession: ()             => set({ session: null }),
    }),
    { name: 'pos-session-web', storage: createJSONStorage(() => localStorage) }
  )
);
