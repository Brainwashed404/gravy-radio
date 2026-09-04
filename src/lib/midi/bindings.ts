// Button bindings for the transport style actions.
//
// The defaults are the documented mk2 note numbers. Anything that does not match this
// particular unit gets rebound through Learn mode in the MIDI panel and persisted, so
// a wrong default is a thirty second fix rather than a code change.

import { SCENE_BUTTON_NOTES, TRACK_BUTTON_NOTES, TRACK_FADER_CCS, MASTER_FADER_CC } from './apcMiniMk2';
import type { EffectId } from '../audio/effects';

export type MidiActionId =
  | 'fwd'
  | 'rwd'
  | 'favs'
  | 'shuffle'
  | 'index'
  | 'dark'
  | 'playPause'
  | 'cyclePadView'
  | 'cycleVisualisation'
  | 'clearAll'
  | 'clearAllLoops'
  | 'muteLoops'
  | 'soloLoops'
  | 'exportLoops'
  | 'nextGenre'
  | 'prevGenre'
  | 'volume'
  | 'fxFilter'
  | 'fxPhaserFlanger'
  | 'fxReverb'
  | 'fxBeatRepeat'
  | 'fxStutter'
  | 'fxPingPongDelay'
  | 'fxDubDelay'
  | 'fxDubDelayFeedback';

export interface ActionMeta {
  id: MidiActionId;
  label: string;
  /** Where the default lives on the hardware, for the panel to show. */
  where: string;
  /** Volume wants a fader, everything else wants a button. */
  control: 'button' | 'fader';
}

export const ACTIONS: ActionMeta[] = [
  // Soft keys (Scene Launch column, top to bottom).
  { id: 'cyclePadView',      label: 'Cycle screen (pad / visualiser)', where: 'CLIP STOP',   control: 'button' },
  { id: 'cycleVisualisation', label: 'Cycle visualiser pattern',    where: 'SOLO',           control: 'button' },
  { id: 'dark',              label: 'Dark mode',                    where: 'MUTE',           control: 'button' },
  { id: 'clearAll',          label: 'Clear genre',                  where: 'REC ARM',        control: 'button' },
  { id: 'index',             label: 'Station index (press again to close)', where: 'SELECT', control: 'button' },
  { id: 'favs',              label: 'Favs mode',                    where: 'DRUM',           control: 'button' },
  { id: 'shuffle',           label: 'Shuffle / All',                where: 'NOTE',           control: 'button' },
  { id: 'playPause',         label: 'Play / pause',                 where: 'STOP ALL CLIPS', control: 'button' },
  // Round track button row: now four loop-workflow buttons, then the arrows.
  { id: 'clearAllLoops',     label: 'Clear all loops',              where: 'VOLUME',         control: 'button' },
  { id: 'muteLoops',         label: 'Mute loops',                   where: 'PAN',            control: 'button' },
  { id: 'exportLoops',       label: 'Open loop bank (press again to close)', where: 'SEND',   control: 'button' },
  { id: 'soloLoops',         label: 'Solo loops (mute radio)',      where: 'DEVICE',         control: 'button' },
  { id: 'prevGenre',         label: 'Previous genre',               where: '▲ (up)',    control: 'button' },
  { id: 'nextGenre',         label: 'Next genre',                   where: '▼ (down)',  control: 'button' },
  { id: 'rwd',               label: 'Rewind',                       where: '◄ (left)',  control: 'button' },
  { id: 'fwd',               label: 'Forward',                      where: '► (right)', control: 'button' },
  { id: 'volume',            label: 'Volume',                       where: 'Master fader',   control: 'fader' },
  // Faders 1-8, one effect each, left to right in signal-chain order. Fader 8 is
  // a shared second parameter on both delays (their feedback), not a new
  // standalone effect. Phaser and flanger share fader 2 (bypass dead centre,
  // phaser sweeps in below it, flanger above). Holding SHIFT turns all 8 of
  // these into a second bank instead: per-loop volume for up to 8 loops at
  // once, matched by physical position (fader 1 = the first loop to grab a
  // slot, and so on) rather than through this rebindable action list - see
  // TRACK_FADER_CCS and useMidiSurface's SHIFT handling.
  { id: 'fxFilter',          label: 'FX: Filter',              where: 'Fader 1', control: 'fader' },
  { id: 'fxPhaserFlanger',   label: 'FX: Phaser / Flanger',     where: 'Fader 2', control: 'fader' },
  { id: 'fxStutter',         label: 'FX: Stutter',             where: 'Fader 3', control: 'fader' },
  { id: 'fxBeatRepeat',      label: 'FX: Beat repeat',          where: 'Fader 4', control: 'fader' },
  { id: 'fxReverb',          label: 'FX: Reverb',              where: 'Fader 5', control: 'fader' },
  { id: 'fxPingPongDelay',   label: 'FX: Ping pong delay',     where: 'Fader 6', control: 'fader' },
  { id: 'fxDubDelay',        label: 'FX: Dub delay',           where: 'Fader 7', control: 'fader' },
  { id: 'fxDubDelayFeedback', label: 'FX: Both delays feedback', where: 'Fader 8', control: 'fader' },
];

export type Binding =
  | { kind: 'note'; note: number }
  | { kind: 'cc'; cc: number };

export const DEFAULT_BINDINGS: Record<MidiActionId, Binding> = {
  // Scene launch column, top to bottom: CLIP STOP, SOLO, MUTE, REC ARM, SELECT,
  // DRUM, NOTE, STOP ALL CLIPS. All 8 spoken for now - a third remap: Info lost
  // its hardware button entirely (on-screen only from here, same as hearting a
  // station already was), which freed up a slot for Shuffle/All to finally get
  // one.
  cyclePadView:      { kind: 'note', note: SCENE_BUTTON_NOTES[0] },
  cycleVisualisation: { kind: 'note', note: SCENE_BUTTON_NOTES[1] },
  dark:              { kind: 'note', note: SCENE_BUTTON_NOTES[2] },
  clearAll:          { kind: 'note', note: SCENE_BUTTON_NOTES[3] },
  index:             { kind: 'note', note: SCENE_BUTTON_NOTES[4] },
  favs:              { kind: 'note', note: SCENE_BUTTON_NOTES[5] },
  shuffle:           { kind: 'note', note: SCENE_BUTTON_NOTES[6] },
  playPause:         { kind: 'note', note: SCENE_BUTTON_NOTES[7] },
  // Round track button row: VOLUME PAN SEND DEVICE (loop-workflow buttons), then
  // the arrows (▲▼◄►). SEND/DEVICE swapped from their first pass (solo loops <->
  // open loop bank panel).
  clearAllLoops:     { kind: 'note', note: TRACK_BUTTON_NOTES[0] },
  muteLoops:         { kind: 'note', note: TRACK_BUTTON_NOTES[1] },
  exportLoops:       { kind: 'note', note: TRACK_BUTTON_NOTES[2] },
  soloLoops:         { kind: 'note', note: TRACK_BUTTON_NOTES[3] },
  prevGenre:         { kind: 'note', note: TRACK_BUTTON_NOTES[4] },
  nextGenre:         { kind: 'note', note: TRACK_BUTTON_NOTES[5] },
  rwd:               { kind: 'note', note: TRACK_BUTTON_NOTES[6] },
  fwd:               { kind: 'note', note: TRACK_BUTTON_NOTES[7] },
  volume:            { kind: 'cc',   cc: MASTER_FADER_CC },
  // Faders 1-7, same order as EFFECT_ORDER in lib/audio/effects.ts. Fader 8 is
  // both delays' shared feedback, not a separate effect.
  fxFilter:          { kind: 'cc', cc: TRACK_FADER_CCS[0] },
  fxPhaserFlanger:   { kind: 'cc', cc: TRACK_FADER_CCS[1] },
  fxStutter:         { kind: 'cc', cc: TRACK_FADER_CCS[2] },
  fxBeatRepeat:      { kind: 'cc', cc: TRACK_FADER_CCS[3] },
  fxReverb:          { kind: 'cc', cc: TRACK_FADER_CCS[4] },
  fxPingPongDelay:   { kind: 'cc', cc: TRACK_FADER_CCS[5] },
  fxDubDelay:        { kind: 'cc', cc: TRACK_FADER_CCS[6] },
  fxDubDelayFeedback: { kind: 'cc', cc: TRACK_FADER_CCS[7] },
};

/** MidiActionId -> EffectId for the fx faders, so the dispatcher in App.tsx
 *  doesn't need to hand-maintain a second copy of this mapping. */
export const FX_ACTION_EFFECT: Partial<Record<MidiActionId, EffectId>> = {
  fxFilter: 'filter',
  fxPhaserFlanger: 'phaserFlanger',
  fxReverb: 'reverb',
  fxBeatRepeat: 'beatRepeat',
  fxStutter: 'stutter',
  fxPingPongDelay: 'pingPongDelay',
  fxDubDelay: 'dubDelay',
};

/** Same idea as FX_ACTION_EFFECT, for faders that drive one or more effects'
 *  secondary parameter (setSecondary) rather than their main amount. An array
 *  because fader 8 drives both delays' feedback at once, not just dub delay's -
 *  there's only the one physical fader for it, not two. */
export const FX_SECONDARY_ACTION_EFFECT: Partial<Record<MidiActionId, EffectId[]>> = {
  fxDubDelayFeedback: ['dubDelay', 'pingPongDelay'],
};

const STORAGE_KEY = 'lucky-breaks-midi-bindings';

export function loadBindings(): Record<MidiActionId, Binding> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    return { ...DEFAULT_BINDINGS, ...(JSON.parse(raw) as Record<MidiActionId, Binding>) };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: Record<MidiActionId, Binding>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {}
}

export function describeBinding(b: Binding): string {
  return b.kind === 'note' ? `Note ${b.note}` : `CC ${b.cc}`;
}
