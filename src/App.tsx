import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAudioEngineContext } from './context/AudioContext';
import { PAD_GENRE_MAP, type PadLabel, stations } from './data/stations';
import { DisplayScreen } from './components/DisplayScreen/DisplayScreen';
import { TransportControls } from './components/TransportControls/TransportControls';
import { VibePads } from './components/VibePads/VibePads';
import { StationIndexModal } from './components/StationIndexModal/StationIndexModal';
import { useFavourites } from './hooks/useFavourites';
import { useDarkMode } from './hooks/useDarkMode';
import styles from './App.module.css';

const sortKey = (name: string) => {
  const stripped = name.replace(/^the\s+/i, '');
  return /^\d/.test(stripped) ? 'zzz_' + stripped.toLowerCase() : stripped.toLowerCase();
};

function App() {
  const [isIndexOpen, setIsIndexOpen] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [favsMode, setFavsMode] = useState(false);
  const engine = useAudioEngineContext();
  const { favourites, toggleFavourite } = useFavourites();
  const { dark, toggle: toggleDark } = useDarkMode();

  // A-Z sorted station list for linear navigation
  const sortedStations = useMemo(
    () => [...stations].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name))),
    [],
  );

  const handlePadClick = (label: PadLabel) => {
    const genre = PAD_GENRE_MAP[label];
    setShuffleMode(false);
    setFavsMode(false);
    engine.setActiveGenre(genre);
    engine.playNext(genre);
  };

  const handleFavsShuffle = () => {
    const favPool = stations.filter((s) => favourites.has(s.id) && s.id !== engine.currentStation?.id);
    const pool = favPool.length > 0 ? favPool : stations.filter((s) => favourites.has(s.id));
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setFavsMode(true);
    setShuffleMode(false);
    engine.playStation(pick);
  };

  const handleShuffle = useCallback(() => {
    setFavsMode(false);
    setShuffleMode((prev) => {
      if (!prev) {
        engine.setActiveGenre(null);
        engine.shuffle();
      }
      return !prev;
    });
  }, [engine]);

  const handleFwd = useCallback(() => {
    if (engine.activeGenre) {
      engine.playNext();
    } else if (shuffleMode) {
      engine.shuffle();
    } else {
      const idx = sortedStations.findIndex((s) => s.id === engine.currentStation?.id);
      const next = sortedStations[(idx + 1) % sortedStations.length];
      if (next) engine.playStation(next);
    }
  }, [engine, shuffleMode, sortedStations]);

  const handleRwd = useCallback(() => {
    if (engine.activeGenre) {
      engine.playPrev();
    } else if (shuffleMode) {
      engine.playPrev();
    } else {
      const idx = sortedStations.findIndex((s) => s.id === engine.currentStation?.id);
      const prev = sortedStations[(idx - 1 + sortedStations.length) % sortedStations.length];
      if (prev) engine.playStation(prev);
    }
  }, [engine, shuffleMode, sortedStations]);

  // Keep stable refs for use inside event listeners
  const handleFwdRef = useRef(handleFwd);
  const handleRwdRef = useRef(handleRwd);
  const togglePlayPauseRef = useRef(engine.togglePlayPause);
  const isIndexOpenRef = useRef(isIndexOpen);
  const sortedStationsRef = useRef(sortedStations);
  const engineRef = useRef(engine);
  handleFwdRef.current = handleFwd;
  handleRwdRef.current = handleRwd;
  togglePlayPauseRef.current = engine.togglePlayPause;
  isIndexOpenRef.current = isIndexOpen;
  sortedStationsRef.current = sortedStations;
  engineRef.current = engine;

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

  // Media Session API: iPhone lock screen / Control Centre controls
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
  }, [engine.currentStation]);

  // Register Media Session action handlers once (stable via refs)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    // Separate play/pause — iOS sends these as distinct actions
    navigator.mediaSession.setActionHandler('play', () => {
      const audio = engine.audioRef.current;
      if (!audio || !audio.src) return;
      audio.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      engine.audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      engine.audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => handleFwdRef.current());
    navigator.mediaSession.setActionHandler('previoustrack', () => handleRwdRef.current());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep mediaSession playback state in sync
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState =
      engine.status === 'playing' ? 'playing' :
      engine.status === 'loading' ? 'playing' : // show as playing while buffering
      'paused';
  }, [engine.status]);

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
              <span className={styles.logoSub}>serendipitous sampling</span>
            </div>
            <span className={styles.tagline}>Tune in. Chop up.</span>
          </div>

          {/* Row 2: Screen */}
          <div className={styles.screenBezel}>
            <DisplayScreen
              station={engine.currentStation}
              status={engine.status}
              dark={dark}
              onToggleDark={toggleDark}
            />
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
              onPlayPause={engine.togglePlayPause}
              onFwd={handleFwd}
              onRwd={handleRwd}
              isPlaying={engine.status === 'playing'}
              canRwd={!shuffleMode && !engine.activeGenre ? !!engine.currentStation : engine.historyIndex > 0}
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
            favourites={favourites}
            onToggleFavourite={toggleFavourite}
            onSelectStation={(s) => {
              engine.playStation(s);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
