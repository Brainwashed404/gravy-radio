import { useState } from 'react';
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
  activeGenre,
  favourites,
  onToggleFavourite,
}: StationIndexModalProps) {
  const [filter, setFilter] = useState<FilterState>(null);
  const [search, setSearch] = useState('');

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
    );

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
            className={`${styles.pill} ${filter === 'FAVOURITES' ? styles.pillFavActive : ''}`}
            onClick={() => setFilter(filter === 'FAVOURITES' ? null : 'FAVOURITES')}
          >
            ♥ SAVED
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

        <div className={styles.grid}>
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
