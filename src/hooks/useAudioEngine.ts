import { useCallback, useEffect, useRef, useState } from 'react';
import { type Genre, type Station, getStationsByGenre, stations } from '../data/stations';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'error';

interface AudioEngineState {
  currentStation: Station | null;
  activeGenre: Genre | null;
  status: PlaybackStatus;
  sessionHistory: Station[];
  historyIndex: number;
}

export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!audioRef.current) {
    const a = new Audio();
    a.preload = 'none';
    (a as HTMLAudioElement & { playsInline: boolean }).playsInline = true; // required for iOS lock-screen controls
    a.style.display = 'none';
    audioRef.current = a;
  }

  // Keep a ref so callbacks can read current state without stale closures
  const stateRef = useRef<AudioEngineState>({
    currentStation: null,
    activeGenre: null,
    status: 'idle',
    sessionHistory: [],
    historyIndex: -1,
  });

  // Track which station we most recently requested — guards against stale 'playing' events
  const expectedUrlRef = useRef<string>('');

  const [state, setState] = useState<AudioEngineState>(stateRef.current);
  stateRef.current = state;

  useEffect(() => {
    const audio = audioRef.current!;

    // Attach to DOM — iOS Media Session requires the element to be in the document
    document.body.appendChild(audio);

    const handlePlaying = () => {
      if (audio.src !== expectedUrlRef.current) return;
      setState((s) => ({ ...s, status: 'playing' }));
    };

    // Sync state when iOS interrupts playback (calls, Siri, etc.)
    const handlePause = () => {
      if (audio.src !== expectedUrlRef.current) return;
      setState((s) => (s.status === 'playing' ? { ...s, status: 'idle' } : s));
    };

    const handleError = () =>
      setState((s) => ({ ...s, status: 'error' }));

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.pause();
      if (document.body.contains(audio)) document.body.removeChild(audio);
    };
  }, []);

  // Internal: load and play a station, update history
  const _loadStation = useCallback(
    (station: Station, prevHistory: Station[], prevHistoryIndex: number, newActiveGenre: Genre | null | undefined, clearGenre?: boolean) => {
      const audio = audioRef.current!;

      const newHistory = prevHistory.slice(0, prevHistoryIndex + 1);
      newHistory.push(station);

      expectedUrlRef.current = station.streamUrl;
      audio.pause();
      audio.src = station.streamUrl;
      audio.load();
      const p = audio.play();
      if (p !== undefined) {
        p.catch((err: Error) => {
          if (err.name === 'AbortError') return;
          setState((s) => ({ ...s, status: 'error' }));
        });
      }

      setState((prev) => ({
        ...prev,
        currentStation: station,
        activeGenre: clearGenre ? null : (newActiveGenre !== undefined ? newActiveGenre : prev.activeGenre),
        status: 'loading',
        sessionHistory: newHistory,
        historyIndex: newHistory.length - 1,
      }));
    },
    [],
  );

  const playStation = useCallback(
    (station: Station) => {
      const prev = stateRef.current;
      _loadStation(station, prev.sessionHistory, prev.historyIndex, undefined);
    },
    [_loadStation],
  );

  const setActiveGenre = useCallback((genre: Genre | null) => {
    setState((s) => ({ ...s, activeGenre: genre }));
  }, []);

  const playNext = useCallback(
    (genre?: Genre) => {
      const prev = stateRef.current;
      const targetGenre = genre ?? prev.activeGenre ?? null;
      const pool = targetGenre ? getStationsByGenre(targetGenre) : stations;
      const candidates = pool.filter((s: Station) => s.id !== prev.currentStation?.id);
      const pick =
        (candidates.length > 0 ? candidates : pool)[
          Math.floor(Math.random() * (candidates.length > 0 ? candidates : pool).length)
        ];
      if (!pick) return;
      _loadStation(pick, prev.sessionHistory, prev.historyIndex, undefined);
    },
    [_loadStation],
  );

  const playPrev = useCallback(() => {
    const prev = stateRef.current;
    if (prev.historyIndex <= 0) return;
    const newIndex = prev.historyIndex - 1;
    const station = prev.sessionHistory[newIndex];
    if (!station) return;

    const audio = audioRef.current!;
    expectedUrlRef.current = station.streamUrl;
    audio.pause();
    audio.src = station.streamUrl;
    audio.load();
    const p = audio.play();
    if (p !== undefined) {
      p.catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState((s) => ({ ...s, status: 'error' }));
      });
    }

    setState((s) => ({
      ...s,
      currentStation: station,
      status: 'loading',
      historyIndex: newIndex,
    }));
  }, []);

  const shuffle = useCallback(() => {
    const prev = stateRef.current;
    const candidates = stations.filter((s) => s.id !== prev.currentStation?.id);
    const pool = candidates.length > 0 ? candidates : stations;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) return;
    _loadStation(pick, prev.sessionHistory, prev.historyIndex, null, true);
  }, [_loadStation]);

  const togglePlayPause = useCallback(() => {
    const prev = stateRef.current;
    if (prev.status === 'playing') {
      audioRef.current!.pause();
      setState((s) => ({ ...s, status: 'idle' }));
      return;
    }
    if (prev.currentStation) {
      // Live streams drop their HTTP connection on pause — reload the src
      // before calling play() to re-establish the connection reliably
      const audio = audioRef.current!;
      expectedUrlRef.current = prev.currentStation.streamUrl;
      audio.src = prev.currentStation.streamUrl;
      audio.load();
      const p = audio.play();
      if (p !== undefined) {
        p.catch((err: Error) => {
          if (err.name === 'AbortError') return;
          setState((s) => ({ ...s, status: 'error' }));
        });
      }
      setState((s) => ({ ...s, status: 'loading' }));
      return;
    }
    // Nothing loaded yet — trigger a global shuffle
    setTimeout(() => shuffle(), 0);
  }, [shuffle]);

  return {
    audioRef,
    currentStation: state.currentStation,
    activeGenre: state.activeGenre,
    status: state.status,
    sessionHistory: state.sessionHistory,
    historyIndex: state.historyIndex,
    playStation,
    playNext,
    playPrev,
    shuffle,
    togglePlayPause,
    setActiveGenre,
  };
}
