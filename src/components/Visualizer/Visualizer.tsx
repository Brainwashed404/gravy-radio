import { useEffect, useRef } from 'react';
import styles from './Visualizer.module.css';

export type VizMode = 'eq' | 'wave' | 'radial';

const YELLOW = 'rgba(255, 255, 0, 0.82)';
const LINE = 1.5;

function drawEQ(ctx: CanvasRenderingContext2D, analyser: AnalyserNode, W: number, H: number) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const BAR_COUNT = 7;
  // Use lower 65% of spectrum where musical content lives
  const useBins = Math.floor(data.length * 0.65);
  const step = Math.floor(useBins / BAR_COUNT);
  const slot = W / BAR_COUNT;
  const barW = slot * 0.45;
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = LINE;
  for (let i = 0; i < BAR_COUNT; i++) {
    const val = data[i * step] / 255;
    const h = Math.max(2, val * H * 0.9);
    const x = i * slot + (slot - barW) / 2;
    ctx.strokeRect(x, H - h, barW, h);
  }
}

function drawWave(ctx: CanvasRenderingContext2D, analyser: AnalyserNode, W: number, H: number) {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = LINE;
  ctx.beginPath();
  const sliceW = W / data.length;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128 - 1;
    const x = i * sliceW;
    const y = H / 2 + v * H * 0.42;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawRadial(ctx: CanvasRenderingContext2D, analyser: AnalyserNode, W: number, H: number) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const cx = W / 2;
  const cy = H / 2;
  const base = Math.min(W, H) * 0.12;
  const maxSpoke = Math.min(W, H) * 0.38;
  const COUNT = 64;
  const bins = Math.floor(data.length * 0.72);
  const step = bins / COUNT;
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = LINE;

  // Mirrored outer shape (top + bottom for symmetry)
  for (const mirror of [1, -1]) {
    ctx.beginPath();
    for (let i = 0; i <= COUNT / 2; i++) {
      const val = data[Math.floor(i * step)] / 255;
      const r = base + val * maxSpoke;
      const angle = (i / (COUNT / 2)) * Math.PI; // 0 → π
      const x = cx + Math.cos(angle) * r * (W / Math.min(W, H));
      const y = cy + Math.sin(angle) * r * mirror;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, base * 0.4, 0, Math.PI * 2);
  ctx.stroke();
}

interface VisualizerProps {
  analyser: AnalyserNode | null;
  mode: VizMode;
  isActive: boolean;
}

export function Visualizer({ analyser, mode, isActive }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    cancelAnimationFrame(rafRef.current);

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    if (!analyser || !isActive) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      if (mode === 'eq') drawEQ(ctx, analyser, W, H);
      else if (mode === 'wave') drawWave(ctx, analyser, W, H);
      else if (mode === 'radial') drawRadial(ctx, analyser, W, H);
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, mode, isActive]);

  return <canvas ref={canvasRef} className={styles.canvas} />;
}
