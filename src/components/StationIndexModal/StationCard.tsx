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
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      aria-pressed={isActive}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{station.name}</span>
        <div className={styles.cardActions}>
          {isActive && <AudioVisualizer isActive barCount={4} />}
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
            {isFavourite ? '♥' : '♡'}
          </button>
        </div>
      </div>
    </div>
  );
}
