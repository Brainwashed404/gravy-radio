import { useState, useEffect } from 'react';

const STORAGE_KEY = 'lucky-breaks-dark-mode';

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return stored === 'true';
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem(STORAGE_KEY, String(dark));
    } catch {}
  }, [dark]);

  const toggle = () => setDark((d) => !d);

  return { dark, toggle };
}
