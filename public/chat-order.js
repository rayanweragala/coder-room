/** True when a chat row must be (re)inserted: it is not in the list yet, or the row before it is not the wanted one. */
export function needsPlace(connected, previousSibling, wantedPrev) {
  return !connected || previousSibling !== wantedPrev;
}
