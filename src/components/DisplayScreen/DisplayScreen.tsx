import { motion, AnimatePresence } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import styles from './DisplayScreen.module.css';

const WELCOME_MESSAGES = [
  'Find a lucky break',
  'Do you feel lucky, punk?',
  'Stumble upon the perfect loop',
  'Let the shuffle decide',
  "It's time to cook",
  'Ready to flip?',
  'Ready to chop?',
  "Let's start digging",
  "Everyday we're shuffling",
  'It was all a stream',
  "Chop it like it's hot",
  'Start the radio roulette',
  'Feed your sampler',
  'Chops rule everything around me',
  'Slice some signals',
  'Infinite loops',
  'Record, loop, repeat',
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
  const [tickerActive, setTickerActive] = useState(false);
  const showIdle = status === 'idle' && !station;
  const showError = status === 'error';

  // Reset ticker each time a new station loads; activate after 5s
  useEffect(() => {
    setTickerActive(false);
    if (!station) return;
    const t = setTimeout(() => setTickerActive(true), 5000);
    return () => clearTimeout(t);
  }, [station?.id]);

  // Speed: ~80px/s — longer names scroll at same pace
  const tickerDuration = station
    ? Math.max(6, Math.round(station.name.length * 0.45))
    : 8;

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
              {tickerActive ? (
                <div className={styles.tickerWrapper}>
                  <div
                    className={styles.tickerTrack}
                    style={{ '--ticker-duration': `${tickerDuration}s` } as React.CSSProperties}
                  >
                    <span className={styles.tickerItem}>{station.name.toUpperCase()}</span>
                    <span className={styles.tickerItem}>{station.name.toUpperCase()}</span>
                  </div>
                </div>
              ) : (
                <div className={styles.stationName}>{station.name}</div>
              )}

              <motion.div
                className={styles.stationDesc}
                animate={{ opacity: tickerActive ? 0 : 1 }}
                transition={{ duration: 0.8 }}
              >
                {status === 'loading' ? (
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    ████████████ LOADING...
                  </motion.span>
                ) : (
                  station.description.length > 60
                    ? station.description.slice(0, 57) + '...'
                    : station.description
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
