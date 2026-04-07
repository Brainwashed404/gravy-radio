import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAudioEngineContext } from './context/AudioContext';
import { PAD_GENRE_MAP, type PadLabel, stations } from './data/stations';
import { DisplayScreen } from './components/DisplayScreen/DisplayScreen';
import { TransportControls } from './components/TransportControls/TransportControls';
import { VibePads } from './components/VibePads/VibePads';
import { StationIndexModal } from './components/StationIndexModal/StationIndexModal';
import { InfoModal } from './components/InfoModal/InfoModal';
import { useFavourites } from './hooks/useFavourites';
import { useDarkMode } from './hooks/useDarkMode';
import styles from './App.module.css';

const sortKey = (name: string) => {
  const stripped = name.replace(/^the\s+/i, '');
  return /^\d/.test(stripped) ? 'zzz_' + stripped.toLowerCase() : stripped.toLowerCase();
};

function App() {
  const [isIndexOpen, setIsIndexOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [favsMode, setFavsMode] = useState(false);
  const [screenMessage, setScreenMessage] = useState<string | null>(null);
  const engine = useAudioEngineContext();
  const { favourites, toggleFavourite, replaceFavourites } = useFavourites();
  const { dark, toggle: toggleDark } = useDarkMode();

  // Auto-clear screenMessage after 3 seconds
  useEffect(() => {
    if (!screenMessage) return;
    const t = setTimeout(() => setScreenMessage(null), 3000);
    return () => clearTimeout(t);
  }, [screenMessage]);

  // A-Z sorted station list for linear navigation
  const sortedStations = useMemo(
    () => [...stations].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name))),
    [],
  );

  const handlePadClick = (label: PadLabel) => {
    const genre = PAD_GENRE_MAP[label];
    setShuffleMode(false);

    if (favsMode) {
      // In FAVS mode: only play favourited stations within this genre
      const allFavsInGenre = stations.filter((s) => favourites.has(s.id) && s.genre === genre);
      if (allFavsInGenre.length === 0) {
        setScreenMessage('Fav a station in this genre');
        return;
      }
      const candidates = allFavsInGenre.filter((s) => s.id !== engine.currentStation?.id);
      const pool = candidates.length > 0 ? candidates : allFavsInGenre;
      engine.setActiveGenre(genre);
      engine.playStation(pool[Math.floor(Math.random() * pool.length)]);
      return;
    }

    setFavsMode(false);
    engine.setActiveGenre(genre);
    engine.playNext(genre);
  };

  const handleFavsShuffle = () => {
    if (favsMode) { setFavsMode(false); return; }
    // Enter FAVS mode — stay on current station if it's already a fav, else jump to first A-Z fav
    const sortedFavs = [...stations]
      .filter((s) => favourites.has(s.id))
      .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
    if (sortedFavs.length === 0) return;
    setFavsMode(true);
    if (!favourites.has(engine.currentStation?.id ?? '')) {
      engine.playStation(sortedFavs[0]);
    }
  };

  const handleShuffle = useCallback(() => {
    // If a genre pad is active, this button acts as ALL — clear genre only, keep FAVS intact
    if (engineRef.current.activeGenre) {
      engineRef.current.setActiveGenre(null);
      setShuffleMode(false);
      return;
    }
    // Normal SHUFFLE toggle — works within FAVS if FAVS is active
    setShuffleMode((prev) => {
      const next = !prev;
      if (next) {
        engine.setActiveGenre(null);
        if (favsRef.current) {
          const favPool = stations.filter((s) => favouritesRef.current.has(s.id) && s.id !== engineRef.current.currentStation?.id);
          const pool = favPool.length > 0 ? favPool : stations.filter((s) => favouritesRef.current.has(s.id));
          if (pool.length > 0) {
            engineRef.current.playStation(pool[Math.floor(Math.random() * pool.length)]);
            return next;
          }
        }
        engine.shuffle();
      }
      return next;
    });
  }, [engine]);

  const handleFwd = useCallback(() => {
    if (favsMode) {
      const sortedFavs = [...stations]
        .filter((s) => favourites.has(s.id))
        .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
      if (sortedFavs.length === 0) return;
      const pool = engine.activeGenre
        ? sortedFavs.filter((s) => s.genre === engine.activeGenre)
        : sortedFavs;
      if (pool.length === 0) { setScreenMessage('Fav a station in this genre'); return; }
      if (shuffleMode) {
        const candidates = pool.filter((s) => s.id !== engine.currentStation?.id);
        engine.playStation((candidates.length > 0 ? candidates : pool)[Math.floor(Math.random() * (candidates.length > 0 ? candidates : pool).length)]);
      } else {
        const idx = pool.findIndex((s) => s.id === engine.currentStation?.id);
        engine.playStation(pool[(idx + 1) % pool.length]);
      }
      return;
    }
    if (engine.activeGenre) {
      engine.playNext();
    } else if (shuffleMode) {
      engine.shuffle();
    } else {
      const idx = sortedStations.findIndex((s) => s.id === engine.currentStation?.id);
      const next = sortedStations[(idx + 1) % sortedStations.length];
      if (next) engine.playStation(next);
    }
  }, [engine, shuffleMode, sortedStations, favsMode, favourites]);

  const handleRwd = useCallback(() => {
    if (favsMode) {
      const sortedFavs = [...stations]
        .filter((s) => favourites.has(s.id))
        .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
      if (sortedFavs.length === 0) return;
      const pool = engine.activeGenre
        ? sortedFavs.filter((s) => s.genre === engine.activeGenre)
        : sortedFavs;
      if (pool.length === 0) return;
      const idx = pool.findIndex((s) => s.id === engine.currentStation?.id);
      engine.playStation(pool[(idx - 1 + pool.length) % pool.length]);
      return;
    }
    if (engine.activeGenre || shuffleMode) {
      engine.playPrev();
    } else {
      const idx = sortedStations.findIndex((s) => s.id === engine.currentStation?.id);
      const prev = sortedStations[(idx - 1 + sortedStations.length) % sortedStations.length];
      if (prev) engine.playStation(prev);
    }
  }, [engine, shuffleMode, sortedStations, favsMode, favourites]);

  // Keep stable refs for use inside event listeners
  const handleFwdRef = useRef(handleFwd);
  const handleRwdRef = useRef(handleRwd);
  const togglePlayPauseRef = useRef(engine.togglePlayPause);
  const isIndexOpenRef = useRef(isIndexOpen);
  const sortedStationsRef = useRef(sortedStations);
  const engineRef = useRef(engine);
  const favsRef = useRef(favsMode);
  const favouritesRef = useRef(favourites);
  handleFwdRef.current = handleFwd;
  handleRwdRef.current = handleRwd;
  togglePlayPauseRef.current = engine.togglePlayPause;
  isIndexOpenRef.current = isIndexOpen;
  sortedStationsRef.current = sortedStations;
  engineRef.current = engine;
  favsRef.current = favsMode;
  favouritesRef.current = favourites;

  // Keyboard controls (Space / Arrows / media keys / A-Z station jump)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' || e.code === 'MediaPlayPause') {
        e.preventDefault();
        togglePlayPauseRef.current();
      } else if (e.code === 'ArrowRight' || e.code === 'MediaTrackNext') {
        e.preventDefault();
        handleFwdRef.current();
      } else if (e.code === 'ArrowLeft' || e.code === 'MediaTrackPrevious') {
        e.preventDefault();
        handleRwdRef.current();
      } else if (e.code === 'Escape' && !isIndexOpenRef.current) {
        e.preventDefault();
        engineRef.current.setActiveGenre(null);
        setShuffleMode(false);
        setFavsMode(false);
      } else if (
        !isIndexOpenRef.current &&
        e.key.length === 1 &&
        /[a-z]/i.test(e.key) &&
        !e.metaKey && !e.ctrlKey && !e.altKey
      ) {
        const letter = e.key.toLowerCase();
        const pool = sortedStationsRef.current.filter((s) => {
          const stripped = s.name.replace(/^the\s+/i, '');
          return stripped.toLowerCase().startsWith(letter);
        });
        if (pool.length === 0) return;
        // Exclude current station so repeated keypresses always change
        const options = pool.length > 1
          ? pool.filter((s) => s.id !== engineRef.current.currentStation?.id)
          : pool;
        const pick = options[Math.floor(Math.random() * options.length)];
        engineRef.current.playStation(pick);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []); // stable — uses refs

  // Media Session API — update metadata + re-register handlers on every station change.
  // iOS drops action handlers between tracks so they must be re-set each time.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: engine.currentStation?.name ?? 'Lucky Breaks',
      artist: engine.currentStation?.description ?? 'Serendipitous sampling',
      album: 'Lucky Breaks Radio',
      artwork: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });

    // 'play' uses togglePlayPause which reloads the stream — required for live radio
    navigator.mediaSession.setActionHandler('play',  () => togglePlayPauseRef.current());
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPauseRef.current());
    navigator.mediaSession.setActionHandler('stop',  () => engineRef.current.audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('nexttrack',     () => handleFwdRef.current());
    navigator.mediaSession.setActionHandler('previoustrack', () => handleRwdRef.current());

    // Disable seek controls — without this iOS shows ±10s buttons instead of ⏮⏭
    try { navigator.mediaSession.setActionHandler('seekforward',  null); } catch {}
    try { navigator.mediaSession.setActionHandler('seekbackward', null); } catch {}
    try { navigator.mediaSession.setActionHandler('seekto',       null); } catch {}
  }, [engine.currentStation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep lock screen play/pause indicator in sync with actual audio state
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState =
      engine.status === 'playing' ? 'playing' :
      engine.status === 'loading' ? 'playing' :
      'paused';
  }, [engine.status]);

  // Clear the bogus duration/progress bar that ICY streams inject.
  // Some streams report a Content-Length header the browser reads as duration
  // (e.g. 37 hours). Calling setPositionState() with no args removes it.
  useEffect(() => {
    const audio = engine.audioRef.current;
    if (!audio) return;
    const clearDuration = () => {
      if (!('mediaSession' in navigator)) return;
      try { (navigator.mediaSession as MediaSession & { setPositionState?: () => void }).setPositionState?.(); } catch {}
    };
    audio.addEventListener('durationchange', clearDuration);
    // Also clear immediately when station changes
    clearDuration();
    return () => audio.removeEventListener('durationchange', clearDuration);
  }, [engine.currentStation]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={styles.mpcBody}>
        <div className={styles.mpcCenter}>

          {/* Row 1: Logo + Signature */}
          <div className={styles.logoBar}>
            <div className={styles.logo}>
              <a
                href="https://www.instagram.com/luckybreaks.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.logoGravy}
              >
                LUCKY BREAKS
              </a>
              <span className={styles.logoSub}>radio shuffler</span>
            </div>
            <span className={styles.tagline}>Tune in. Chop up.</span>
          </div>

          {/* Row 2: Screen + sidebar buttons */}
          <div className={styles.screenRow}>
            <div className={styles.screenBezel}>
              <DisplayScreen
                station={engine.currentStation}
                status={engine.status}
                screenMessage={screenMessage}
              />
            </div>
            <div className={styles.screenButtons}>
              {/* Info — top */}
              <motion.button
                className={styles.screenBtn}
                onClick={() => setIsInfoOpen(true)}
                aria-label="About / Instructions"
                whileTap={{ scale: 0.91, y: 2 }}
                transition={{ type: 'spring', stiffness: 600, damping: 20 }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
              </motion.button>
              {/* Heart — middle */}
              <motion.button
                className={styles.screenBtn}
                onClick={() => { if (engine.currentStation) toggleFavourite(engine.currentStation.id); }}
                aria-label={favourites.has(engine.currentStation?.id ?? '') ? 'Remove from favourites' : 'Add to favourites'}
                disabled={!engine.currentStation}
                whileTap={{ scale: 0.91, y: 2 }}
                transition={{ type: 'spring', stiffness: 600, damping: 20 }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                  <path
                    className={favourites.has(engine.currentStation?.id ?? '') ? styles.screenBtnHeartActive : styles.screenBtnHeartInactive}
                    d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                    strokeWidth="2"
                  />
                </svg>
              </motion.button>
              {/* Dark/light toggle — bottom */}
              <motion.button
                className={styles.screenBtn}
                onClick={toggleDark}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                whileTap={{ scale: 0.91, y: 2 }}
                transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                style={{ overflow: 'hidden' }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {dark ? (
                    <motion.span
                      key="sun"
                      initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: 30, scale: 0.7 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                      </svg>
                    </motion.span>
                  ) : (
                    <motion.span
                      key="moon"
                      initial={{ opacity: 0, rotate: 30, scale: 0.7 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: -30, scale: 0.7 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 6 6 0 0 0 21 12.79z"/>
                      </svg>
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </div>

          {/* Row 3: Transport controls */}
          <div className={styles.transportRow}>
            <TransportControls
              onFavs={handleFavsShuffle}
              canFavs={favourites.size > 0}
              favsActive={favsMode}
              onIndex={() => setIsIndexOpen(true)}
              onShuffle={handleShuffle}
              shuffleActive={shuffleMode}
              showAllButton={!!engine.activeGenre}
              onPlayPause={engine.togglePlayPause}
              onFwd={handleFwd}
              onRwd={handleRwd}
              isPlaying={engine.status === 'playing'}
              canRwd={engine.activeGenre || shuffleMode ? engine.historyIndex > 0 : !!engine.currentStation}
            />
          </div>

          {/* Row 4: Pad panel */}
          <div className={styles.padPanel}>
            <VibePads
              activeGenre={engine.activeGenre}
              onPadClick={handlePadClick}
            />
          </div>

        </div>
      </div>

      {/* Station Index Modal */}
      <AnimatePresence>
        {isIndexOpen && (
          <StationIndexModal
            isOpen={isIndexOpen}
            onClose={() => setIsIndexOpen(false)}
            stations={stations}
            currentStation={engine.currentStation}
            activeGenre={engine.activeGenre}
            favsMode={favsMode}
            favourites={favourites}
            onToggleFavourite={toggleFavourite}
            onSelectStation={(s) => {
              engine.playStation(s);
            }}
            onFilterChange={(f) => {
              if (f === 'FAVOURITES') {
                setFavsMode(true);
                engine.setActiveGenre(null);
              } else {
                setFavsMode(false);
                engine.setActiveGenre(f as import('./data/stations').Genre | null);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Info Modal */}
      <AnimatePresence>
        {isInfoOpen && (
          <InfoModal
            onClose={() => setIsInfoOpen(false)}
            favourites={favourites}
            onLoadFavs={replaceFavourites}
          />
        )}
      </AnimatePresence>

    </>
  );
}

export default App;
