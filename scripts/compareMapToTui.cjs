const fs = require('fs');
const path = require('path');

const mapLines = fs.readFileSync('.firecrawl/bbr-map-full.txt', 'utf8').split(/\r?\n/).filter(Boolean);
const depth = JSON.parse(fs.readFileSync('.firecrawl/bbr-depth-index.json', 'utf8'));

function sectionOf(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean);
    return p[0] || 'root';
  } catch {
    return 'invalid';
  }
}

function playerSubpageType(url) {
  const m = url.match(/\/players\/[a-z]\/[a-z0-9]+\/([^/?#]+)/);
  if (!m) {
    return null;
  }
  const seg = m[1];
  if (/^\d{4}$/.test(seg)) {
    return null;
  }
  return seg.replace(/\/$/, '');
}

const bySection = {};
const playerSubpages = {};
let playerProfiles = 0;

for (const url of mapLines) {
  const sec = sectionOf(url);
  bySection[sec] = (bySection[sec] || 0) + 1;
  if (sec === 'players') {
    const sub = playerSubpageType(url);
    if (!sub) {
      if (/\/players\/[a-z]\/[a-z0-9]+\.html/.test(url)) {
        playerProfiles++;
      }
    } else {
      playerSubpages[sub] = (playerSubpages[sub] || 0) + 1;
    }
  }
}

const sortedSections = Object.entries(bySection).sort((a, b) => b[1] - a[1]);

function walkJson(dir, base, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkJson(p, base, out);
    } else if (e.name.endsWith('.json')) {
      out.push(
        p
          .slice(base.length + 1)
          .replace(/\\/g, '/')
          .replace(/\.json$/, ''),
      );
    }
  }
  return out;
}

const mirrored = walkJson('bbr-screenshots', 'bbr-screenshots');
const mirroredSections = new Set(mirrored.map((r) => r.split('/')[0]));

const tuiPlayerTypes = [
  'profile',
  'gamelog',
  'gamelog-advanced',
  'gamelog-playoffs',
  'gamelog-playoffs-advanced',
  'splits',
  'shooting',
  'lineups',
  'on-off',
];
const tuiSiteShortcuts = 25;
const tuiTeamModes = 11;
const tuiFixed = tuiPlayerTypes.length + tuiSiteShortcuts + tuiTeamModes;

const mapSections = new Set(sortedSections.map(([s]) => s));
const tuiShortcutSections = [
  'players',
  'teams',
  'leaders',
  'leagues',
  'boxscores',
  'playoffs',
  'draft',
  'allstar',
  'awards',
  'contracts',
  'coaches',
  'executives',
  'referees',
  'friv',
  'gleague',
  'international',
  'nbl',
  'wnba',
  'stathead',
  'tools',
  'play-index',
  'about',
];

const mapRel = new Set(
  mapLines
    .map((u) => {
      try {
        let rel = new URL(u).pathname.replace(/^\//, '').replace(/\/$/, '');
        if (!rel.endsWith('.html') && !rel.includes('.')) {
          rel = `${rel}/index.html`;
        }
        return rel;
      } catch {
        return null;
      }
    })
    .filter(Boolean),
);

const mirroredInMap = mirrored.filter((r) => mapRel.has(r));
const mapPlayerTypes = new Set(Object.keys(playerSubpages));

const report = {
  map: {
    totalUrls: mapLines.length,
    depthHistogram: depth.byDepth || depth,
    bySection: Object.fromEntries(sortedSections),
    playerProfiles,
    playerSubpageTypes: Object.keys(playerSubpages).length,
    topPlayerSubpages: Object.entries(playerSubpages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([type, count]) => ({ type, count })),
  },
  tui: {
    playerSubpageTemplates: tuiPlayerTypes.length,
    siteKeyboardShortcuts: tuiSiteShortcuts,
    teamSubpageModes: tuiTeamModes,
    fixedEntryPoints: tuiFixed,
    mirroredOfflinePages: mirrored.length,
    mirroredSections: mirroredSections.size,
    dynamicPlayerPages: `${playerProfiles} profiles × ${tuiPlayerTypes.length} subpage types`,
  },
  coverage: {
    mapSections: mapSections.size,
    shortcutSectionsInMap: tuiShortcutSections.filter((s) => mapSections.has(s)),
    shortcutSectionsOutsideMapScope: tuiShortcutSections.filter((s) => !mapSections.has(s)),
    playerSubpageTypesInMap: tuiPlayerTypes.filter(
      (t) => t === 'profile' || mapPlayerTypes.has(t),
    ),
    playerSubpageTypesMissingFromMap: tuiPlayerTypes.filter(
      (t) => t !== 'profile' && !mapPlayerTypes.has(t),
    ),
    mapPlayerTypesNotInTui: Object.keys(playerSubpages)
      .filter((t) => !tuiPlayerTypes.includes(t))
      .slice(0, 20),
    mirroredPagesInMap: mirroredInMap.length,
    mirroredPagesTotal: mirrored.length,
    mapUrlsWithOfflineMirror: [...mapRel].filter((r) => mirrored.includes(r)).length,
    staticMirrorPctOfMap: Number(((mirrored.length / mapLines.length) * 100).toFixed(1)),
    offlineMirrorOverlapPct: Number(
      ((mirroredInMap.length / mirrored.length) * 100).toFixed(1),
    ),
  },
};

console.log(JSON.stringify(report, null, 2));
