import { useCallback, useEffect, useRef, useState } from 'react';
import { type Genre, type Station, getStationsByGenre, stations } from '../data/stations';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'error';

const VOLUME_KEY = 'lucky-breaks-volume';

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

  // Distinguishes a deliberate pause (togglePlayPause) from the stream dropping on its own
  // (CDN connection reset, backgrounded-tab throttling, etc.) so only the latter auto-retries.
  const userPausedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const [state, setState] = useState<AudioEngineState>(stateRef.current);
  stateRef.current = state;

  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(VOLUME_KEY);
      if (stored === null) return 1;
      const v = Number(stored);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    } catch {
      return 1;
    }
  });

  // Applied to the element rather than held in a GainNode: the element survives
  // every src swap, so volume persists across station changes for free.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch {}
  }, [volume]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.min(1, Math.max(0, v)));
  }, []);

  useEffect(() => {
    const audio = audioRef.current!;

    // Attach to DOM — iOS Media Session requires the element to be in the document
    document.body.appendChild(audio);

    const clearRetry = () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    // Live streams drop for all kinds of reasons (CDN resets, background-tab
    // throttling) with no user action involved. Reconnect automatically with
    // backoff so an unattended/backgrounded tab keeps playing instead of going
    // silently dead — a dead session also causes the OS to drop hardware media
    // key routing to the tab.
    const scheduleRetry = () => {
      if (userPausedRef.current) return;
      const station = stateRef.current.currentStation;
      if (!station) return;
      clearRetry();
      const delay = Math.min(30000, 2000 * 2 ** retryCountRef.current);
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        if (userPausedRef.current || stateRef.current.currentStation?.id !== station.id) return;
        expectedUrlRef.current = station.streamUrl;
        audio.src = station.streamUrl;
        audio.load();
        audio.play().catch(() => {});
      }, delay);
    };

    const handlePlaying = () => {
      if (audio.src !== expectedUrlRef.current) return;
      retryCountRef.current = 0;
      clearRetry();
      setState((s) => ({ ...s, status: 'playing' }));
    };

    // Sync state when iOS interrupts playback (calls, Siri, etc.) or the stream drops
    const handlePause = () => {
      if (audio.src !== expectedUrlRef.current) return;
      setState((s) => (s.status === 'playing' ? { ...s, status: 'idle' } : s));
      if (!userPausedRef.current) scheduleRetry();
    };

    const handleError = () => {
      setState((s) => ({ ...s, status: 'error' }));
      scheduleRetry();
    };

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      clearRetry();
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

      userPausedRef.current = false;
      retryCountRef.current = 0;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

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

    userPausedRef.current = false;
    retryCountRef.current = 0;
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

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
      userPausedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      audioRef.current!.pause();
      setState((s) => ({ ...s, status: 'idle' }));
      return;
    }
    if (prev.currentStation) {
      // Re-set src so the browser re-fetches the live stream.
      // Do NOT call audio.load() — that resets the iOS audio session and
      // makes iOS treat the subsequent play() as requiring a new user gesture.
      userPausedRef.current = false;
      retryCountRef.current = 0;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const audio = audioRef.current!;
      expectedUrlRef.current = prev.currentStation.streamUrl;
      audio.src = prev.currentStation.streamUrl;
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
    volume,
    setVolume,
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
