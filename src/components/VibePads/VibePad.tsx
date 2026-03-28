import { motion } from 'framer-motion';
import { type PadLabel } from '../../data/stations';
import styles from './VibePads.module.css';

interface VibePadProps {
  label: PadLabel;
  isActive: boolean;
  onClick: () => void;
}

export function VibePad({ label, isActive, onClick }: VibePadProps) {
  return (
    <div className={styles.padWrapper}>
      <span className={styles.padLabel}>{label}</span>
      <motion.button
        className={`${styles.pad} ${isActive ? styles.padActive : ''}`}
        onClick={onClick}
        whileTap={{ scale: 0.93 }}
        aria-pressed={isActive}
        aria-label={label}
      />
    </div>
  );
}
