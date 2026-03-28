import { useState } from 'react';
import { motion } from 'framer-motion';
import { type Genre, type Station, PAD_LABELS, PAD_GENRE_MAP } from '../../data/stations';
import { StationCard } from './StationCard';
import styles from './StationIndexModal.module.css';

interface StationIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  stations: Station[];
  currentStation: Station | null;
  onSelectStation: (station: Station) => void;
  activeGenre: Genre | null;
}

export function StationIndexModal({
  onClose,
  stations,
  currentStation,
  onSelectStation,
  activeGenre,
}: StationIndexModalProps) {
  const [filter, setFilter] = useState<Genre | null>(activeGenre);

  const filtered = filter ? stations.filter((s) => s.genre === filter) : stations;

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

        <div className={styles.count}>
          {filtered.length} STATION{filtered.length !== 1 ? 'S' : ''}
        </div>

        <div className={styles.grid}>
          {filtered.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isActive={currentStation?.id === station.id}
              onSelect={() => onSelectStation(station)}
            />
          ))}
        </div>
      </motion.div>
    </>
  );
}
