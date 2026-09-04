import { useCallback, useEffect, useRef, useState } from 'react';
import type { Station } from '../data/stations';

const ENABLED_KEY = 'lucky-breaks-station-notifications';
/** How long the notification stays up before self-closing - a brief heads-up,
 *  not something meant to linger in the OS's notification centre. Browsers
 *  don't auto-dismiss on any guaranteed timeline of their own (varies by
 *  platform, some don't at all), so this is done explicitly rather than
 *  relying on that. */
const AUTO_CLOSE_MS = 6000;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Desktop notification for "what's playing now", specifically for when
 *  this isn't the window you're looking at - opt-in, off by default, since
 *  turning it on needs a real browser permission prompt and a notification
 *  firing on every skip would be intrusive for anyone who hasn't asked for
 *  it. Gated on document.hasFocus() rather than document.hidden: hidden
 *  only reflects minimised or switched-away-from-within-the-browser (tab
 *  changed, window minimised), not "visible but not the active window" -
 *  another app focused in front of it, or the window sitting on a different
 *  virtual desktop/Space, both leave hidden false even though the user
 *  isn't looking at it. hasFocus() covers all of those in one check. Fires
 *  once per station - the first one played in a session included, not just
 *  later changes. Self-closes after a few seconds (AUTO_CLOSE_MS) - a brief
 *  heads-up, not something meant to sit in the OS notification centre. */
export function useStationNotifications(currentStation: Station | null) {
  const [enabled, setEnabled] = useState(readEnabled);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const supported = typeof window !== 'undefined' && 'Notification' in window;

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (enabledRef.current) {
      setEnabled(false);
      try { localStorage.setItem(ENABLED_KEY, 'false'); } catch {}
      return;
    }
    // Turning on: permission has to come from this exact click - it's a real
    // gesture-gated browser prompt, can't be requested ahead of time or from
    // an effect. Already-denied can't be re-prompted from here at all; the
    // caller (the toggle's own UI) is responsible for explaining that rather
    // than this silently no-opping.
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return;
    setEnabled(true);
    try { localStorage.setItem(ENABLED_KEY, 'true'); } catch {}
  }, [supported]);

  const currentUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentStation) return;
    // Fires on the very first station picked in a session too, not just
    // later changes - only a genuine re-render with the SAME station
    // already current is skipped.
    if (currentUrlRef.current === currentStation.streamUrl) return;
    currentUrlRef.current = currentStation.streamUrl;
    if (!enabledRef.current || !supported || Notification.permission !== 'granted') return;
    if (document.hasFocus()) return; // this window is the one you're actually looking at right now

    try {
      const n = new Notification(currentStation.name, {
        body: currentStation.description || 'Now playing on Lucky Breaks',
        icon: '/icons/icon-192.png',
        tag: 'lucky-breaks-now-playing', // replaces the last one instead of stacking up
        silent: true, // visibility only - not a second alert sound on top of the station itself
      });
      n.onclick = () => { window.focus(); n.close(); };
      const closeTimer = setTimeout(() => n.close(), AUTO_CLOSE_MS);
      n.onclose = () => clearTimeout(closeTimer);
    } catch {
      // Notification can throw in some contexts (e.g. iOS Safari, which
      // doesn't support it in a regular tab at all) - nothing to recover,
      // just don't crash the station-change handler over it.
    }
  }, [currentStation, supported]);

  return { enabled, toggle, supported, permission: supported ? Notification.permission : 'denied' as NotificationPermission };
}
