// Model names shown on agents. Pure helpers shared by server and page.

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** The more specific of two model names: a full id (`claude-sonnet-5-5`) beats an alias (`sonnet`) it contains. */
export function bestModel(logged, chain) {
  if (!logged) return chain || null;
  if (!chain) return logged;
  const a = norm(logged);
  const b = norm(chain);
  return b.length > a.length && b.includes(a) ? chain : logged;
}

/** Model text to show beside an agent name: '' when absent or when the name already is the model. */
export function modelShown(name, model) {
  if (!model) return '';
  return norm(name) === norm(model) ? '' : model;
}
