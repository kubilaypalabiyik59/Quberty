import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface PosSessionState {
  session:      any | null;
  terminalName: string;
  /** The store warehouse this terminal last sold from, remembered per terminal. */
  warehouseId:  string | null;
  setSession:   (s: any) => void;
  setTerminal:  (name: string) => void;
  setWarehouseId: (id: string | null) => void;
  clearSession: () => void;
}

export const usePosSessionStore = create<PosSessionState>()(
  persist(
    (set) => ({
      session:      null,
      terminalName: 'Terminal-1',
      warehouseId:  null,
      setSession:   (session)      => set({ session }),
      setTerminal:  (terminalName) => set({ terminalName }),
      setWarehouseId: (warehouseId) => set({ warehouseId }),
      clearSession: ()             => set({ session: null }),
    }),
    { name: 'pos-session-web', storage: createJSONStorage(() => localStorage) }
  )
);
