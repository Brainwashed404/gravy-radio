// Button bindings for the transport style actions.
//
// The defaults are the documented mk2 note numbers. Anything that does not match this
// particular unit gets rebound through Learn mode in the MIDI panel and persisted, so
// a wrong default is a thirty second fix rather than a code change.

import { SCENE_BUTTON_NOTES, TRACK_BUTTON_NOTES, TRACK_FADER_CCS, MASTER_FADER_CC } from './apcMiniMk2';
import type { EffectId } from '../audio/effects';

// Play/pause is not in this list: it lives on SHIFT (tap it to toggle), which is
// read specially before the generic bindings lookup rather than through a
// rebindable note, so there's nothing here for Learn mode to attach to.
export type MidiActionId =
  | 'fwd'
  | 'rwd'
  | 'shuffle'
  | 'favs'
  | 'favouriteCurrent'
  | 'index'
  | 'dark'
  | 'info'
  | 'closeViz'
  | 'fullscreenViz'
  | 'clearAll'
  | 'volume'
  | 'fxVinyl'
  | 'fxFilter'
  | 'fxBitcrush'
  | 'fxDistortion'
  | 'fxFlanger'
  | 'fxBeatRepeat'
  | 'fxDelay'
  | 'fxReverb';

export interface ActionMeta {
  id: MidiActionId;
  label: string;
  /** Where the default lives on the hardware, for the panel to show. */
  where: string;
  /** Volume wants a fader, everything else wants a button. */
  control: 'button' | 'fader';
}

export const ACTIONS: ActionMeta[] = [
  { id: 'info',              label: 'Info',            where: 'CLIP STOP',      control: 'button' },
  { id: 'dark',              label: 'Dark mode',       where: 'SOLO',           control: 'button' },
  { id: 'favs',              label: 'Favs mode',       where: 'MUTE',           control: 'button' },
  { id: 'index',             label: 'Station index',   where: 'REC ARM',        control: 'button' },
  { id: 'shuffle',           label: 'Shuffle / All',   where: 'SELECT',         control: 'button' },
  { id: 'rwd',               label: 'Rewind',          where: 'DRUM',           control: 'button' },
  { id: 'fwd',               label: 'Forward',         where: 'NOTE',           control: 'button' },
  { id: 'closeViz',          label: 'Exit visualiser', where: 'STOP ALL CLIPS', control: 'button' },
  { id: 'fullscreenViz',     label: 'Fullscreen viz',  where: 'VOLUME',         control: 'button' },
  { id: 'favouriteCurrent',  label: 'Heart station',   where: 'SEND',           control: 'button' },
  { id: 'clearAll',          label: 'Clear genre',     where: 'DEVICE',         control: 'button' },
  { id: 'volume',            label: 'Volume',          where: 'Master fader',   control: 'fader' },
  // The 8 track faders, one effect each, left to right in signal-chain order.
  { id: 'fxVinyl',           label: 'FX: Vinyl',       where: 'Fader 1',        control: 'fader' },
  { id: 'fxFilter',          label: 'FX: Filter',      where: 'Fader 2',        control: 'fader' },
  { id: 'fxBitcrush',        label: 'FX: Bitcrush',    where: 'Fader 3',        control: 'fader' },
  { id: 'fxDistortion',      label: 'FX: Distortion',  where: 'Fader 4',        control: 'fader' },
  { id: 'fxFlanger',         label: 'FX: Flanger',     where: 'Fader 5',        control: 'fader' },
  { id: 'fxBeatRepeat',      label: 'FX: Beat repeat', where: 'Fader 6',        control: 'fader' },
  { id: 'fxDelay',           label: 'FX: Delay',       where: 'Fader 7',        control: 'fader' },
  { id: 'fxReverb',          label: 'FX: Reverb',      where: 'Fader 8',        control: 'fader' },
];

export type Binding =
  | { kind: 'note'; note: number }
  | { kind: 'cc'; cc: number };

export const DEFAULT_BINDINGS: Record<MidiActionId, Binding> = {
  // Scene launch column, top to bottom: CLIP STOP, SOLO, MUTE, REC ARM, SELECT,
  // DRUM, NOTE, STOP ALL CLIPS. Play/pause moved to SHIFT, freeing SELECT, so
  // shuffle/rewind/forward each shifted up one slot to fill the gap.
  info:             { kind: 'note', note: SCENE_BUTTON_NOTES[0] },
  dark:             { kind: 'note', note: SCENE_BUTTON_NOTES[1] },
  favs:             { kind: 'note', note: SCENE_BUTTON_NOTES[2] },
  index:            { kind: 'note', note: SCENE_BUTTON_NOTES[3] },
  shuffle:          { kind: 'note', note: SCENE_BUTTON_NOTES[4] },
  rwd:              { kind: 'note', note: SCENE_BUTTON_NOTES[5] },
  fwd:              { kind: 'note', note: SCENE_BUTTON_NOTES[6] },
  closeViz:         { kind: 'note', note: SCENE_BUTTON_NOTES[7] },
  // Round track buttons: VOLUME PAN SEND DEVICE.
  fullscreenViz:    { kind: 'note', note: TRACK_BUTTON_NOTES[0] },
  favouriteCurrent: { kind: 'note', note: TRACK_BUTTON_NOTES[2] },
  clearAll:         { kind: 'note', note: TRACK_BUTTON_NOTES[3] },
  volume:           { kind: 'cc',   cc: MASTER_FADER_CC },
  // Track faders 1-8, same order as EFFECT_ORDER in lib/audio/effects.ts.
  fxVinyl:          { kind: 'cc', cc: TRACK_FADER_CCS[0] },
  fxFilter:         { kind: 'cc', cc: TRACK_FADER_CCS[1] },
  fxBitcrush:       { kind: 'cc', cc: TRACK_FADER_CCS[2] },
  fxDistortion:     { kind: 'cc', cc: TRACK_FADER_CCS[3] },
  fxFlanger:        { kind: 'cc', cc: TRACK_FADER_CCS[4] },
  fxBeatRepeat:     { kind: 'cc', cc: TRACK_FADER_CCS[5] },
  fxDelay:          { kind: 'cc', cc: TRACK_FADER_CCS[6] },
  fxReverb:         { kind: 'cc', cc: TRACK_FADER_CCS[7] },
};

/** MidiActionId -> EffectId for the 8 fx faders, so the dispatcher in App.tsx
 *  doesn't need to hand-maintain a second copy of this mapping. */
export const FX_ACTION_EFFECT: Partial<Record<MidiActionId, EffectId>> = {
  fxVinyl: 'vinyl',
  fxFilter: 'filter',
  fxBitcrush: 'bitcrush',
  fxDistortion: 'distortion',
  fxFlanger: 'flanger',
  fxBeatRepeat: 'beatRepeat',
  fxDelay: 'delay',
  fxReverb: 'reverb',
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
