import { motion, AnimatePresence } from 'framer-motion';
import { useRef } from 'react';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import styles from './DisplayScreen.module.css';

const WELCOME_MESSAGES = [
  'Ready to find a lucky break?',
  'Do you feel lucky, punk?',
  'Stumble upon the perfect loop',
  'Let the shuffle decide',
  'Is it time to cook?',
  'Ready to flip?',
  'Ready to chop?',
  "Let's start digging",
  "Everyday we're shuffling",
  'It was all a stream',
  "Chop it like it's hot",
  'Ready for radio roulette?',
  'Let the scanning start',
  'Time to feed your sampler',
  'Chops rule everything around me',
  'Time to slice the signal',
];

interface DisplayScreenProps {
  station: Station | null;
  status: PlaybackStatus;
  dark: boolean;
  onToggleDark: () => void;
}

export function DisplayScreen({ station, status, dark, onToggleDark }: DisplayScreenProps) {
  const welcomeMsg = useRef(
    WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)]
  );
  const showIdle = status === 'idle' && !station;
  const showError = status === 'error';

  return (
    <div className={styles.screen}>
      <button
        className={styles.darkToggle}
        onClick={onToggleDark}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {dark ? '☀' : '☾'}
      </button>
      <div className={styles.scanlines} />
      <div className={styles.content}>
        <AnimatePresence mode="wait">
          {showIdle && (
            <motion.div
              key="idle"
              className={styles.idleState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <span className={styles.idleTitle}>{welcomeMsg.current.toUpperCase()}</span>
            </motion.div>
          )}

          {showError && (
            <motion.div
              key="error"
              className={styles.errorState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className={styles.errorLabel}>STREAM ERROR</span>
              {station && <span className={styles.errorStation}>{station.name}</span>}
            </motion.div>
          )}

          {!showIdle && !showError && station && (
            <motion.div
              key={station.id}
              className={styles.playingState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
            >
              <div className={styles.stationName}>{station.name}</div>
              {status === 'loading' ? (
                <motion.div
                  className={styles.loadingBar}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  ████████████ LOADING...
                </motion.div>
              ) : (
                <div className={styles.stationDesc}>
                  {station.description.length > 60
                    ? station.description.slice(0, 57) + '...'
                    : station.description}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
