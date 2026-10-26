import { pickNext, finishText, userBusy } from './follow.js';

const BANNER_MS = 4000;
const TOAST_MS = 2500;

/**
 * Follow mode for the full-screen card. `check()` runs on every tile update and clock tick; after a finish it
 * shows the banner (4 s), then the "Switching…" toast, then calls `switchTo`. A switch waits while the user is busy.
 */
export function createFollowMode({ getTiles, getCurrent, isActive, switchTo, setBanner, setToast }) {
  let following = true;
  let pending = null;
  let touched = null;

  function cancel() {
    pending = null;
    setBanner(null);
    setToast(null);
  }

  return {
    get following() { return following; },
    setFollowing(on) { following = on; cancel(); },
    touch(now = Date.now()) { touched = now; },
    cancel,
    check(now = Date.now()) {
      if (!following || !isActive()) { if (pending) cancel(); return; }
      const tiles = getTiles();
      const cur = getCurrent();
      const to = pickNext(tiles, cur);
      if (to === cur) { if (pending) cancel(); return; }
      if (!pending || pending.from !== cur) pending = { from: cur, since: now };
      const text = finishText(tiles.find((t) => t.id === cur));
      if (text) {
        setBanner(text);
        if (now - pending.since < BANNER_MS) return;
        setToast(`Switching to ${tiles.find((t) => t.id === to)?.name ?? to}…`);
        if (now - pending.since < BANNER_MS + TOAST_MS) return;
      }
      if (userBusy(touched, now)) return;
      cancel();
      switchTo(to);
    },
  };
}
