import { type Station } from '../../data/stations';
import { AudioVisualizer } from '../AudioVisualizer/AudioVisualizer';
import styles from './StationIndexModal.module.css';

interface StationCardProps {
  station: Station;
  isActive: boolean;
  onSelect: () => void;
}

export function StationCard({ station, isActive, onSelect }: StationCardProps) {
  return (
    <button
      className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
      onClick={onSelect}
      aria-pressed={isActive}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{station.name}</span>
        {isActive && <AudioVisualizer isActive barCount={4} />}
      </div>
      <p className={styles.cardDesc}>{station.description}</p>
      <div className={styles.cardBottom}>
        <span className={styles.cardGenre}>{station.genre}</span>
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
      </div>
    </button>
  );
}
