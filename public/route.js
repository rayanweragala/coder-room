/**
 * Hash routes: `#/` (lobby), `#/p/<project>` (room), `#/p/<project>/focus/<tileId>` (full screen) and
 * `#/p/<project>/round/<id>` (replay of a past round); `?follow=0` pins the full-screen card, `?history=1` opens
 * the history panel. Pure.
 * @returns {{project: string|null, focus: string|null, follow: boolean, round?: string, history?: true}}
 */
export function parseRoute(hash) {
  const [path, query = ''] = String(hash || '').replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const follow = params.get('follow') !== '0';
  const history = params.get('history') === '1';
  const parts = path.split('/').filter(Boolean);
  try {
    if (parts[0] === 'p' && parts[1]) {
      const project = decodeURIComponent(parts[1]);
      const focus = parts[2] === 'focus' && parts[3] ? decodeURIComponent(parts[3]) : null;
      const round = parts[2] === 'round' && parts[3] ? decodeURIComponent(parts[3]) : null;
      return { project, focus, follow: round ? false : follow, ...(round && { round }), ...(history && { history }) };
    }
  } catch { /* malformed escape: fall back to the lobby */ }
  return { project: null, focus: null, follow: true };
}

export function routeHash({ project, focus = null, round = null, follow = true, history = false }) {
  if (!project) return '#/';
  const base = `#/p/${encodeURIComponent(project)}`;
  if (round) return `${base}/round/${encodeURIComponent(round)}${history ? '?history=1' : ''}`;
  const query = [!focus || follow ? null : 'follow=0', history ? 'history=1' : null].filter(Boolean).join('&');
  const path = focus ? `${base}/focus/${encodeURIComponent(focus)}` : base;
  return query ? `${path}?${query}` : path;
}

/** The project `step` places after `current` in `names` (wrapping); from the lobby, `[` goes last and `]` first. */
export function stepProject(names, current, step) {
  if (!names.length) return null;
  const i = names.indexOf(current);
  if (i < 0) return step > 0 ? names[0] : names.at(-1);
  return names[(i + step + names.length) % names.length];
}
