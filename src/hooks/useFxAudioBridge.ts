import { useCallback, useRef, useState, type RefObject } from 'react';
import { createEffectsChain, EFFECT_ORDER, type EffectId, type EffectsChain } from '../lib/audio/effects';

export type FxStatus = 'idle' | 'starting' | 'active' | 'unavailable';

const STORAGE_PREFIX = 'lucky-breaks-fx-';

function loadAmount(id: EffectId): number {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + id);
    return v === null ? 0 : Math.min(1, Math.max(0, Number(v)));
  } catch {
    return 0;
  }
}

function saveAmount(id: EffectId, value: number): void {
  try { localStorage.setItem(STORAGE_PREFIX + id, String(value)); } catch {}
}

/**
 * A second, independent audio element carries live effects, entirely separate from
 * the plain playback element useAudioEngine owns. That element has to be safe for
 * every station regardless of CORS support, and Web Audio effects need the opposite:
 * a crossOrigin element, which makes some stations' servers fail to load at all
 * (confirmed against the real catalogue, not theoretical — createMediaElementSource
 * also only works once per element, ever, so this can't be toggled on the one
 * element normal playback already depends on).
 *
 * So: the primary element always plays, unconditionally, exactly as it always has —
 * nothing here ever touches its .src or its load/retry logic. This bridge only ever
 * mutes/unmutes it. The fx element mirrors the primary's station only once the user
 * has actually touched a fader, races to confirm it can play that station, and only
 * then takes over (primary muted, fx chain's gain brought up). Anything short of a
 * confirmed 'playing' event on the fx element falls back to leaving the primary
 * audible with no effects — never to silence.
 */
export function useFxAudioBridge(primaryAudioRef: RefObject<HTMLAudioElement | null>) {
  const fxAudioRef = useRef<HTMLAudioElement | null>(null);
  const chainRef = useRef<EffectsChain | null>(null);
  const engagedRef = useRef(false);
  const currentUrlRef = useRef<string>('');
  const unavailableRef = useRef(false); // Web Audio itself unsupported — stop retrying
  const amountsRef = useRef<Record<EffectId, number>>(
    Object.fromEntries(EFFECT_ORDER.map((id) => [id, loadAmount(id)])) as Record<EffectId, number>,
  );
  const [fxStatus, setFxStatus] = useState<FxStatus>('idle');

  const ensureFxAudio = useCallback((): HTMLAudioElement => {
    if (fxAudioRef.current) return fxAudioRef.current;
    const a = new Audio();
    a.preload = 'none';
    a.crossOrigin = 'anonymous';
    a.style.display = 'none';
    document.body.appendChild(a);
    fxAudioRef.current = a;
    return a;
  }, []);

  const ensureChain = useCallback((): EffectsChain | null => {
    if (unavailableRef.current) return null;
    if (chainRef.current) {
      chainRef.current.resume();
      return chainRef.current;
    }
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) { unavailableRef.current = true; return null; }
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(ensureFxAudio());
      const chain = createEffectsChain(ctx, source);
      for (const id of EFFECT_ORDER) chain.setAmount(id, amountsRef.current[id]);
      chainRef.current = chain;
      chain.resume();
      return chain;
    } catch {
      unavailableRef.current = true;
      return null;
    }
  }, [ensureFxAudio]);

  const fallBackToPrimary = useCallback(() => {
    chainRef.current?.setActive(false);
    if (primaryAudioRef.current) primaryAudioRef.current.muted = false;
    setFxStatus('unavailable');
  }, [primaryAudioRef]);

  const startFxForCurrentUrl = useCallback(() => {
    const url = currentUrlRef.current;
    if (!url) return;
    const chain = ensureChain();
    if (!chain) { setFxStatus('unavailable'); return; }
    const fx = ensureFxAudio();
    setFxStatus('starting');
    fx.pause();
    fx.src = url;
    fx.load();

    const onPlaying = () => {
      if (fx.src !== currentUrlRef.current && fx.src !== url) return; // stale event from an earlier station
      chain.setActive(true);
      if (primaryAudioRef.current) primaryAudioRef.current.muted = true;
      setFxStatus('active');
    };
    const onDrop = () => {
      if (fx.src !== url) return;
      fallBackToPrimary();
    };
    fx.addEventListener('playing', onPlaying, { once: true });
    fx.addEventListener('error', onDrop, { once: true });
    fx.addEventListener('pause', onDrop, { once: true }); // covers a mid-stream drop too

    fx.play().catch(() => fallBackToPrimary());
  }, [ensureChain, ensureFxAudio, fallBackToPrimary, primaryAudioRef]);

  /** Call whenever the primary element's station changes (same moment .src is set
   *  on it). Keeps the fx element following along once the user has opted in. */
  const syncStation = useCallback((url: string) => {
    currentUrlRef.current = url;
    // Silence fx's own contribution immediately and let the primary be heard: closes
    // the gap between "new station started" and "fx confirmed it can play it too",
    // which would otherwise overlap the old fx audio with the new primary audio.
    chainRef.current?.setActive(false);
    if (primaryAudioRef.current) primaryAudioRef.current.muted = false;
    setFxStatus(engagedRef.current ? 'starting' : 'idle');
    if (engagedRef.current) startFxForCurrentUrl();
  }, [primaryAudioRef, startFxForCurrentUrl]);

  /** Call alongside the primary's own pause/resume so fx doesn't keep streaming
   *  silently in the background, and picks back up on resume. */
  const setPaused = useCallback((paused: boolean) => {
    if (paused) {
      fxAudioRef.current?.pause();
      chainRef.current?.setActive(false);
    } else if (engagedRef.current) {
      startFxForCurrentUrl();
    }
  }, [startFxForCurrentUrl]);

  const setEffectAmount = useCallback((id: EffectId, value: number) => {
    const v = Math.min(1, Math.max(0, value));
    amountsRef.current[id] = v;
    saveAmount(id, v);
    chainRef.current?.setAmount(id, v);
    if (!engagedRef.current && v > 0.001) {
      engagedRef.current = true;
      startFxForCurrentUrl();
    }
  }, [startFxForCurrentUrl]);

  return { syncStation, setPaused, setEffectAmount, fxStatus };
}
