import { create } from "zustand";
import type { SoundgasmPost } from "../api/hooks/soundgasm";

export interface ImportJobRef {
  jobId: string;
  label: string;
}

/**
 * The Import screen's state, held outside React so it survives leaving the route.
 *
 * Playing a track from an import panel is a round trip — file row → player screen → back — and
 * with the state in the component, coming back re-mounted an empty screen: the job panels, the
 * list of files just imported, and the profile listing you were working through were all gone.
 * Nothing here is persisted to disk; it lasts for the tab's lifetime, which is the span over
 * which an import is one continuous task. Jobs themselves live in the backend's memory, so a
 * remembered job whose server has since restarted simply renders nothing.
 */
interface ImportState {
  profileUrl: string;
  manualPostUrl: string;
  listing: { username: string; posts: SoundgasmPost[] } | null;
  selected: Set<string>;
  filterText: string;
  hideAlreadyInLibrary: boolean;
  libraryRootId: number | undefined;
  bulkJob: ImportJobRef | null;
  quickJobs: ImportJobRef[];

  setProfileUrl: (url: string) => void;
  setManualPostUrl: (url: string) => void;
  /** A fresh profile listing: clears the previous listing's filters and bulk job. */
  setListing: (listing: { username: string; posts: SoundgasmPost[] }, selected: Set<string>) => void;
  clearListing: () => void;
  setFilterText: (text: string) => void;
  setHideAlreadyInLibrary: (hide: boolean) => void;
  setLibraryRootId: (id: number) => void;
  toggleSelected: (postUrl: string) => void;
  setSelectedFor: (postUrls: string[], selected: boolean) => void;
  setBulkJob: (job: ImportJobRef) => void;
  addQuickJob: (job: ImportJobRef) => void;
  dismissQuickJob: (jobId: string) => void;
}

export const useImportStore = create<ImportState>((set) => ({
  profileUrl: "",
  manualPostUrl: "",
  listing: null,
  selected: new Set(),
  filterText: "",
  // On by default: the usual reason to re-list a profile is to find what's new since last time.
  hideAlreadyInLibrary: true,
  libraryRootId: undefined,
  bulkJob: null,
  quickJobs: [],

  setProfileUrl: (profileUrl) => set({ profileUrl }),
  setManualPostUrl: (manualPostUrl) => set({ manualPostUrl }),
  setListing: (listing, selected) =>
    set({ listing, selected, filterText: "", hideAlreadyInLibrary: true, bulkJob: null }),
  clearListing: () => set({ listing: null, selected: new Set(), bulkJob: null }),
  setFilterText: (filterText) => set({ filterText }),
  setHideAlreadyInLibrary: (hideAlreadyInLibrary) => set({ hideAlreadyInLibrary }),
  setLibraryRootId: (libraryRootId) => set({ libraryRootId }),
  toggleSelected: (postUrl) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(postUrl)) next.delete(postUrl);
      else next.add(postUrl);
      return { selected: next };
    }),
  setSelectedFor: (postUrls, selected) =>
    set((s) => {
      const next = new Set(s.selected);
      postUrls.forEach((url) => (selected ? next.add(url) : next.delete(url)));
      return { selected: next };
    }),
  setBulkJob: (bulkJob) => set({ bulkJob }),
  addQuickJob: (job) => set((s) => ({ quickJobs: [job, ...s.quickJobs] })),
  dismissQuickJob: (jobId) => set((s) => ({ quickJobs: s.quickJobs.filter((j) => j.jobId !== jobId) })),
}));
