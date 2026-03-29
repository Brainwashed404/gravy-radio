import { useState, useCallback } from 'react';

const STORAGE_KEY = 'gravy-radio-favourites';

function loadFavourites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
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

  return { favourites, toggleFavourite };
}
