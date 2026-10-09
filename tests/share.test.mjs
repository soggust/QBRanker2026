// Share links (libs/ranker/src/engine/share.ts): what a list's link carries comes back the same when
// the link is opened, and a list at its defaults links without ?list= at all. Run against the real
// PositionService of each sport, under a stand-in page address (location / history).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPORTS, loadEngine } from './support/engine.mjs';

// (the page address the services read and rewrite)
function setAddress(href) {
  globalThis.location = new URL(href);
}
globalThis.history = { replaceState: (_state, _title, url) => setAddress(String(url)) };
// (no server: a season's playoffs check finds none)
globalThis.fetch = async () => {
  throw new Error('no network in tests');
};

const COLUMNS = ['Søren', '名前', 'x/y+z=', '?????', '~~~~~'];

// ?list= as share.ts writes it: JSON as URL-safe base64
const decodeList = (code) => {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
};

// Everything a link is meant to carry, read back from a service
function snapshot(service, engine) {
  const { POSITIONS } = engine;
  return {
    weights: Object.fromEntries(POSITIONS.map((p) => [p, service.getWeights(p)])),
    hidden: Object.fromEntries(Object.entries(service.statHiddenState).filter(([, off]) => off)),
    groups: Object.fromEntries(
      POSITIONS.map((p) => [p, Object.keys(service.skillHiddenGroups(p)).filter((id) => service.skillHiddenGroups(p)[id])]),
    ),
    settings: service.settings,
    layout: service.layout,
  };
}

for (const sport of SPORTS) {
  test(`${sport}: a share link round-trips the list, and the defaults link bare`, async () => {
    const page = `https://ranker.test/${sport}/?season=2025&pos=X`;
    setAddress(page);
    const engine = await loadEngine(sport);
    const { PositionService, POSITIONS, SPORT, DEFAULT_SETTINGS, presetWeights, skillGroups, SKILL_STATS } = engine;

    // At its defaults the link is the page's address, no ?list=
    const fresh = new PositionService();
    const bare = new URL(fresh.shareLink());
    assert.equal(bare.searchParams.has('list'), false, 'a list at its defaults got ?list=');
    assert.equal(bare.searchParams.get('pos'), 'X');

    // A list changed every way a link carries
    const a = new PositionService();
    const tabs = POSITIONS.filter((p) => SKILL_STATS[p]?.length);
    const [first, second = first] = tabs;
    const changedWeights = {};
    for (const position of tabs.slice(0, 3)) {
      const base = presetWeights(position, 'default');
      const keys = Object.keys(base).slice(0, 2);
      const next = { ...base, ...Object.fromEntries(keys.map((k) => [k, base[k] === 73 ? 12 : 73])) };
      a.saveWeights(position, next);
      changedWeights[position] = Object.fromEntries(keys.map((k) => [k, next[k]]));
    }
    a.setStatHidden(first, SKILL_STATS[first][0].key, true);
    const group = skillGroups(second)[0].id;
    a.setSkillGroupHidden(second, group, true);
    const settingChanges = {
      minShare: 50,
      minCount: 3,
      combineStats: !DEFAULT_SETTINGS.combineStats,
      showRanks: !DEFAULT_SETTINGS.showRanks,
      statBasis: DEFAULT_SETTINGS.statBasis === 'perGame' ? 'season' : 'perGame',
    };
    a.updateSettings(settingChanges);
    for (const setting of SPORT.settings ?? []) a.stepSportSetting(setting.key);
    a.setUnitOrder(first, ['row-b', 'row-a'], true);
    a.toggleGroupCollapsed(first, group);
    // (unicode, and runs of ? and ~, whose base64 has / and +: the link must carry them URL-safe)
    a.setColumnOrder(`${first}.box`, COLUMNS);
    a.setGroupOrder(second, ['support', 'advanced', 'box', 'results']);

    const link = new URL(a.shareLink());
    const code = link.searchParams.get('list');
    assert.ok(code, 'a changed list linked without ?list=');
    assert.match(code, /^[A-Za-z0-9_-]+$/, '?list= is not URL-safe base64');
    assert.match(code, /-/);
    assert.match(code, /_/);

    // Only what differs from the defaults is in it
    const shared = decodeList(code);
    assert.equal(shared.v, 1);
    assert.deepEqual(shared.w, changedWeights);
    assert.deepEqual(shared.s, settingChanges);
    assert.deepEqual(shared.h, [`${first}.${SKILL_STATS[first][0].key}`]);
    assert.deepEqual(shared.g, { [second]: [group] });
    assert.deepEqual(Object.keys(shared.sp ?? {}).sort(), (SPORT.settings ?? []).map((s) => s.key).sort());
    assert.deepEqual(shared.o, { [first]: ['row-b', 'row-a'] });
    assert.deepEqual(shared.c, { [first]: [group] });
    assert.deepEqual(shared.k, { [`${first}.box`]: COLUMNS });
    assert.deepEqual(shared.go, { [second]: ['support', 'advanced', 'box', 'results'] });

    // Opened: the same list, and ?list= gone from the address (the rest of it kept)
    setAddress(link.href);
    const b = new PositionService();
    assert.deepEqual(snapshot(b, engine), snapshot(a, engine));
    assert.equal(new URL(location.href).searchParams.has('list'), false, '?list= left in the address');
    assert.equal(new URL(location.href).searchParams.get('pos'), 'X');
    // ...and its own link is the same one
    assert.equal(new URL(b.shareLink()).searchParams.get('list'), code);

    // A broken or foreign ?list= is ignored, not thrown on
    for (const junk of ['%%%', 'bm90IGpzb24', btoa(JSON.stringify({ v: 2, s: { minShare: 90 } }))]) {
      setAddress(`${page}&list=${junk}`);
      const c = new PositionService();
      assert.deepEqual(c.settings, fresh.settings);
    }
    // ...and so are values of the wrong kind or for tabs the site doesn't have
    const odd = { v: 1, w: { NOPE: { a: 1 }, [first]: { [Object.keys(presetWeights(first, 'default'))[0]]: 500 } }, s: { minShare: 'lots', bogus: 1 } };
    setAddress(`${page}&list=${btoa(JSON.stringify(odd)).replace(/=+$/, '')}`);
    const d = new PositionService();
    assert.deepEqual(snapshot(d, engine).weights, snapshot(fresh, engine).weights);
    assert.deepEqual(d.settings, fresh.settings);
  });
}

// Compare links (?cmp=): each side as tab.season.id, "_" between, the compare tab first unless it's Overview;
// read back, only the tabs and seasons the site has, each side once, and junk reads as nobody
test('nfl: a compare code round-trips its sides and tab, and junk reads as nobody', async () => {
  setAddress('https://ranker.test/nfl/');
  const { compareCode, readCompareCode, SEASONS } = await loadEngine('nfl');
  const [now, then] = [SEASONS[0], SEASONS.at(-1)];
  // (ids with dashes, dots, spaces and the very marks the code uses)
  const sides = [
    { position: 'QB', season: then, gsisId: 'QB-1428' },
    { position: 'RB', season: now, gsisId: '00-0011869' },
    { position: 'HC', season: now, gsisId: 'HC-A.J. Smith' },
    { position: 'WR', season: then, gsisId: 'odd_id%2F~here' },
  ];
  for (const tab of ['overview', 'stats', 'career']) {
    const code = compareCode({ sides, tab });
    assert.equal(code.startsWith('QB.'), tab === 'overview', `${tab}: the tab first unless it's Overview`);
    assert.deepEqual(readCompareCode(code, SEASONS), { sides, tab });
    // (and through an address, as a link carries it)
    const url = new URL('https://ranker.test/nfl/');
    url.searchParams.set('cmp', code);
    assert.deepEqual(readCompareCode(new URL(url.href).searchParams.get('cmp'), SEASONS), { sides, tab });
  }
  assert.equal(compareCode({ sides: sides.slice(0, 2), tab: 'stats' }), `stats_QB.${then}.QB-1428_RB.${now}.00-0011869`);

  // (junk: nobody, on Overview)
  for (const junk of ['', '_', '___', 'QB', 'QB.', 'QB.abc.x', 'QB..x', '.2020.x', '%%%', 'QB.2020']) {
    assert.deepEqual(readCompareCode(junk, SEASONS).sides, [], `"${junk}"`);
  }
  // (a tab or season the site hasn't, an id that won't decode, a side twice: left out, the rest kept)
  const kept = `QB.${now}.QB-1`;
  const code = [`stats`, `NOPE.${now}.x`, `QB.${SEASONS.at(-1) - 1}.QB-2`, `QB.${now + 1}.QB-3`, `QB.${now}.bad%E0%A4`, kept, kept, `QB.${now}.x`].join('_');
  assert.deepEqual(readCompareCode(code, SEASONS), {
    sides: [
      { position: 'QB', season: now, gsisId: 'QB-1' },
      { position: 'QB', season: now, gsisId: 'x' },
    ],
    tab: 'stats',
  });
  // (only the first item can be the tab)
  assert.equal(readCompareCode(`${kept}_stats`, SEASONS).tab, 'overview');
});

test('nfl: a compare link carries the list too, and opening it hands the grid the comparison once', async () => {
  const page = 'https://ranker.test/nfl/?pos=RB';
  setAddress(page);
  const { PositionService, SEASONS, presetWeights } = await loadEngine('nfl');
  const a = new PositionService();
  const base = presetWeights('RB', 'default');
  const key = Object.keys(base)[0];
  a.saveWeights('RB', { ...base, [key]: base[key] === 73 ? 12 : 73 });
  const sides = [
    { position: 'RB', season: SEASONS[1], gsisId: '00-0011869' },
    { position: 'QB', season: SEASONS[0], gsisId: 'QB-1428' },
  ];
  const link = new URL(a.compareLink(sides, 'career'));
  assert.ok(link.searchParams.get('list'), 'the sliders with it');
  assert.equal(link.searchParams.get('pos'), 'RB');
  assert.match(link.search, /[?&]cmp=career_RB\.\d+\.00-0011869_QB\.\d+\.QB-1428(&|$)/, 'the address carries it as it is');
  assert.equal(link.searchParams.get('cmp'), `career_RB.${SEASONS[1]}.00-0011869_QB.${SEASONS[0]}.QB-1428`);
  assert.equal(new URL(location.href).searchParams.has('cmp'), false, 'making the link leaves the address alone');

  setAddress(link.href);
  const b = new PositionService();
  assert.deepEqual(b.getWeights('RB'), a.getWeights('RB'));
  assert.equal(new URL(location.href).searchParams.has('cmp'), false, '?cmp= left in the address');
  assert.deepEqual(b.takePendingCompare(), { sides, tab: 'career' });
  assert.equal(b.takePendingCompare(), null, 'once');

  // (none in the address: nothing pending; junk: nobody, still opened)
  setAddress(page);
  assert.equal(new PositionService().takePendingCompare(), null);
  setAddress(`${page}&cmp=%%junk`);
  assert.deepEqual(new PositionService().takePendingCompare(), { sides: [], tab: '%%junk' });
});
