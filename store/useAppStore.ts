import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Tables } from '@/lib/types';

interface AppState {
  profile: Tables<'users'> | null;
  recentScans: Tables<'scans'>[];
  archivedIds: string[];
  setProfile: (profile: Tables<'users'> | null) => void;
  updateCredits: (credits: number) => void;
  setRecentScans: (scans: Tables<'scans'>[]) => void;
  addArchivedId: (scanId: string) => void;
  removeArchivedId: (scanId: string) => void;
  setArchivedIds: (ids: string[]) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      profile: null,
      recentScans: [],
      archivedIds: [],
      setProfile: (profile) => set({ profile }),
      updateCredits: (credits) =>
        set((state) => ({
          profile: state.profile ? { ...state.profile, scan_credits: credits } : null,
        })),
      setRecentScans: (scans) => set({ recentScans: scans }),
      addArchivedId: (scanId) =>
        set((state) => ({
          archivedIds: state.archivedIds.includes(scanId)
            ? state.archivedIds
            : [...state.archivedIds, scanId],
        })),
      removeArchivedId: (scanId) =>
        set((state) => ({
          archivedIds: state.archivedIds.filter((id) => id !== scanId),
        })),
      setArchivedIds: (ids) => set({ archivedIds: ids }),
      reset: () =>
        set({
          profile: null,
          recentScans: [],
          archivedIds: [],
        }),
    }),
    {
      name: 'herbscan-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        profile: state.profile,
        recentScans: state.recentScans,
        archivedIds: state.archivedIds,
      }),
    }
  )
);
