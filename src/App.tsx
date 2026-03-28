import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAudioEngineContext } from './context/AudioContext';
import { PAD_GENRE_MAP, type PadLabel, stations } from './data/stations';
import { DisplayScreen } from './components/DisplayScreen/DisplayScreen';
import { TransportControls } from './components/TransportControls/TransportControls';
import { VibePads } from './components/VibePads/VibePads';
import { StationIndexModal } from './components/StationIndexModal/StationIndexModal';
import styles from './App.module.css';

function App() {
  const [isIndexOpen, setIsIndexOpen] = useState(false);
  const engine = useAudioEngineContext();

  const handlePadClick = (label: PadLabel) => {
    const genre = PAD_GENRE_MAP[label];
    engine.setActiveGenre(genre);
    engine.playNext(genre);
  };

  return (
    <>
      <div className={styles.mpcBody}>
        <div className={styles.mpcCenter}>
          {/* Row 1: Screen — full width */}
          <div className={styles.screenBezel}>
            <DisplayScreen
              station={engine.currentStation}
              status={engine.status}
            />
          </div>

          {/* Row 2: Logo | Transport | Signature */}
          <div className={styles.controlsRow}>
            <div className={styles.logo}>
              <span className={styles.logoGravy}>GRAVY</span>
              <span className={styles.logoSub}>unprofessional</span>
            </div>

            <TransportControls
              onIndex={() => setIsIndexOpen(true)}
              onShuffle={engine.shuffle}
              onPlayPause={engine.togglePlayPause}
              onFwd={() => engine.playNext()}
              onRwd={engine.playPrev}
              isPlaying={engine.status === 'playing'}
              canRwd={engine.historyIndex > 0}
            />

            <div className={styles.signature}>
              <span className={styles.sigName}>Tim Noakes</span>
              <span className={styles.sigUrl}>WWW.RELAYRAD.IO</span>
            </div>
          </div>

          {/* Row 3: Vibe selector label */}
          <div className={styles.vibeSelectorLabel}>VIBE SELECTOR</div>

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
            onSelectStation={(s) => {
              engine.playStation(s);
              setIsIndexOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
