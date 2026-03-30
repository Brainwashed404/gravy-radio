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
  favourites: Set<string>;
  onToggleFavourite: (id: string) => void;
}

export function StationIndexModal({
  onClose,
  stations,
  currentStation,
  onSelectStation,
  favourites,
  onToggleFavourite,
}: StationIndexModalProps) {
  const [filter, setFilter] = useState<FilterState>(null);
  const [search, setSearch] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  // Scroll to active station when modal opens
  useEffect(() => {
    if (!currentStation) return;
    // Small delay to let the list render fully
    const t = setTimeout(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(
        `[data-station-id="${currentStation.id}"]`,
      );
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [currentStation]);

  const sortKey = (name: string) => {
    const stripped = name.replace(/^the\s+/i, '');
    // Push names starting with digits to after Z
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
        <div className={styles.header}>
          <span className={styles.title}>MASTER STATION LIST</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Genre filter pills */}
        <div className={styles.filters}>
          <button
            className={`${styles.pill} ${!filter ? styles.pillActive : ''}`}
            onClick={() => setFilter(null)}
          >
            ALL
          </button>
          <button
            className={`${styles.pill} ${styles.pillSaved} ${filter === 'FAVOURITES' ? styles.pillFavActive : ''}`}
            onClick={() => setFilter(filter === 'FAVOURITES' ? null : 'FAVOURITES')}
          >
            ♥ FAVS
          </button>
          {PAD_LABELS.map((label) => {
            const genre = PAD_GENRE_MAP[label];
            return (
              <button
                key={label}
                className={`${styles.pill} ${filter === genre ? styles.pillActive : ''}`}
                onClick={() => setFilter(genre === filter ? null : genre)}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search stations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search stations"
          />
        </div>

        <div className={styles.count}>
          {filtered.length} STATION{filtered.length !== 1 ? 'S' : ''}
        </div>

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
