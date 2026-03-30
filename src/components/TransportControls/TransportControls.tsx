import { motion } from 'framer-motion';
import styles from './TransportControls.module.css';

interface TransportControlsProps {
  onFavs: () => void;
  canFavs: boolean;
  onIndex: () => void;
  onShuffle: () => void;
  onPlayPause: () => void;
  onFwd: () => void;
  onRwd: () => void;
  isPlaying: boolean;
  canRwd: boolean;
}

const btn = {
  whileTap: { scale: 0.91, y: 2 },
  transition: { type: 'spring' as const, stiffness: 600, damping: 20 },
};

export function TransportControls({
  onFavs,
  canFavs,
  onIndex,
  onShuffle,
  onPlayPause,
  onFwd,
  onRwd,
  isPlaying,
  canRwd,
}: TransportControlsProps) {
  return (
    <div className={styles.controls}>
      <motion.button
        className={`${styles.btn} ${styles.btnFavs} ${!canFavs ? styles.btnFavsDisabled : ''}`}
        onClick={canFavs ? onFavs : undefined}
        {...btn}
        aria-label="Shuffle Favourites"
        aria-disabled={!canFavs}
      >
        FAVS
      </motion.button>

      <motion.button
        className={`${styles.btn} ${styles.btnIndex}`}
        onClick={onIndex}
        {...btn}
        aria-label="Station Index"
      >
        INDEX
      </motion.button>

      <motion.button
        className={`${styles.btn} ${styles.btnGrey}`}
        onClick={onShuffle}
        {...btn}
        aria-label="Shuffle"
      >
        SHUFFLE
      </motion.button>

      <motion.button
        className={`${styles.btn} ${styles.btnPlay}`}
        onClick={onPlayPause}
        {...btn}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? 'PAUSE' : 'PLAY'}
      </motion.button>

      <motion.button
        className={`${styles.btn} ${styles.btnGrey} ${!canRwd ? styles.btnDisabled : ''}`}
        onClick={canRwd ? onRwd : undefined}
        {...btn}
        aria-label="Rewind"
        aria-disabled={!canRwd}
      >
        RWD
      </motion.button>

      <motion.button
        className={`${styles.btn} ${styles.btnGrey}`}
        onClick={onFwd}
        {...btn}
        aria-label="Forward"
      >
        FWD
      </motion.button>
    </div>
  );
}
