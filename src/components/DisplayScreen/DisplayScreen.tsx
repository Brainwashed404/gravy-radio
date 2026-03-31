import { motion, AnimatePresence } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import styles from './DisplayScreen.module.css';

const WELCOME_MESSAGES = [
  'Radio for beatmakers',
  'Built for beatmakers',
  'Start digging',
  'It was all a stream',
  'Start your radio roulette',
  'Feed your sampler',
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
  const [scrollActive, setScrollActive] = useState(false);

  const showIdle  = status === 'idle' && !station;
  const showError = status === 'error';
  const showTicker = scrollActive && !!station && !showIdle && !showError;

  // Reset scroll off whenever station changes
  useEffect(() => {
    setScrollActive(false);
  }, [station?.id]);

  // Duration at ~180 px/s (2× speed) — accounts for 100vw gap between copies
  const tickerDuration = station
    ? (() => {
        const fontSize = Math.min(162, Math.max(52, window.innerHeight * 0.18));
        const desc = station.description.length > 80
          ? station.description.slice(0, 80)
          : station.description;
        const totalChars = station.name.length + 3 + desc.length; // +3 for " · "
        const textPixels = totalChars * fontSize * 0.62;
        const totalDist  = textPixels + window.innerWidth;
        return Math.max(4, Math.round(totalDist / 180));
      })()
    : 4;

  const tickerText = station
    ? `${station.name.toUpperCase()}  ·  ${station.description.toUpperCase()}`
    : '';

  return (
    <div className={styles.screen}>
      <button
        className={styles.darkToggle}
        onClick={onToggleDark}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {dark ? '☀' : '☾'}
      </button>
      <button
        className={`${styles.scrollToggle} ${scrollActive ? styles.scrollToggleActive : ''}`}
        onClick={() => setScrollActive(v => !v)}
        aria-label={scrollActive ? 'Stop scrolling' : 'Start scrolling'}
        aria-pressed={scrollActive}
      >
        ≫
      </button>
      <div className={styles.scanlines} />

      {/* ── Standard content layer (idle / error / static playing) ── */}
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

          {!showIdle && !showError && station && !showTicker && (
            <motion.div
              key={`static-${station.id}`}
              className={styles.playingState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className={styles.stationName}>{station.name}</div>
              <div className={styles.stationDesc}>
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Full-height ticker layer — absolute over the whole screen box ── */}
      <AnimatePresence>
        {showTicker && (
          <motion.div
            key={`ticker-${station!.id}`}
            className={styles.tickerBigLayer}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
          >
            <div
              className={styles.tickerTrack}
              style={{
                '--ticker-duration': `${tickerDuration}s`,
                animationPlayState: status === 'playing' ? 'running' : 'paused',
              } as React.CSSProperties}
            >
              <span className={styles.tickerBigItem}>{tickerText}</span>
              <span className={styles.tickerBigItem}>{tickerText}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
