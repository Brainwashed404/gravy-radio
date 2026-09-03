import { useState, useCallback } from 'react';

const STORAGE_KEY = 'lucky-breaks-favourites';
// The app used to be called Gravy Radio; this key carries real listeners'
// favourites, so a rename here needs a one-time migration rather than just
// switching the constant, or everyone's list would silently read back empty.
const LEGACY_STORAGE_KEY = 'gravy-radio-favourites';

function loadFavourites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(STORAGE_KEY, legacy);
      return new Set(JSON.parse(legacy) as string[]);
    }
    return new Set();
  } catch {
    return new Set();
  }
}

export function useFavourites() {
  const [favourites, setFavourites] = useState<Set<string>>(loadFavourites);

  const toggleFavourite = useCallback((id: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);

  const replaceFavourites = useCallback((ids: string[]) => {
    const next = new Set(ids);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {}
    setFavourites(next);
  }, []);

  return { favourites, toggleFavourite, replaceFavourites };
}
