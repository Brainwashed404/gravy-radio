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

const CTAS = [
  { lines: ['Follow @luckybreaks.xyz'], url: 'https://www.instagram.com/luckybreaks.xyz' },
  { lines: ['Value the vibe?', 'Click to support :)'], url: 'https://buymeacoffee.com/luckybreaks' },
];

interface DisplayScreenProps {
  station: Station | null;
  status: PlaybackStatus;
  screenMessage?: string | null;
}

export function DisplayScreen({ station, status, screenMessage }: DisplayScreenProps) {
  const welcomeMsg = useRef(
    WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)]
  );

  // 1-in-3 chance of showing a CTA on the idle screen — computed once on mount
  const [welcomeCta] = useState<{ lines: string[]; url: string } | null>(() =>
    Math.random() < 1 / 3 ? CTAS[Math.floor(Math.random() * CTAS.length)] : null
  );

  const [scrollActive, setScrollActive] = useState(false);

  // Post-30s promo sequence: 0 = CTA1, 1 = CTA2, -1 = done (locked to station name)
  const [promoIndex, setPromoIndex] = useState<number | null>(null);
  const hasStartedPromo = useRef<string | null>(null);

  // Reset promo when station changes
  useEffect(() => {
    setPromoIndex(null);
    hasStartedPromo.current = null;
  }, [station?.id]);

  // Start promo timer once station is playing, repeating every 2 minutes
  useEffect(() => {
    if (status !== 'playing' || !station) return;
    if (hasStartedPromo.current === station.id) return;
    hasStartedPromo.current = station.id;

    const allTimers: ReturnType<typeof setTimeout>[] = [];

    const runCycle = () => {
      allTimers.push(setTimeout(() => setPromoIndex(0), 15_000));
      allTimers.push(setTimeout(() => setPromoIndex(1), 25_000));
      allTimers.push(setTimeout(() => setPromoIndex(-1), 35_000));
    };

    runCycle();
    const interval = setInterval(runCycle, 80_000);

    return () => {
      allTimers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, [station?.id, status]);

  const showIdle  = status === 'idle' && !station;
  const showError = status === 'error';
  const showPromo  = !showIdle && !showError && !!station
    && promoIndex !== null && promoIndex >= 0;
  const showTicker = scrollActive && !!station && !showIdle && !showError && !showPromo;

  const tickerDuration = station
    ? (() => {
        const fontSize = Math.min(162, Math.max(52, window.innerHeight * 0.18));
        const desc = station.description.length > 80
          ? station.description.slice(0, 80)
          : station.description;
        const totalChars = station.name.length + 3 + desc.length;
        const textPixels = totalChars * fontSize * 0.62;
        return Math.max(4, Math.round(textPixels / 180));
      })()
    : 4;

  const tickerText = station
    ? `${station.name.toUpperCase()}\u00A0\u00A0-\u00A0\u00A0${station.description.toUpperCase()}\u00A0\u00A0-\u00A0\u00A0`
    : '';

  return (
    <div className={styles.screen}>
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
              {welcomeCta ? (
                <a
                  href={welcomeCta.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.idleCta}
                >
                  {welcomeCta.lines.map((l, i) => <span key={i} style={{display:'block'}}>{l.toUpperCase()}</span>)}
                </a>
              ) : (
                <span className={styles.idleTitle}>{welcomeMsg.current.toUpperCase()}</span>
              )}
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

          {showPromo && (
            <motion.div
              key={`promo-${promoIndex}`}
              className={styles.promoState}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.4 }}
            >
              <a
                href={CTAS[promoIndex!].url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.promoCta}
              >
                {CTAS[promoIndex!].lines.map((l, i) => <span key={i} style={{display:'block'}}>{l.toUpperCase()}</span>)}
              </a>
            </motion.div>
          )}

          {!showIdle && !showError && !showPromo && station && !showTicker && (
            <motion.div
              key={`static-${station.id}`}
              className={styles.playingState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div
                className={styles.stationName}
                onClick={() => setScrollActive(v => !v)}
                title="Tap to scroll"
              >
                {station.name}
              </div>
              <div className={styles.stationDesc}>
                {status === 'loading' ? (
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    ████████████ LOADING...
                  </motion.span>
                ) : (
                  station.description
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {screenMessage && (
          <motion.div
            key="screen-message"
            className={styles.screenMessageOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className={styles.screenMessageText}>{screenMessage.toUpperCase()}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTicker && (
          <motion.div
            key={`ticker-${station!.id}`}
            className={styles.tickerBigLayer}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
            onClick={() => setScrollActive(false)}
            title="Tap to stop scrolling"
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
