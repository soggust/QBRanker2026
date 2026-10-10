// Names other people see (a username, a display name, a bio, a list's title): no slurs or obscenities, and no
// username that passes for the site's own (admin, Season Ranker). A deterrent, not a wall: the browser checks it
// (account-helpers.ts and lists-helpers.ts call it), the rules don't, so a report button can come later.
//
// Two lists, kept encoded so the source doesn't spell them out (base64 of comma-separated words):
// - ANYWHERE: words that are offensive inside any name ("xx_<word>_xx", "<word>123"), and rarely part of an
//   innocent one
// - WHOLE: words that are only offensive on their own: they hide inside ordinary names ("raccoon", "Dickson",
//   "class", "Sussex"), so they count only as a whole word of the name
// Both are matched past the usual disguises: case, accents, look-alike digits and symbols (n1gg3r, $hit), and a
// letter repeated (fuuuck).
const ANYWHERE = decode(
  'bmlnZ2VyLG5pZ2dhLG5pZ2dyLGZhZ2dvdCxmYWdnZXQsZmFnZ2l0LHRyYW5ueSx3ZXRiYWNrLHJhZ2hlYWQsdG93ZWxoZWFkLHJldGFyZCxjdW50LGZ1Y2ssbW90aGVyZix3aG9yZSxiaXRjaCxoaXRsZXIsa2trLGppenosZGlsZG8scG9ybg==',
);
const WHOLE = decode(
  'ZmFnLGZhZ3Msc3BpYyxzcGljcyxraWtlLGtpa2VzLGNoaW5rLGNoaW5rcyxjb29uLGNvb25zLGdvb2ssZ29va3MsZHlrZSxkeWtlcyxuYXppLG5hemlzLHJhcGUscmFwZWQscmFwaXN0LHBlZG8scGVkb3BoaWxlLHBhZWRvLGN1bSxjb2NrLGNvY2tzLGRpY2ssZGlja3MscHVzc3ksc2hpdCxzbHV0LHNsdXRzLHR3YXQsYXNzLGFzc2hvbGUsYXJzZSxwZW5pcyx2YWdpbmEsc2V4LHNleHksdGl0cyxib29icyxoZWlsLGppaGFkLG1vbGVzdA==',
);

// (usernames that pass for the site's staff or the site itself: these exactly, underscores and digits aside,
// or with the site's name anywhere in them)
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'mods', 'support', 'help', 'official', 'staff', 'system', 'root', 'owner']);
const SITE_NAMES = ['seasonranker', 'qbranker'];

function decode(base64: string): string[] {
  return atob(base64).split(',');
}

// (look-alikes read as the letters they stand for)
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

// (lowercase, accents off, look-alikes read as letters)
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LEET[c]);
}

// (a word as a pattern any of its letters may repeat in: "fuck" matches "fuuuck")
const stretch = (word: string) => [...word].map((c) => `${c}+`).join('');
const ANYWHERE_RE = new RegExp(ANYWHERE.map(stretch).join('|'));
const WHOLE_RE = new RegExp(`^(?:${WHOLE.map(stretch).join('|')})$`);

// The name's words: split at spaces, punctuation and underscores, and where a capital starts a word
// (BigDick); each word as typed with its look-alikes read as letters, and with its digits as breaks too ("dick69")
function words(text: string): string[] {
  const parts = text.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}@$!|]+/u);
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    out.push(plain(part).replace(/[^a-z]/g, ''));
    for (const piece of part.split(/[\d@$!|]+/)) if (piece) out.push(plain(piece).replace(/[^a-z]/g, ''));
  }
  return out.filter(Boolean);
}

// Whether a name or text has a slur or obscenity in it
export function isOffensive(text: string): boolean {
  if (!text) return false;
  const squeezed = plain(text).replace(/[^a-z]/g, '');
  if (ANYWHERE_RE.test(squeezed)) return true;
  return words(text).some((w) => WHOLE_RE.test(w));
}

// Whether a username passes for the site's own staff or the site itself
export function isReservedUsername(name: string): boolean {
  const bare = name.toLowerCase().replace(/[_\d]/g, '');
  return RESERVED.has(bare) || SITE_NAMES.some((s) => bare.includes(s));
}
