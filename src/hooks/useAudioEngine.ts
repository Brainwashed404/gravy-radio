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
    audioRef.current = new Audio();
    audioRef.current.preload = 'none';
  }

  const [state, setState] = useState<AudioEngineState>({
    currentStation: null,
    activeGenre: null,
    status: 'idle',
    sessionHistory: [],
    historyIndex: -1,
  });

  useEffect(() => {
    const audio = audioRef.current!;

    const handlePlaying = () =>
      setState((s) => ({ ...s, status: 'playing' }));

    const handleError = () =>
      setState((s) => ({ ...s, status: 'error' }));

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('error', handleError);
      audio.pause();
    };
  }, []);

  const playStation = useCallback(
    (station: Station) => {
      const audio = audioRef.current!;

      setState((prev) => {
        const newHistory = prev.sessionHistory.slice(0, prev.historyIndex + 1);
        newHistory.push(station);
        return {
          ...prev,
          currentStation: station,
          status: 'loading',
          sessionHistory: newHistory,
          historyIndex: newHistory.length - 1,
        };
      });

      audio.pause();
      audio.src = station.streamUrl;
      audio.load();
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err: Error) => {
          if (err.name === 'AbortError') return;
          setState((s) => ({ ...s, status: 'error' }));
        });
      }
    },
    [],
  );

  const setActiveGenre = useCallback((genre: Genre | null) => {
    setState((s) => ({ ...s, activeGenre: genre }));
  }, []);

  const playNext = useCallback(
    (genre?: Genre) => {
      setState((prev) => {
        const targetGenre = genre ?? prev.activeGenre ?? null;
        const pool = targetGenre ? getStationsByGenre(targetGenre) : stations;
        const candidates = pool.filter((s: Station) => s.id !== prev.currentStation?.id);
        const pick =
          (candidates.length > 0 ? candidates : pool)[
            Math.floor(Math.random() * (candidates.length > 0 ? candidates : pool).length)
          ];

        if (!pick) return prev;

        const audio = audioRef.current!;
        const newHistory = prev.sessionHistory.slice(0, prev.historyIndex + 1);
        newHistory.push(pick);

        audio.pause();
        audio.src = pick.streamUrl;
        audio.load();
        const p = audio.play();
        if (p !== undefined) {
          p.catch((err: Error) => {
            if (err.name === 'AbortError') return;
            setState((s) => ({ ...s, status: 'error' }));
          });
        }

        return {
          ...prev,
          currentStation: pick,
          status: 'loading',
          sessionHistory: newHistory,
          historyIndex: newHistory.length - 1,
        };
      });
    },
    [],
  );

  const playPrev = useCallback(() => {
    setState((prev) => {
      if (prev.historyIndex <= 0) return prev;
      const newIndex = prev.historyIndex - 1;
      const station = prev.sessionHistory[newIndex];
      if (!station) return prev;

      const audio = audioRef.current!;
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

      return {
        ...prev,
        currentStation: station,
        status: 'loading',
        historyIndex: newIndex,
      };
    });
  }, []);

  const shuffle = useCallback(() => {
    setState((prev) => {
      const candidates = stations.filter((s) => s.id !== prev.currentStation?.id);
      const pool = candidates.length > 0 ? candidates : stations;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (!pick) return prev;

      const audio = audioRef.current!;
      const newHistory = prev.sessionHistory.slice(0, prev.historyIndex + 1);
      newHistory.push(pick);

      audio.pause();
      audio.src = pick.streamUrl;
      audio.load();
      const p = audio.play();
      if (p !== undefined) {
        p.catch((err: Error) => {
          if (err.name === 'AbortError') return;
          setState((s) => ({ ...s, status: 'error' }));
        });
      }

      return {
        ...prev,
        currentStation: pick,
        activeGenre: null,
        status: 'loading',
        sessionHistory: newHistory,
        historyIndex: newHistory.length - 1,
      };
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'playing') {
        audioRef.current!.pause();
        return { ...prev, status: 'idle' };
      }
      if (prev.currentStation) {
        const p = audioRef.current!.play();
        if (p !== undefined) {
          p.catch((err: Error) => {
            if (err.name === 'AbortError') return;
            setState((s) => ({ ...s, status: 'error' }));
          });
        }
        return { ...prev, status: 'loading' };
      }
      return prev;
    });

    // If nothing is loaded yet, trigger a global shuffle
    setState((prev) => {
      if (!prev.currentStation && prev.status === 'idle') {
        // shuffle() will handle it — call via timeout to avoid closure issues
        setTimeout(() => shuffle(), 0);
      }
      return prev;
    });
  }, [shuffle]);

  return {
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
