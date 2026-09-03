import { useCallback, useRef, useState, type RefObject } from 'react';
import { createEffectsChain, EFFECT_ORDER, EFFECT_REST_VALUE, type EffectId, type EffectsChain } from '../lib/audio/effects';

export type FxStatus = 'idle' | 'starting' | 'active' | 'unavailable';

const STORAGE_PREFIX = 'lucky-breaks-fx-';

function loadAmount(id: EffectId): number {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + id);
    return v === null ? EFFECT_REST_VALUE[id] : Math.min(1, Math.max(0, Number(v)));
  } catch {
    return EFFECT_REST_VALUE[id];
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
/** How many peekLevel() checks to run, and how far apart, before giving up on a
 *  station that fired 'playing' but never shows real signal. Spread out rather
 *  than one snapshot: a single read can land on a true-silent instant in otherwise
 *  perfectly normal audio (a pause in speech, a quiet intro) and false-negative. */
const AUDIBILITY_PROBE_ATTEMPTS = 8;
const AUDIBILITY_PROBE_INTERVAL_MS = 150;
const AUDIBILITY_THRESHOLD = 0.003;

/** How long a delay/reverb tail is given to ring out on a station switch, instead
 *  of being cut off instantly. */
const TAIL_FADE_SECONDS = 2.5;

export function useFxAudioBridge(primaryAudioRef: RefObject<HTMLAudioElement | null>) {
  const fxAudioRef = useRef<HTMLAudioElement | null>(null);
  const chainRef = useRef<EffectsChain | null>(null);
  const engagedRef = useRef(false);
  const currentUrlRef = useRef<string>('');
  const attemptTokenRef = useRef(0); // guards against a stale probe outliving a station switch
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
    // Match whatever the volume fader is already set to, in case it was moved
    // before this element ever existed — setVolume() only updates it going forward.
    a.volume = primaryAudioRef.current?.volume ?? 1;
    document.body.appendChild(a);
    fxAudioRef.current = a;
    return a;
  }, [primaryAudioRef]);

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
    const token = ++attemptTokenRef.current;
    setFxStatus('starting');
    fx.pause();
    fx.src = url;
    fx.load();

    // A station can fire a perfectly normal 'playing' event while still being
    // CORS-tainted (silently zeroed) through Web Audio specifically — that failure
    // raises no error event at all, so 'playing' alone is not proof of anything.
    // Confirm real signal is actually coming out before muting the primary element;
    // right up until that happens the primary stays audible, so there is never a
    // silent gap even on a station that turns out not to cooperate.
    const probeForRealSignal = async () => {
      for (let i = 0; i < AUDIBILITY_PROBE_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, AUDIBILITY_PROBE_INTERVAL_MS));
        if (attemptTokenRef.current !== token) return; // superseded by a newer attempt
        if (chain.peekLevel() > AUDIBILITY_THRESHOLD) {
          chain.setActive(true);
          if (primaryAudioRef.current) primaryAudioRef.current.muted = true;
          setFxStatus('active');
          return;
        }
      }
      if (attemptTokenRef.current === token) fallBackToPrimary();
    };

    const onPlaying = () => {
      if (attemptTokenRef.current !== token) return; // stale event from an earlier attempt
      void probeForRealSignal();
    };
    const onDrop = () => {
      if (attemptTokenRef.current !== token) return;
      fallBackToPrimary();
    };
    fx.addEventListener('playing', onPlaying, { once: true });
    fx.addEventListener('error', onDrop, { once: true });
    fx.addEventListener('pause', onDrop, { once: true }); // covers a mid-stream drop too

    fx.play().catch(() => { if (attemptTokenRef.current === token) fallBackToPrimary(); });
  }, [ensureChain, ensureFxAudio, fallBackToPrimary, primaryAudioRef]);

  /** Call whenever the primary element's station changes (same moment .src is set
   *  on it). Keeps the fx element following along once the user has opted in. */
  const syncStation = useCallback((url: string) => {
    currentUrlRef.current = url;
    // Invalidate any in-flight attempt from the previous station FIRST: the pause()
    // just below would otherwise fire that attempt's still-armed 'pause' listener,
    // which falls back instantly and defeats the graceful fade started right after.
    ++attemptTokenRef.current;
    // Stop feeding the old station into the chain right away (pausing the element
    // silences its dry signal immediately) but let the effects' own output fade
    // out over TAIL_FADE_SECONDS rather than cutting instantly: a delay or reverb
    // tail that was mid-decay keeps ringing out and fading naturally underneath
    // the new station coming in on the primary, instead of being chopped off.
    // If a new fx attempt below confirms real signal before the fade finishes,
    // its own fast ramp-up simply overtakes this one.
    fxAudioRef.current?.pause();
    chainRef.current?.setActive(false, TAIL_FADE_SECONDS);
    if (primaryAudioRef.current) primaryAudioRef.current.muted = false;

    // Every station starts on a clean mix: reset every fader back to its own rest
    // value rather than carrying whatever was dialled in for the last one. Rest
    // value, not a hardcoded 0 — filter's bypass point is its fader's centre, not
    // its bottom, so resetting it to 0 would land on a hard highpass instead of
    // silence. Runtime-only: this doesn't touch localStorage, so a fresh page load
    // still comes back at the last deliberately-set levels; it's specifically an
    // active mix riding across a station change that gets cleared, not the
    // remembered defaults. The physical faders obviously don't move (nothing here
    // is motorised), so a fader left up will disagree with the software's now-reset
    // idea of it until it's touched again — normal for this class of controller.
    for (const id of EFFECT_ORDER) {
      amountsRef.current[id] = EFFECT_REST_VALUE[id];
      chainRef.current?.setAmount(id, EFFECT_REST_VALUE[id]);
    }
    engagedRef.current = false;
    setFxStatus('idle');
  }, [primaryAudioRef]);

  /** Call alongside the primary's own pause/resume so fx doesn't keep streaming
   *  silently in the background, and picks back up on resume. */
  const setPaused = useCallback((paused: boolean) => {
    if (paused) {
      ++attemptTokenRef.current; // same reasoning as syncStation: invalidate before pause() fires 'pause'
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
    // Distance from THIS effect's own rest value, not from 0 — filter rests at
    // 0.5, so almost any fader position would count as "touched" under a flat
    // v > 0.001 check even with the fader untouched at its own bypass point.
    if (!engagedRef.current && Math.abs(v - EFFECT_REST_VALUE[id]) > 0.001) {
      engagedRef.current = true;
      startFxForCurrentUrl();
    }
  }, [startFxForCurrentUrl]);

  // The master volume fader only ever set the primary element's .volume. Once fx
  // takes over as the audible source that had no effect at all on what you could
  // actually hear — the fx element's own volume was never touched. Element .volume
  // is applied to the decoded audio before it reaches the Web Audio graph, so
  // mirroring it here is enough; no gain node needed.
  const setVolume = useCallback((v: number) => {
    if (fxAudioRef.current) fxAudioRef.current.volume = Math.min(1, Math.max(0, v));
  }, []);

  return { syncStation, setPaused, setEffectAmount, setVolume, fxStatus };
}
