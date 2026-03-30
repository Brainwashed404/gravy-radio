import { useCallback, useEffect, useRef, useState } from 'react';

const BAR_COUNT = 20;

export function useEQAnalyser(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isPlaying: boolean,
): number[] {
  const [bars, setBars] = useState<number[]>(new Array(BAR_COUNT).fill(0));
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);

  const setup = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || sourceRef.current) return;
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaElementSource(audio);
      sourceRef.current = src;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128; // 64 frequency bins
      analyserRef.current = analyser;
      src.connect(analyser);
      analyser.connect(ctx.destination);
    } catch {
      // CORS or browser restriction — analyser unavailable
    }
  }, [audioRef]);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      setBars(new Array(BAR_COUNT).fill(0));
      return;
    }

    setup();

    const analyser = analyserRef.current;
    const ctx = ctxRef.current;
    if (!analyser || !ctx) return;

    ctx.resume().catch(() => {});

    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.ceil(data.length / BAR_COUNT);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      setBars(
        Array.from({ length: BAR_COUNT }, (_, i) =>
          (data[Math.min(i * step, data.length - 1)] ?? 0) / 255,
        ),
      );
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, setup]);

  return bars;
}
