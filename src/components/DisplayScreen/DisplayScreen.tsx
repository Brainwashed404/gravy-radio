import { motion, AnimatePresence } from 'framer-motion';
import React, { useRef, useState, useEffect } from 'react';
import { type Station } from '../../data/stations';
import { type PlaybackStatus } from '../../hooks/useAudioEngine';
import { GravityVisualiser } from '../GravityVisualiser/GravityVisualiser';
import styles from './DisplayScreen.module.css';

type ScreenMode = 'static' | 'ticker' | 'viz';

// static → viz → ticker → viz → static (repeat)
const CYCLE: ScreenMode[] = ['static', 'viz', 'ticker', 'viz'];

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
  { lines: ['Value the app?', 'Click to support us :)'], url: 'https://buymeacoffee.com/luckybreaks' },
];

interface DisplayScreenProps {
  station: Station | null;
  status: PlaybackStatus;
  screenMessage?: string | null;
  /** A visualiser mode request from outside, e.g. the APC mini. Forces the screen
   *  into viz mode if it isn't already, then forwards the mode to GravityVisualiser. */
  vizRequest?: { key: string; token: number } | null;
}

export function DisplayScreen({ station, status, screenMessage, vizRequest }: DisplayScreenProps) {
  const welcomeMsg = useRef(
    WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)]
  );

  // 1-in-3 chance of showing a CTA on the idle screen — computed once on mount
  const [welcomeCta] = useState<{ lines: string[]; url: string } | null>(() =>
    Math.random() < 1 / 3 ? CTAS[Math.floor(Math.random() * CTAS.length)] : null
  );

  // Screen persists across station changes — only manual taps advance the cycle
  const [cycleStep, setCycleStep] = useState(0);
  const screenMode = CYCLE[cycleStep]!;
  const cycleScreenMode = () => setCycleStep(s => (s + 1) % 4);

  // A vizRequest can arrive while the screen is showing static or ticker, where
  // GravityVisualiser is not even mounted. Jump the cycle to viz so the mode change
  // actually lands somewhere, instead of silently updating an unmounted component.
  // Guarded by token so this only fires once per request: vizRequest stays set
  // forever after the first pad press, and without the guard this would refire on
  // every later screenMode change and permanently pin the screen to viz, blocking
  // the user's own tap-to-cycle.
  const forcedVizTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!vizRequest || forcedVizTokenRef.current === vizRequest.token) return;
    forcedVizTokenRef.current = vizRequest.token;
    if (screenMode !== 'viz') setCycleStep(1);
  }, [vizRequest, screenMode]);

  // Promo sequence — fires once per session after 60s of continuous listening
  const [promoIndex, setPromoIndex] = useState<number | null>(null);
  const hasShownPromo = useRef(false);

  // Clear displayed CTA when station changes, but don't reset the session flag
  useEffect(() => {
    setPromoIndex(null);
  }, [station?.id]);

  // Start promo timer once playing — only if not already shown this session
  useEffect(() => {
    if (status !== 'playing' || !station) return;
    if (hasShownPromo.current) return;

    const t1 = setTimeout(() => { hasShownPromo.current = true; setPromoIndex(0); }, 60_000);
    const t2 = setTimeout(() => setPromoIndex(1), 75_000);
    const t3 = setTimeout(() => setPromoIndex(-1), 90_000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [station?.id, status]);

  // Hint: show once per session when the first station loads on static screen.
  // Hides permanently when the user taps and cycles away from static mode.
  const hintShownRef = useRef(false);
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    if (screenMode !== 'static') {
      setHintVisible(false);
      return;
    }
    if (!station || hintShownRef.current) return;
    hintShownRef.current = true;
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), 10_000);
    return () => clearTimeout(t);
  }, [station?.id, screenMode]);

  const showIdle  = status === 'idle' && !station;
  const showError = status === 'error';
  const showPromo  = !showIdle && !showError && !!station
    && promoIndex !== null && promoIndex >= 0;
  const showTicker = screenMode === 'ticker' && !!station && !showIdle && !showError && !showPromo;
  const showViz    = screenMode === 'viz'    && !!station && !showIdle && !showError;

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

          {!showIdle && !showError && !showPromo && station && screenMode === 'static' && (
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
                onClick={cycleScreenMode}
                title="Tap to visualise"
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
            onClick={cycleScreenMode}
            title="Tap for station name"
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
      <AnimatePresence>
        {showViz && (
          <motion.div
            key="viz"
            style={{ position: 'absolute', inset: 0, zIndex: 5 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 2.5, ease: 'easeInOut' } }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          >
            <GravityVisualiser
              onClose={cycleScreenMode}
              genre={station?.genre}
              stationName={station?.name}
              modeOverride={vizRequest}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hintVisible && (
          <motion.button
            key="display-hint"
            className={styles.displayHint}
            onClick={cycleScreenMode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            whileTap={{ scale: 0.88, opacity: 0.6 }}
            aria-label="Tap to change display mode"
          >
            <svg className={styles.hintIcon} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <circle cx="10" cy="10" r="3.5" />
              <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className={styles.hintLabel}>TAP TO CHANGE DISPLAY</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
