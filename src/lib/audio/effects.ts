// Live effects chain for the radio stream. Pure Web Audio, no React here.
//
// Each effect is a small factory returning { input, output, setAmount }: a single
// 0-1 knob per effect, matching one APC mini fader each. Every effect must have a
// true transparent bypass (unity gain, no coloration) SOMEWHERE in its 0-1 range —
// that's what keeps the app sounding identical to today for anyone not touching the
// faders — but that point is 0.5 (dead centre) for filter and phaserFlanger,
// 0 for the rest. See EFFECT_REST_VALUE below rather than assuming 0 universally.
//
// ScriptProcessorNode is used for stutter and beat repeat rather than an
// AudioWorklet. It's deprecated but universally supported and far simpler to
// reason about; worklets need an async module load (workable via a Blob URL,
// but adds a failure mode with no real upside here) and both of these need
// genuine per-sample ring-buffer state that no native AudioParam-driven node
// can express. Both run at a 512-sample buffer, not the more common 4096 -
// see the comment on createBeatRepeatEffect for why that matters when there's
// more than one ScriptProcessorNode in the chain.

export type EffectId =
  | 'filter'
  | 'phaserFlanger'
  | 'reverb'
  | 'beatRepeat'
  | 'stutter'
  | 'pingPongDelay'
  | 'dubDelay';

// Signal chain order matches the fader order left to right on the hardware.
export const EFFECT_ORDER: EffectId[] = [
  'filter', 'phaserFlanger', 'stutter', 'beatRepeat', 'reverb', 'pingPongDelay', 'dubDelay',
];

export const EFFECT_LABELS: Record<EffectId, string> = {
  filter: 'Filter',
  phaserFlanger: 'Phaser / Flanger',
  reverb: 'Reverb',
  beatRepeat: 'Beat repeat',
  stutter: 'Stutter',
  pingPongDelay: 'Ping pong delay',
  dubDelay: 'Dub delay',
};

/** Where each effect's fader has to sit to be a true bypass. 0 for everything
 *  except filter and phaserFlanger, both DJ-mixer style: wide open at the
 *  middle rather than at either end. Anything that wants to "reset to a clean
 *  mix" (station changes, first load with nothing saved yet) needs this, not a
 *  hardcoded 0, or those two would reset into an active effect instead of
 *  silence. */
export const EFFECT_REST_VALUE: Record<EffectId, number> = {
  filter: 0.5,
  phaserFlanger: 0.5,
  reverb: 0,
  beatRepeat: 0,
  stutter: 0,
  pingPongDelay: 0,
  dubDelay: 0,
};

/** Rest value for each effect's optional secondary parameter (see setSecondary on
 *  EffectUnit): dub delay and ping pong delay both have one now, fader 8's
 *  feedback, shared across both at once (see FX_SECONDARY_ACTION_EFFECT). Neither
 *  is 0: with feedback at 0 the loop can't regenerate, so touching only the wet
 *  fader gets one bare echo that reads as the trail "cutting off" the instant a
 *  station changes, instead of ringing out. dubDelay's 0.5 (real feedback ~0.4,
 *  see DUB_DELAY_MAX_FEEDBACK) gives a proper multi-repeat decaying trail out of
 *  the box from its wet fader alone. pingPongDelay's 0.5 (real feedback ~0.45, see
 *  PING_PONG_MAX_FEEDBACK) matches its old always-on 0.45 default from before
 *  fader 8 drove it, so anyone not touching fader 8 hears the same trail length as
 *  before. Fader 8 still adjusts both from there, and once touched that becomes
 *  the new default via localStorage. */
export const EFFECT_SECONDARY_REST_VALUE: Partial<Record<EffectId, number>> = {
  dubDelay: 0.5,
  pingPongDelay: 0.5,
};

interface EffectUnit {
  input: AudioNode;
  output: AudioNode;
  setAmount: (v: number) => void;
  /** Optional second 0-1 knob, for the one effect (currently dub delay's feedback)
   *  that wants a parameter beyond the wet/dry mix setAmount already covers. */
  setSecondary?: (v: number) => void;
}

const RAMP = 0.02; // seconds — short smoothing so fader moves don't click

// One knob, two filter types: below the midpoint sweeps a lowpass down from wide
// open (muffles it, classic breakdown move), above it sweeps a highpass up from
// wide open (thins the sound out, classic build-up move) - the bottom of the
// fader goes dark, the top goes thin/bright. Exactly at the midpoint both types
// sit essentially at the edge of the audible range, so switching .type there
// doesn't produce an audible click.
function createFilterEffect(ctx: AudioContext): EffectUnit {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.85;
  filter.frequency.value = 20000; // wide open
  const setAmount = (v: number) => {
    if (v <= 0.5) {
      filter.type = 'lowpass';
      const t = v / 0.5; // 1 (open) -> 0 (closed) as v goes 0.5 -> 0
      const freq = 20000 * Math.pow(150 / 20000, 1 - t);
      filter.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP);
    } else {
      filter.type = 'highpass';
      const t = (v - 0.5) / 0.5; // 0 (open) -> 1 (closed) as v goes 0.5 -> 1
      const freq = 20 * Math.pow(2000 / 20, t);
      filter.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP);
    }
  };
  return { input: filter, output: filter, setAmount };
}

// Phaser and flanger share one fader, same convention as filter: bypass dead
// centre, one effect sweeping in below it, the other above. Below centre is
// the phaser (four cascaded allpass stages swept by a shared slow LFO, with a
// touch of feedback around the cascade for a stronger, more resonant sweep);
// above centre is the flanger (a short modulated delay with feedback). Both
// DSP paths always exist in parallel from the same input, but only one wet
// gain is ever nonzero at a time (the other is forced to 0 by whichever half
// of the fader you're not in), so there's no risk of hearing both stacked.
function createPhaserFlangerEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  input.connect(dry).connect(output);
  dry.gain.value = 1;

  // Phaser wet path
  const phaserWet = ctx.createGain();
  phaserWet.gain.value = 0;
  const stageCount = 4;
  const stages: BiquadFilterNode[] = [];
  let node: AudioNode = input;
  for (let i = 0; i < stageCount; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 800;
    ap.Q.value = 0.6;
    node.connect(ap);
    node = ap;
    stages.push(ap);
  }
  const phaserFeedback = ctx.createGain();
  phaserFeedback.gain.value = 0.35;
  node.connect(phaserFeedback);
  phaserFeedback.connect(stages[0]);
  node.connect(phaserWet).connect(output);
  const phaserLfo = ctx.createOscillator();
  phaserLfo.type = 'sine';
  phaserLfo.frequency.value = 0.3;
  const phaserLfoDepth = ctx.createGain();
  phaserLfoDepth.gain.value = 600; // Hz swept around each stage's base frequency
  phaserLfo.connect(phaserLfoDepth);
  for (const stage of stages) phaserLfoDepth.connect(stage.frequency);
  phaserLfo.start();

  // Flanger wet path
  const flangerWet = ctx.createGain();
  flangerWet.gain.value = 0;
  const flangerDelay = ctx.createDelay(0.02);
  flangerDelay.delayTime.value = 0.005;
  const flangerFeedback = ctx.createGain();
  flangerFeedback.gain.value = 0.4;
  const flangerLfo = ctx.createOscillator();
  flangerLfo.type = 'sine';
  flangerLfo.frequency.value = 0.25;
  const flangerLfoDepth = ctx.createGain();
  flangerLfoDepth.gain.value = 0.003;
  input.connect(flangerDelay);
  flangerDelay.connect(flangerFeedback).connect(flangerDelay);
  flangerDelay.connect(flangerWet).connect(output);
  flangerLfo.connect(flangerLfoDepth).connect(flangerDelay.delayTime);
  flangerLfo.start();

  const setAmount = (v: number) => {
    if (v <= 0.5) {
      const t = (0.5 - v) / 0.5; // 0 at centre -> 1 at the bottom
      phaserWet.gain.setTargetAtTime(t * 0.85, ctx.currentTime, RAMP);
      flangerWet.gain.setTargetAtTime(0, ctx.currentTime, RAMP);
    } else {
      const t = (v - 0.5) / 0.5; // 0 at centre -> 1 at the top
      flangerWet.gain.setTargetAtTime(t * 0.9, ctx.currentTime, RAMP);
      phaserWet.gain.setTargetAtTime(0, ctx.currentTime, RAMP);
    }
  };
  return { input, output, setAmount };
}

// Procedural convolution reverb: no external impulse-response asset (matching
// every other effect here being purely synthesised), a stereo impulse of
// decaying filtered noise generated once at creation time instead. A "hall
// plate" hybrid: long and dense rather than a short, tight plate or a boomy,
// sparse hall - REVERB_IR_SECONDS is the main lever on how massive it reads.
const REVERB_IR_SECONDS = 3.6;

function generateReverbImpulse(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * REVERB_IR_SECONDS);
  const impulse = ctx.createBuffer(2, length, rate);
  // True exponential decay (a fixed time constant, not a (1-t)^n power curve):
  // a power curve front-loads almost all of its energy into roughly the first
  // second regardless of exponent, which combined with ConvolverNode.normalize
  // (scaled off the whole IR's RMS, dominated by that loud start) left the back
  // half of the buffer too quiet to register at all - confirmed by actually
  // rendering it and watching the measured tail hit zero within ~2s instead of
  // the full 3.6. tau is picked so the envelope reaches -60dB right at the end
  // of REVERB_IR_SECONDS, spreading the decay audibly across the whole length.
  const tau = REVERB_IR_SECONDS / Math.log(1000);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / rate; // seconds, not 0-1, so tau (in seconds) applies directly
      const envelope = Math.exp(-t / tau);
      data[i] = (Math.random() * 2 - 1) * envelope; // independent per channel for stereo width
    }
  }
  return impulse;
}

function createReverbEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  // Send and return, same post-fader reasoning as both delays: setAmount only
  // ever touches `send`, gating how much new signal feeds the convolver.
  // `wetReturn` - how much of the tail already ringing through the IR reaches
  // the output - stays fixed, so pulling the fader down or a station change
  // doesn't chop a 3.6s tail off mid-decay; it rings out on its own the way an
  // actual room would once you stop feeding it, same as this app's dub delay
  // and ping pong delay already do. Without this a "massive" reverb would
  // cut exactly when it's most noticeable.
  const send = ctx.createGain();
  const wetReturn = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = generateReverbImpulse(ctx);

  // A brief pre-delay separates the dry hit from the reverb onset the way a
  // real space would, rather than the reverb starting exactly on top of the
  // source; a gentle highshelf cut keeps a 3.6s tail warm rather than hissy.
  const preDelay = ctx.createDelay(0.1);
  preDelay.delayTime.value = 0.02;
  const toneShelf = ctx.createBiquadFilter();
  toneShelf.type = 'highshelf';
  toneShelf.frequency.value = 5000;
  toneShelf.gain.value = -6;

  input.connect(dry).connect(output);
  input.connect(send).connect(preDelay).connect(convolver).connect(toneShelf).connect(wetReturn).connect(output);
  dry.gain.value = 1;
  send.gain.value = 0;
  // Convolver normalize evens out a long, mostly-quiet-tailed IR's overall
  // level more than this needs for "massive" - boosted above unity to
  // compensate, tuned by ear against the other effects' wet levels.
  wetReturn.gain.value = 1.6;
  const setAmount = (v: number) => send.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
  return { input, output, setAmount };
}

// Classic beat repeat: keeps recording continuously and re-slices from the
// tail of that rolling buffer, so it's a live retriggering roll rather than a
// true freeze - the sibling to stutter (below), which does freeze. Kept as a
// second, differently-behaved option after gate didn't land well: slice
// length is recomputed once per block straight from the fader (linear, not
// exponential, ~430ms barely up down to ~30ms maxed) rather than every
// sample, and re-reading it while already engaged is what makes moving the
// fader mid-roll audibly retrigger - a feature here, not a bug, it's meant to
// be played with live. No crossfade at the slice boundary either, unlike
// stutter - the click at the loop point is part of this one's rougher
// character.
function createBeatRepeatEffect(ctx: AudioContext): EffectUnit {
  const node = ctx.createScriptProcessor(512, 2, 2);
  const sr = ctx.sampleRate;
  const maxSliceSamples = Math.floor(sr * 0.5);
  const ringL = new Float32Array(maxSliceSamples);
  const ringR = new Float32Array(maxSliceSamples);
  let writeIdx = 0;
  let amount = 0;
  let engaged = false;
  let sliceStart = 0;
  let readPos = 0;

  node.onaudioprocess = (e) => {
    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    const sliceLen = Math.max(Math.floor(sr * 0.03), Math.floor(sr * 0.4 * (1 - amount) + sr * 0.03));

    for (let i = 0; i < inL.length; i++) {
      ringL[writeIdx] = inL[i];
      ringR[writeIdx] = inR[i];
      writeIdx = (writeIdx + 1) % maxSliceSamples;

      if (amount <= 0.001) {
        engaged = false;
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      if (!engaged) {
        engaged = true;
        sliceStart = (writeIdx - sliceLen + maxSliceSamples) % maxSliceSamples;
        readPos = 0;
      }
      const idx = (sliceStart + (readPos % sliceLen)) % maxSliceSamples;
      outL[i] = ringL[idx];
      outR[i] = ringR[idx];
      readPos++;
    }
  };
  return { input: node, output: node, setAmount: (v) => { amount = v; } };
}

// Free-running granular stutter: an asynchronous micro-looper, not a
// tempo-synced repeat. Passive (fader at 0) it just keeps a rolling ~1s
// history in a ring buffer and passes audio straight through. The instant the
// fader leaves 0, it freezes: the current write position becomes loopStart,
// and playback loops that one frozen segment continuously rather than
// continuing to record - a real freeze, not a periodically-retriggered
// slice. Grain length is recalculated every sample from the live fader value,
// so sweeping the fader while frozen smoothly changes the loop length instead
// of needing to drop out and re-trigger. Dropping the fader back to 0 resumes
// recording and passthrough immediately.
//
// Fader mapping is exponential, not linear: 500ms (barely up - a slow, audible
// repeat) down to 2ms (maxed - a robotic, audio-rate buzz) as the fader rises.
// A plain exponential curve (grainMs = MAX * (MIN/MAX)^v) already drops off
// fast, but not fast enough at the very top and too fast right at the bottom -
// by the halfway point it's already down around 30ms, so the "long, spaced
// out" character barely got any of the fader's travel. STUTTER_CURVE_BIAS
// applies an extra power to v first (v^bias) so the curve sits close to
// STUTTER_MAX_GRAIN_MS for longer near the bottom before dropping steeply
// toward STUTTER_MIN_GRAIN_MS near the top, instead of a constant per-step
// ratio the whole way.
const STUTTER_MIN_GRAIN_MS = 2;
const STUTTER_MAX_GRAIN_MS = 500;
const STUTTER_CURVE_BIAS = 2;
const STUTTER_CROSSFADE_MS = 2; // at each loop boundary, prevents zero-crossing clicks

// 512 not 4096, same latency reasoning as createGateEffect above.
function createStutterEffect(ctx: AudioContext): EffectUnit {
  const node = ctx.createScriptProcessor(512, 2, 2);
  const sr = ctx.sampleRate;
  const bufferLen = Math.floor(sr * 1); // >= 1 second of rolling history
  const ringL = new Float32Array(bufferLen);
  const ringR = new Float32Array(bufferLen);
  let writePointer = 0;
  let readPointer = 0;
  let loopStart = 0;
  let isActive = false;
  let amount = 0;

  node.onaudioprocess = (e) => {
    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);

    for (let i = 0; i < inL.length; i++) {
      if (amount <= 0) {
        ringL[writePointer] = inL[i];
        ringR[writePointer] = inR[i];
        writePointer = (writePointer + 1) % bufferLen;
        isActive = false;
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }

      if (!isActive) {
        loopStart = writePointer;
        readPointer = loopStart;
        isActive = true;
      }

      const grainMs = STUTTER_MAX_GRAIN_MS * Math.pow(STUTTER_MIN_GRAIN_MS / STUTTER_MAX_GRAIN_MS, Math.pow(amount, STUTTER_CURVE_BIAS));
      const grainLengthSamples = Math.max(1, Math.round((grainMs / 1000) * sr));
      const crossfadeSamples = Math.min(
        Math.floor(grainLengthSamples / 2),
        Math.round((STUTTER_CROSSFADE_MS / 1000) * sr),
      );

      const posInGrain = readPointer - loopStart;
      let window = 1;
      if (crossfadeSamples > 0) {
        if (posInGrain < crossfadeSamples) window = posInGrain / crossfadeSamples;
        else if (posInGrain >= grainLengthSamples - crossfadeSamples) {
          window = (grainLengthSamples - posInGrain) / crossfadeSamples;
        }
      }

      const idx = loopStart + (posInGrain % grainLengthSamples);
      const wrappedIdx = ((idx % bufferLen) + bufferLen) % bufferLen;
      outL[i] = ringL[wrappedIdx] * window;
      outR[i] = ringR[wrappedIdx] * window;

      readPointer++;
      if (readPointer - loopStart >= grainLengthSamples) readPointer = loopStart;
    }
  };
  return { input: node, output: node, setAmount: (v) => { amount = v; } };
}

// Classic ping pong: one delay line feeding hard left, whose feedback crosses into
// a second delay line feeding hard right (and back again), so repeats alternate
// side to side rather than staying centred.
//
// Send and return are deliberately two different gain nodes, not one: the fader
// (setAmount) only ever touches `send`, which is how much NEW signal is allowed
// into the delay lines. `wetReturn` — how much of whatever's already circulating
// reaches the output — stays fixed. Pull the fader down fast and the repeats
// already in flight keep bouncing and decaying on their own via the feedback
// loop's own physics, rather than being cut off the instant the fader moves; the
// fader is a gate on new echoes starting, not a real-time volume on the ones
// already going. This is what a mixing console would call post-fader routing.
//
// setAmount also drives the repeat spacing, not just the send level: a little
// bit up gives long, spaced-out repeats, pushed further up they get closer
// together, down to a tight flutter at the top. Changing a DelayNode's own time
// while signal is already circulating in it does audibly pitch-bend that signal
// for the moment it's changing (a real property of a live delay line, not a
// bug) — expected here, since this is meant to be played with as a performance
// fader rather than set once and left.
//
// No filtering anywhere in this loop (just gain and panning, both provably <=1:
// equal-power panning never sums to more than unity), unlike dub delay's loop —
// so there's no equivalent of that overshoot bug here and PING_PONG_MAX_FEEDBACK
// can safely sit much closer to 1. Still verified by actually rendering it before
// picking the number rather than trusting that reasoning alone a third time.
const PING_PONG_MAX_FEEDBACK = 0.9;
const PING_PONG_MIN_DELAY = 0.09; // seconds, fader all the way up: tight flutter
const PING_PONG_MAX_DELAY = 0.6;  // seconds, fader just barely up: long, spaced repeats

function createPingPongDelayEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const send = ctx.createGain();
  const wetReturn = ctx.createGain();

  const delayL = ctx.createDelay(1.0);
  const delayR = ctx.createDelay(1.0);
  delayL.delayTime.value = PING_PONG_MAX_DELAY;
  delayR.delayTime.value = PING_PONG_MAX_DELAY;
  const feedbackL = ctx.createGain();
  const feedbackR = ctx.createGain();
  // Raw creation-time value only; ensureChain() immediately calls setSecondary
  // with the real rest value (EFFECT_SECONDARY_REST_VALUE.pingPongDelay) or
  // whatever was saved, so this never stays at 0 in practice - same pattern as
  // dub delay's feedback node.
  feedbackL.gain.value = 0;
  feedbackR.gain.value = 0;
  const pannerL = ctx.createStereoPanner();
  pannerL.pan.value = -1;
  const pannerR = ctx.createStereoPanner();
  pannerR.pan.value = 1;

  input.connect(send).connect(delayL);
  delayL.connect(pannerL).connect(wetReturn);
  delayL.connect(feedbackL).connect(delayR);
  delayR.connect(pannerR).connect(wetReturn);
  delayR.connect(feedbackR).connect(delayL);

  input.connect(dry).connect(output);
  wetReturn.connect(output);
  dry.gain.value = 1;
  send.gain.value = 0;
  wetReturn.gain.value = 0.85; // fixed — nothing reaches it until send lets signal in anyway
  const setAmount = (v: number) => {
    send.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
    const time = PING_PONG_MAX_DELAY * Math.pow(PING_PONG_MIN_DELAY / PING_PONG_MAX_DELAY, v);
    delayL.delayTime.setTargetAtTime(time, ctx.currentTime, RAMP);
    delayR.delayTime.setTargetAtTime(time, ctx.currentTime, RAMP);
  };
  const setSecondary = (v: number) => {
    const fb = v * PING_PONG_MAX_FEEDBACK;
    feedbackL.gain.setTargetAtTime(fb, ctx.currentTime, RAMP);
    feedbackR.gain.setTargetAtTime(fb, ctx.currentTime, RAMP);
  };
  return { input, output, setAmount, setSecondary };
}

// King Tubby style dub echo: long feedback trail, each repeat a little darker
// (lowpass) and thinner (highpass) than the last. No saturator in the loop (see
// the comment on `feedback` below for why), but "purely linear means any feedback
// under 1 is stable" turned out to be wrong in practice: measured directly via
// getFrequencyResponse(), the loop's own lowpass+highpass pair peaks around 1.22x
// gain in the middle of its passband (~330Hz) rather than sitting flat at 1x, no
// matter what Q they're given (checked all the way down to Q=0.01) — so the real
// per-pass loop gain is feedback times that peak, not feedback alone. 0.85 was
// tried first and audibly ran away instead of decaying (confirmed by rendering it
// and watching the level climb, not fall); the actual instability threshold is
// close to 1/1.22 =~ 0.82. 0.75 sits with real margin under that, verified by the
// same rendering test to decay smoothly and stay inaudible after ~20+ seconds at
// max, versus the old 0.6's measured 3-5 seconds.
const DUB_DELAY_MAX_FEEDBACK = 0.75;

function createDubDelayEffect(ctx: AudioContext): EffectUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  // Send and return are two different gain nodes, same reasoning as ping pong
  // delay above: the fader (setAmount) only ever touches `send`, gating whether
  // new signal gets into the loop. `wetReturn` — how much of what's already
  // circulating reaches the output — stays fixed, so pulling the fader down fast
  // doesn't cut off a trail already in flight; it decays on the loop's own
  // feedback physics instead. Post-fader routing, not a real-time wet volume.
  const send = ctx.createGain();
  const wetReturn = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  // Raw creation-time value only; ensureChain() immediately calls setSecondary
  // with the real rest value (EFFECT_SECONDARY_REST_VALUE.dubDelay, see there for
  // why it isn't 0) or whatever was saved, so this never stays at 0 in practice.
  feedback.gain.value = 0;
  // No saturator in this loop, deliberately — a soft-clip curve here initially
  // looked like a safe "subtle warmth" addition (its slope at the origin was
  // comfortably under 1/feedback), but that's only a small-signal analysis. Once
  // actually driven for a while, the loop settled into a sustained, non-decaying
  // oscillation instead of fading — confirmed by rendering it offline and watching
  // the level hold steady rather than decay. A purely linear loop (just filters
  // and a feedback gain, both provably <=1 in the frequency band that matters)
  // has no such equilibrium to get stuck at: total loop gain is feedback alone,
  // capped at DUB_DELAY_MAX_FEEDBACK, so it decays predictably from anywhere.
  const loopLowpass = ctx.createBiquadFilter();
  loopLowpass.type = 'lowpass';
  loopLowpass.frequency.value = 2200;
  loopLowpass.Q.value = 0.7; // Butterworth-flat — no resonant peak adding gain of its own
  const loopHighpass = ctx.createBiquadFilter();
  loopHighpass.type = 'highpass';
  loopHighpass.frequency.value = 250;
  loopHighpass.Q.value = 0.7;

  input.connect(dry).connect(output);
  input.connect(send).connect(delay);
  delay.connect(loopLowpass).connect(loopHighpass);
  loopHighpass.connect(feedback).connect(delay);
  loopHighpass.connect(wetReturn).connect(output);

  dry.gain.value = 1;
  send.gain.value = 0;
  wetReturn.gain.value = 0.85; // fixed — nothing reaches it until send lets signal in anyway
  const setAmount = (v: number) => send.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
  const setSecondary = (v: number) => feedback.gain.setTargetAtTime(v * DUB_DELAY_MAX_FEEDBACK, ctx.currentTime, RAMP);
  return { input, output, setAmount, setSecondary };
}

const FACTORIES: Record<EffectId, (ctx: AudioContext) => EffectUnit> = {
  filter: createFilterEffect,
  phaserFlanger: createPhaserFlangerEffect,
  reverb: createReverbEffect,
  beatRepeat: createBeatRepeatEffect,
  stutter: createStutterEffect,
  pingPongDelay: createPingPongDelayEffect,
  dubDelay: createDubDelayEffect,
};

export interface EffectsChain {
  ctx: AudioContext;
  setAmount: (id: EffectId, value: number) => void;
  /** No-ops for any effect that doesn't have one (see EffectUnit.setSecondary). */
  setSecondary: (id: EffectId, value: number) => void;
  resume: () => void;
  /** Ramps the chain's final output to silent or full. Used to hand off cleanly
   *  between this graph and the plain playback element it's shadowing: silenced
   *  the instant a station switch starts, brought back only once this graph's own
   *  element confirms it's actually playing the new station. */
  setActive: (active: boolean, rampSeconds?: number) => void;
  /** Instantaneous peak amplitude of the chain's own decoded audio, tapped before
   *  the active/inactive gain so it reads correctly either way. A station can fire
   *  a completely normal 'playing' event while still being CORS-tainted (silently
   *  zeroed) through Web Audio specifically — that failure produces no error event
   *  at all, so this is the only way to actually confirm real signal is present
   *  before committing to a handoff away from the untainted playback element. */
  peekLevel: () => number;
  /** The chain's fully-processed output, tapped at the same point as peekLevel
   *  (post-effects, pre-masterGain) - what the looper (useFxAudioBridge) records
   *  from, so a captured loop includes whatever effects were dialled in at the
   *  moment of capture. A plain AudioNode, not a method: the looper connects its
   *  own recording node to it directly. */
  recordTap: AudioNode;
}

/** Builds the full serial chain from `source` to `ctx.destination` and returns a
 *  single setAmount(id, value) to drive any of the faders. */
export function createEffectsChain(ctx: AudioContext, source: MediaElementAudioSourceNode): EffectsChain {
  const units = {} as Record<EffectId, EffectUnit>;
  let prev: AudioNode = source;
  for (const id of EFFECT_ORDER) {
    const unit = FACTORIES[id](ctx);
    prev.connect(unit.input);
    prev = unit.output;
    units[id] = unit;
  }
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0; // silent until setActive(true) is explicitly called
  prev.connect(masterGain);
  masterGain.connect(ctx.destination);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  prev.connect(analyser); // parallel tap, ahead of masterGain so this works even while inactive
  const analyserBuffer = new Float32Array(analyser.fftSize);
  const peekLevel = () => {
    analyser.getFloatTimeDomainData(analyserBuffer);
    let peak = 0;
    for (let i = 0; i < analyserBuffer.length; i++) {
      const a = Math.abs(analyserBuffer[i]);
      if (a > peak) peak = a;
    }
    return peak;
  };

  return {
    peekLevel,
    recordTap: prev,
    ctx,
    setAmount: (id, value) => units[id]?.setAmount(Math.min(1, Math.max(0, value))),
    setSecondary: (id, value) => units[id]?.setSecondary?.(Math.min(1, Math.max(0, value))),
    resume: () => { if (ctx.state === 'suspended') void ctx.resume(); },
    // rampSeconds defaults fast (bringing a confirmed station in, or an explicit
    // pause). Pass a slower one to let a delay tail ring out and decay naturally
    // instead of cutting it off, e.g. when the station underneath it changes — the
    // effect nodes themselves keep decaying on their own once their input goes
    // quiet; this just avoids stepping on that by force-zeroing early.
    setActive: (active, rampSeconds = 0.03) => masterGain.gain.setTargetAtTime(active ? 1 : 0, ctx.currentTime, rampSeconds),
  };
}
