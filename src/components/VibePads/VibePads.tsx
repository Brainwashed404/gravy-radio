import { type Genre, PAD_GENRE_MAP, PAD_LABELS, type PadLabel } from '../../data/stations';
import { VibePad } from './VibePad';
import styles from './VibePads.module.css';

interface VibePadsProps {
  activeGenre: Genre | null;
  onPadClick: (label: PadLabel) => void;
}

export function VibePads({ activeGenre, onPadClick }: VibePadsProps) {
  return (
    <div className={styles.grid}>
      {PAD_LABELS.map((label) => (
        <VibePad
          key={label}
          label={label}
          isActive={activeGenre === PAD_GENRE_MAP[label]}
          onClick={() => onPadClick(label)}
        />
      ))}
    </div>
  );
}
