import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { type Genre, type Station, PAD_LABELS, PAD_GENRE_MAP } from '../../data/stations';
import { StationCard } from './StationCard';
import styles from './StationIndexModal.module.css';

type FilterState = Genre | 'FAVOURITES' | null;

interface StationIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  stations: Station[];
  currentStation: Station | null;
  onSelectStation: (station: Station) => void;
  activeGenre: Genre | null;
  favsMode: boolean;
  favourites: Set<string>;
  onToggleFavourite: (id: string) => void;
  onFilterChange: (filter: FilterState) => void;
}

export function StationIndexModal({
  onClose,
  stations,
  currentStation,
  onSelectStation,
  activeGenre,
  favsMode,
  favourites,
  onToggleFavourite,
  onFilterChange,
}: StationIndexModalProps) {
  // Pre-select FAVS filter if favsMode is active, otherwise pre-select the active genre
  const [filter, setFilter] = useState<FilterState>(favsMode ? 'FAVOURITES' : activeGenre);
  const [filterOpen, setFilterOpen] = useState(false);

  const applyFilter = (next: FilterState) => {
    setFilter(next);
    onFilterChange(next);
  };
  const [search, setSearch] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const sortKey = (name: string) => {
    const stripped = name.replace(/^the\s+/i, '');
    return /^\d/.test(stripped) ? 'zzz_' + stripped.toLowerCase() : stripped.toLowerCase();
  };

  const filtered = stations
    .filter((s) =>
      filter === 'FAVOURITES'
        ? favourites.has(s.id)
        : filter
        ? s.genre === filter
        : true,
    )
    .filter((s) =>
      search ? s.name.toLowerCase().includes(search.toLowerCase()) : true,
    )
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));

  // Esc closes; letter keys snap to first matching station
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') { onClose(); return; }

      const letter = e.key.length === 1 && /[a-z]/i.test(e.key) ? e.key.toLowerCase() : null;
      if (!letter) return;

      const pool = filtered.filter((s) => {
        const stripped = s.name.replace(/^the\s+/i, '');
        return stripped.toLowerCase().startsWith(letter);
      });
      if (pool.length === 0) return;

      // Exclude current station so repeated keypresses always change
      const options = pool.length > 1
        ? pool.filter((s) => s.id !== currentStation?.id)
        : pool;
      const match = options[Math.floor(Math.random() * options.length)];

      onSelectStation(match);

      const el = gridRef.current?.querySelector<HTMLElement>(
        `[data-station-id="${match.id}"]`,
      );
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, filtered, onSelectStation]);

  // Scroll to active station when modal opens
  useEffect(() => {
    if (!currentStation) return;
    const t = setTimeout(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(
        `[data-station-id="${currentStation.id}"]`,
      );
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [currentStation]);

  return (
    <>
      <motion.div
        className={styles.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        className={styles.modal}
        initial={{ opacity: 0, y: '100%' }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      >
        {/* Header: search, filter, socials, close */}
        <div className={styles.header}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search stations"
          />
          <button
            className={`${styles.filterToggle} ${filterOpen ? styles.filterToggleActive : ''} ${filter ? styles.filterToggleFiltered : ''}`}
            onClick={() => setFilterOpen(o => !o)}
          >
            FILTER {filterOpen ? '▲' : '▼'}
          </button>
          <a href="https://buymeacoffee.com/luckybreaks" target="_blank" rel="noopener noreferrer"
            className={`${styles.socialBtn} ${styles.socialBtnCoffee}`}>
            SUPPORT
          </a>
          <a href="https://www.instagram.com/luckybreaks.xyz" target="_blank" rel="noopener noreferrer"
            className={`${styles.socialBtn} ${styles.socialBtnIg}`}>
            FOLLOW
          </a>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Expandable genre panel */}
        {filterOpen && (
          <div className={styles.filterPanel}>
            <button
              className={`${styles.pill} ${!filter ? styles.pillActive : ''}`}
              onClick={() => applyFilter(null)}
            >
              ALL
            </button>
            <button
              className={`${styles.pill} ${styles.pillSaved} ${filter === 'FAVOURITES' ? styles.pillFavActive : ''}`}
              onClick={() => applyFilter(filter === 'FAVOURITES' ? null : 'FAVOURITES')}
            >
              ♥ FAVS
            </button>
            {PAD_LABELS.map((label) => {
              const genre = PAD_GENRE_MAP[label];
              return (
                <button
                  key={label}
                  className={`${styles.pill} ${filter === genre ? styles.pillActive : ''}`}
                  onClick={() => applyFilter(genre === filter ? null : genre)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.grid} ref={gridRef}>
          {filtered.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isActive={currentStation?.id === station.id}
              isFavourite={favourites.has(station.id)}
              onSelect={() => onSelectStation(station)}
              onToggleFavourite={() => onToggleFavourite(station.id)}
            />
          ))}
        </div>
      </motion.div>
    </>
  );
}
