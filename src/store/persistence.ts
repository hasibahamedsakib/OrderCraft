import type { PersistedBuilder } from './slices/builderSlice';

/** Unfinished configuration survives a refresh (Part G). Only the user's choices are saved. */
const BUILDER_KEY = 'ordercraft.builder.v1';

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadBuilderDraft(storage: MinimalStorage | null): Partial<PersistedBuilder> | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(BUILDER_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PersistedBuilder>;
    const selection: Record<string, number> = {};
    if (parsed.selection && typeof parsed.selection === 'object') {
      for (const [id, qty] of Object.entries(parsed.selection)) {
        if (Number.isInteger(qty) && qty > 0) selection[id] = qty;
      }
    }
    return {
      selection,
      qty: Number.isInteger(parsed.qty) ? parsed.qty : 1,
      editingItemId: typeof parsed.editingItemId === 'string' ? parsed.editingItemId : null,
    };
  } catch {
    return undefined;
  }
}

export function saveBuilderDraft(storage: MinimalStorage | null, draft: PersistedBuilder): void {
  if (!storage) return;
  try {
    storage.setItem(BUILDER_KEY, JSON.stringify(draft));
  } catch {
    // storage full or blocked: the draft just won't survive a refresh
  }
}
