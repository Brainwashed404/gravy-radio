import { type Station } from '../../data/stations';
import { AudioVisualizer } from '../AudioVisualizer/AudioVisualizer';
import styles from './StationIndexModal.module.css';

interface StationCardProps {
  station: Station;
  isActive: boolean;
  isFavourite: boolean;
  onSelect: () => void;
  onToggleFavourite: () => void;
}

export function StationCard({ station, isActive, isFavourite, onSelect, onToggleFavourite }: StationCardProps) {
  return (
    <div
      className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
      data-station-id={station.id}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      aria-pressed={isActive}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{station.name}</span>
        <div className={styles.cardActions}>
          {isActive && <AudioVisualizer isActive barCount={4} onActiveCard={isActive} />}
          <a
            href={station.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cardLink}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Visit ${station.name} website`}
          >
            ↗
          </a>
          <button
            className={`${styles.favBtn} ${isFavourite ? styles.favBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleFavourite(); }}
            aria-label={isFavourite ? 'Remove from saved' : 'Save station'}
            aria-pressed={isFavourite}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                fill={isFavourite ? 'var(--color-orange)' : 'none'}
                stroke={isFavourite ? 'var(--color-orange)' : '#8a9099'}
                strokeWidth="2"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
