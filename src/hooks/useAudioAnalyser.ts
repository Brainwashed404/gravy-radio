import { useCallback, useEffect, useRef, useState } from 'react';

export function useAudioAnalyser(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isPlaying: boolean,
): AnalyserNode | null {
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const setup = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || sourceRef.current) return;
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaElementSource(audio);
      sourceRef.current = src;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      setAnalyserNode(analyser);
    } catch {
      // CORS restriction — analyser unavailable for this stream
    }
  }, [audioRef]);

  useEffect(() => {
    if (!isPlaying) return;
    setup();
    ctxRef.current?.resume().catch(() => {});
  }, [isPlaying, setup]);

  return analyserNode;
}
