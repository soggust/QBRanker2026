// Wikipedia for the Team tab's Coaches panel (the NBA's and MLB's scripts/build-coaches.mjs): pages'
// wikitext, 50 a request, and a wiki line as plain text. Free.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const API = 'https://en.wikipedia.org/w/api.php';
const AGENT = 'QBRanker/1.0 (data build)';

// Pages' wikitext by the title asked for (redirects followed)
export async function wikitext(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`;
    // (rate limited: wait and ask again, longer each time)
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { headers: { 'User-Agent': AGENT } });
      if (res.status !== 429 || attempt >= 5) break;
      await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** attempt));
    }
    if (!res.ok) throw new Error(`wikipedia: ${res.status}`);
    // (a breath between requests)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const json = await res.json();
    const back = new Map(batch.map((t) => [t, t]));
    for (const n of json.query.normalized ?? []) back.set(n.to, back.get(n.from) ?? n.from);
    for (const r of json.query.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
    for (const page of json.query.pages) {
      const text = page.revisions?.[0]?.slots?.main?.content;
      if (text) out.set(back.get(page.title) ?? page.title, text);
    }
  }
  return out;
}

// A wiki line as plain text: links to their words, refs, notes and templates gone
export function plain(s) {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{(?:small|nowrap)\|([^{}]*)\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A template parameter's value ("| head_coach = ..." up to the next parameter or the template's end)
export function param(text, name) {
  const m = text.match(new RegExp(`\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[\\w ]+=|\\n\\}\\})`, 'i'));
  return m ? m[1] : null;
}

// "2001-2025" -> [2001, ..., 2025]
export function seasonRange(arg, fallback) {
  if (!arg) return [fallback];
  const [a, b] = arg.split('-').map(Number);
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
}

// The sport's season in the data, from its update-data.mjs (the one scripts/rollover.mjs bumps)
export function currentSeason(appDir) {
  const text = readFileSync(path.join(appDir, 'scripts', 'update-data.mjs'), 'utf8');
  const season = Number(text.match(/^const CURRENT_SEASON = (\d+);/m)?.[1]);
  if (!season) throw new Error(`no CURRENT_SEASON in ${appDir}/scripts/update-data.mjs`);
  return season;
}
