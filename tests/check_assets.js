#!/usr/bin/env node
/*
 * The service worker's cache name and precache list are duplicated inside
 * voyage_manager.html (androidInstallCacheName / androidInstallAssets), which drives the
 * Android install progress UI. They are edited by hand on every release, so they drift:
 * a stale cache name leaves phones on the previous build after an update. Check they
 * still agree, and that every precached path exists.
 *
 * Run: node tests/check_assets.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(REPO_ROOT, 'voyage_manager.html'), 'utf8');

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
}

function matchOrDie(source, re, what) {
  const m = source.match(re);
  if (!m) {
    console.log(`  FAIL could not find ${what} — update tests/check_assets.js if it was renamed`);
    failures.push(what);
    return null;
  }
  return m[1];
}

const swCache = matchOrDie(sw, /const CACHE = '([^']+)'/, 'CACHE in sw.js');
const htmlCache = matchOrDie(html, /androidInstallCacheName = '([^']+)'/, 'androidInstallCacheName in voyage_manager.html');
if (swCache && htmlCache) {
  check('app cache name matches the service worker cache name', htmlCache, swCache);
}

function parsePathList(source, re, what) {
  const raw = matchOrDie(source, re, what);
  if (raw === null) return null;
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const precache = parsePathList(sw, /const PRECACHE = \[([\s\S]*?)\]/, 'PRECACHE in sw.js');
const installAssets = parsePathList(html, /androidInstallAssets = \[([\s\S]*?)\]/, 'androidInstallAssets in voyage_manager.html');
if (precache && installAssets) {
  check('Android install asset list matches the service worker precache list', installAssets, precache);
}

for (const rel of precache || []) {
  checked += 1;
  const full = path.join(REPO_ROOT, rel);
  if (fs.existsSync(full)) {
    console.log(`  ok   precached ${rel} exists`);
  } else {
    console.log(`  FAIL precached ${rel} does not exist`);
    failures.push(`precached ${rel}`);
  }
}

/*
 * The pages a vessel can reach are listed three times by hand: the desktop tab bar,
 * the mobile bottom nav plus its "More" sheet, and BOTTOM_NAV_MORE (which decides
 * whether the More button lights up). A page added to the tab bar alone is simply
 * unreachable on a phone, which is how Range Totals shipped invisible to the crew.
 */
{
  const pagesIn = (re) => {
    const out = [];
    let m;
    const rx = new RegExp(re.source, 'g');
    while ((m = rx.exec(html)) !== null) out.push(m[1]);
    return out;
  };
  const tabs = pagesIn(/class="tab(?: active)?" data-page="([^"]+)"/);
  const barItems = pagesIn(/class="bn-item(?: active)?" data-page="([^"]+)"/);
  const moreItems = pagesIn(/class="bn-more-item" data-page="([^"]+)"/);
  const pageDivs = pagesIn(/<div class="page(?: active)?" id="page-([^"]+)"/);
  const moreSet = (html.match(/const BOTTOM_NAV_MORE = new Set\(\[([^\]]*)\]\)/) || [, ''])[1]
    .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  /* "more" opens the sheet rather than naming a page of its own. */
  const reachable = new Set([...barItems.filter(p => p !== 'more'), ...moreItems]);

  check('the tab bar is not empty', tabs.length > 0, true);
  check('every tab has a page to show', tabs.filter(p => !pageDivs.includes(p)), []);
  check('every tab is reachable on a phone', tabs.filter(p => !reachable.has(p)), []);
  check('the phone offers no page the tab bar lacks', [...reachable].filter(p => !tabs.includes(p)), []);
  check('BOTTOM_NAV_MORE lists exactly what the More sheet holds',
    moreSet.slice().sort(), moreItems.slice().sort());
  check('no page is listed twice in the tab bar', tabs.length, new Set(tabs).size);
  check('no page is offered twice on the phone', barItems.length + moreItems.length - 1, reachable.size);
}

/* Everything a package has to ship.
   The PC portable build hand-listed its files and had gone stale: it copied
   voyage_manager.html without eorb.js or ship_time.js, so every download 404'd on
   both and ran without the e-ORB module or the ship-time logic. The list is shared
   now; this asserts it stays honest about what the page actually loads. */
{
  const assets = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'app-assets.json'), 'utf8'));
  const html = fs.readFileSync(path.join(REPO_ROOT, 'voyage_manager.html'), 'utf8');

  const scripts = [...html.matchAll(/<script[^>]+src="\.?\/?([^"]+)"/g)].map(m => m[1]);
  const missing = scripts.filter(f => !assets.files.includes(f));
  check('every script the page loads is in the asset list', missing, []);

  const gone = assets.files.filter(f => !fs.existsSync(path.join(REPO_ROOT, f)));
  check('every file in the asset list exists', gone, []);
  const goneDirs = assets.dirs.filter(d => !fs.existsSync(path.join(REPO_ROOT, d)));
  check('every folder in the asset list exists', goneDirs, []);

  // The service worker precaches for offline use, so anything it names has to ship too.
  const swSrc = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
  const precached = [...swSrc.matchAll(/'\.\/([^']+)'/g)].map(m => m[1])
    .filter(f => !f.endsWith('/') && f !== 'index.html');
  const unshipped = precached.filter(f =>
    !assets.files.includes(f) && !assets.dirs.some(d => f.startsWith(d + '/')));
  check('every file the service worker precaches is in the asset list', unshipped, []);

  // The three packaging paths must read the list rather than name files themselves.
  const readsList = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').includes('app-assets.json');
  check('the www sync reads the shared list', readsList('scripts/sync-www.js'), true);
  check('the portable build reads the shared list', readsList('scripts/build-pc-portable.sh'), true);
  check('the Windows installer reads the shared list', readsList('scripts/build-windows-installer.sh'), true);
}

/* The author credit.
   It is defined twice — once in the app, once in eorb.js, which is a standalone
   module loaded on its own — so the two have to be held together the same way the
   service-worker cache name is, or a printed e-ORB page could credit one thing and
   the app window another. */
{
  const eorb = fs.readFileSync(path.join(REPO_ROOT, 'eorb.js'), 'utf8');

  const appAuthor = matchOrDie(html,
    /const APP_AUTHOR = \{ handle: '([^']+)', name: '([^']+)' \}/, 'APP_AUTHOR in voyage_manager.html');
  const appName = html.match(/const APP_AUTHOR = \{ handle: '[^']+', name: '([^']+)' \}/)[1];
  const orbAuthor = matchOrDie(eorb,
    /const AUTHOR = \{ handle: '([^']+)', name: '([^']+)' \}/, 'AUTHOR in eorb.js');
  const orbName = eorb.match(/const AUTHOR = \{ handle: '[^']+', name: '([^']+)' \}/)[1];

  check('the app and eorb.js credit the same handle', appAuthor, orbAuthor);
  check('the app and eorb.js credit the same name', appName, orbName);

  // Every surface that carries it. A credit that only reaches some of them is worse
  // than none: it reads as an oversight on whichever sheet is missing it.
  check('the masthead has a byline element', /id="appByline"/.test(html), true);
  check('the printed sheet footer carries it', /class="pr-foot pr-byline"/.test(html), true);
  check('the e-ORB book footer carries it', /orb-book-byline/.test(eorb), true);
  check('the document names its author', /<meta name="author"/.test(html), true);

  const nsi = fs.readFileSync(path.join(REPO_ROOT, 'install', 'windows', 'noonreport.nsi'), 'utf8');
  check('the installer names its publisher', nsi.includes(appName), true);
}

/* What the program is called, on every surface that spells it out.

   The name is written out literally in the static title, the masthead and the login
   card so it is correct before a line of script runs, and again in the manifest, the
   Capacitor config, the Android strings and the installer — each of which is read by
   a different build and cannot reference the others. Six copies of a name drift; the
   program was called "Noon Report" in the window long after that stopped being what
   it was. Hold them all to the one constant.

   Deliberately not checked, because they must NOT follow the name: noonReportDB and
   the localStorage keys, the noon-report-*-v1 backup and export formats, the
   noon-report-v cache prefix, and the Android applicationId. Those are identifiers
   that existing installs are already keyed to. */
{
  const appName = matchOrDie(html, /const APP_NAME = '([^']+)'/, 'APP_NAME in voyage_manager.html');

  check('the page title names it', new RegExp('<title>' + appName + ' — ').test(html), true);
  check('the iOS home-screen title names it',
    html.includes('name="apple-mobile-web-app-title" content="' + appName + '"'), true);
  check('the masthead names it', html.includes('<h1>' + appName + '</h1>'), true);
  check('the login card names it',
    html.includes('<h2 id="loginGateTitle">' + appName + '</h2>'), true);
  check('the printed sheet header names it',
    html.includes('Engine Department — ${escPrint(APP_NAME)}'), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.webmanifest'), 'utf8'));
  check('the web manifest short_name matches', manifest.short_name, appName);
  check('the web manifest name starts with it', manifest.name.startsWith(appName), true);

  const cap = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'capacitor.config.json'), 'utf8'));
  check('the Capacitor app name matches', cap.appName, appName);

  const strings = fs.readFileSync(
    path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');
  check('the Android launcher label matches',
    strings.includes('<string name="app_name">' + appName + '</string>'), true);

  const orbJs = fs.readFileSync(path.join(REPO_ROOT, 'eorb.js'), 'utf8');
  check('eorb.js spells the name the same way',
    matchOrDie(orbJs, /const APP_NAME = '([^']+)'/, 'APP_NAME in eorb.js'), appName);
  check('the e-ORB printout names the program that produced it',
    orbJs.includes("' + escapeHtml(APP_NAME) + ' e-ORB"), true);

  const nsiName = fs.readFileSync(path.join(REPO_ROOT, 'install', 'windows', 'noonreport.nsi'), 'utf8');
  check('the Windows installer name matches',
    nsiName.includes('!define APP_NAME     "' + appName + '"'), true);

  /* Each rename leaves the previous version's shortcuts and launcher on the PC under
     their old names, where nothing this installer writes will overwrite them — several
     icons for one program, all but one starting a copy already replaced. Every name
     this program has had stays listed: a PC that skips a version upgrades straight
     from the oldest, and the intermediate installer never ran there to clean up. */
  for (const leftover of ['$DESKTOP\\Noon Report.lnk', '$SMPROGRAMS\\Noon Report',
                          '$INSTDIR\\Start Noon Report.bat',
                          '$DESKTOP\\Voyage Report.lnk', '$SMPROGRAMS\\Voyage Report',
                          '$INSTDIR\\Start Voyage Report.bat']) {
    check('the installer clears the old-name leftover ' + leftover,
      nsiName.includes(leftover), true);
  }
}

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checked} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checked} checks`);
