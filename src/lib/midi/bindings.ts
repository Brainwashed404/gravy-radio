// Button bindings for the transport style actions.
//
// The defaults are the documented mk2 note numbers. Anything that does not match this
// particular unit gets rebound through Learn mode in the MIDI panel and persisted, so
// a wrong default is a thirty second fix rather than a code change.

import { SCENE_BUTTON_NOTES, TRACK_BUTTON_NOTES, MASTER_FADER_CC } from './apcMiniMk2';

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
  | 'volume';

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
