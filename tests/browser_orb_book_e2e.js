/*
 * The e-ORB Browse panel: present tank R.O.B. with how full each tank is, and the
 * record book rendered as it reads on paper.
 *
 *   APP_BASE=http://127.0.0.1:8868 NODE_PATH=/path/to/node_modules \
 *     node tests/browser_orb_book_e2e.js
 *
 * What only the browser can settle:
 *  - The book sits on a cream page inside a dark-theme app. The page-wide table rules
 *    paint cells for the dark theme, so without an override the record reads as pale
 *    grey on cream and the operations column refuses to wrap.
 *  - The default view is the last 7 days. The Browse filter opens pre-filled with the
 *    last three months, so "has the engineer asked for a period" cannot be inferred
 *    from the date boxes having values.
 *  - Saving an entry that moves oil has to move the tank cards with it.
 *
 * Not in CI, which has no browser.
 */
const { chromium } = require('playwright-core');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8867';
let f = 0, c = 0;
const check = (l, a, e) => {
  c++;
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`);
  if (!ok) f++;
};

/* Relative luminance, to prove the book's text actually contrasts with its page. */
const contrast = (fg, bg) => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(v => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1200 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', async d => { await d.accept(); });

  await pg.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await pg.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await pg.waitForTimeout(4000);

  /* Tanks at each status, and a fortnight of entries so the 7-day window has to choose. */
  await pg.evaluate(async () => {
    switchTab('orb');
    const st = orbSetup();
    st.shipName = 'M/V HARBOUR KEY'; st.imo = '9684412'; st.callSign = 'V7AB9'; st.gt = 24560;
    st.tanks.sludge = [
      { id: 'SL1', name: 'Sludge Tank', frameNo: 'Fr. 42-46', capacityM3: 20, robM3: 18.6 },
      { id: 'SL2', name: 'Settling Drain Tk', capacityM3: 10, robM3: 7.9 },
      { id: 'SL3', name: 'Uncalibrated Tk', robM3: 2 }
    ];
    st.tanks.bilge = [{ id: 'BW1', name: 'Bilge Holding Tk', capacityM3: 30, robM3: 6.2 }];
    state.setup.orb = st;
    fillOrbSetupForm();
    const day = (back) => new Date(Date.UTC(2026, 7, 22 - back)).toISOString().slice(0, 10);
    const mk = (back, code, lines) => ({
      id: 'bk' + back + code, vesselId: state.activeVesselId, part: 1, code, date: day(back),
      selectedItems: lines.map(l => l.itemNo), values: {}, lines,
      officerName: 'A. Ruiz', officerRank: 'Chief Engineer',
      officerSignedAt: day(back) + 'T12:00:00', createdAt: day(back) + 'T12:00:00', voided: false
    });
    state.orbEntries = [
      mk(14, 'C', [{ itemNo: '12.1', text: '4.200 m³ sludge landed at Singapore' }]),
      mk(6, 'C', [{ itemNo: '11.1', text: 'Sludge Tank' }, { itemNo: '11.2', text: '20.00 m³' }, { itemNo: '11.3', text: '16.10 m³' }]),
      mk(4, 'D', [{ itemNo: '13', text: '3.500 m³ bilge water' }, { itemNo: '14', text: 'start: 02:10, stop: 04:35' }]),
      mk(1, 'C', [{ itemNo: '12.3', text: '1.100 m³ from Sludge Tank, incinerated 3.5 h' }])
    ];
    switchOrbPanel('browse');
    await new Promise(r => setTimeout(r, 600));
  });
  await pg.waitForTimeout(900);

  console.log('\npresent tank R.O.B., with how full each tank is');
  const tanks = await pg.evaluate(() => {
    const cards = [...document.querySelectorAll('.orb-tank-card')].map(el => ({
      name: el.querySelector('.tk-name span').textContent.trim(),
      fig: el.querySelector('.tk-fig').textContent.replace(/\s+/g, ' ').trim(),
      sub: el.querySelector('.tk-sub').textContent.trim(),
      status: [...el.classList].filter(x => x !== 'orb-tank-card')[0] || 'ok',
      bar: el.querySelector('.orb-tank-bar > span').style.width,
      barColour: getComputedStyle(el.querySelector('.orb-tank-bar > span')).backgroundColor,
      frame: el.querySelector('.tk-frame')?.textContent.trim() || null
    }));
    return { cards, groups: [...document.querySelectorAll('.orb-tank-group > h4')].map(h => h.textContent.trim()) };
  });
  const card = n => tanks.cards.find(x => x.name === n);
  check('every configured tank has a card', tanks.cards.length >= 4, true);
  check('grouped by what the certificate calls them',
    tanks.groups.slice(0, 2), ['Oil residue / sludge (IOPP 3.1)', 'Oily bilge water holding (IOPP 3.3)']);
  check('the quantity and the percentage are both shown', card('Sludge Tank').fig, '18.600 m³ · 93.0%');
  check('spare room is spelled out', card('Sludge Tank').sub, 'of 20.000 m³ · 1.400 m³ spare');
  check('a nearly full tank is flagged', card('Sludge Tank').status, 'full');
  check('one over three quarters is flagged high', card('Settling Drain Tk').status, 'high');
  check('a fifth full is not flagged', card('Bilge Holding Tk').status, 'ok');
  check('the bar tracks the percentage', card('Sludge Tank').bar, '93%');
  check('and full, high and ok are three different colours',
    new Set([card('Sludge Tank').barColour, card('Settling Drain Tk').barColour, card('Bilge Holding Tk').barColour]).size, 3);
  check('a tank with no capacity shows its quantity and no percentage',
    card('Uncalibrated Tk').fig, '2.000 m³');
  check('and says why', card('Uncalibrated Tk').sub, 'capacity not on record');
  check('the frame prefix is not doubled', card('Sludge Tank').frame, 'Fr. 42-46');

  console.log('\nthe book opens on the last 7 days, not the filter\'s three months');
  const first = await pg.evaluate(() => ({
    title: document.getElementById('orbBookTitle').textContent,
    range: document.querySelector('#orbBook .sub').textContent,
    dates: [...document.querySelectorAll('#orbBook tbody tr td:first-child')].map(t => t.textContent.trim()).filter(Boolean),
    filterFrom: document.getElementById('orb_from').value,
    filterTo: document.getElementById('orb_to').value
  }));
  check('titled as the last 7 days', first.title, 'Record Book — Last 7 Days');
  check('even though the filter is pre-filled with a wider range',
    first.filterFrom !== '' && first.filterTo !== '', true);
  check('the fortnight-old entry is not in it', first.dates.includes('08-AUG-2026'), false);
  check('the last week of entries is', first.dates, ['16-AUG-2026', '18-AUG-2026', '21-AUG-2026']);

  console.log('\nit reads as the book, not as a data table');
  const book = await pg.evaluate(() => {
    const cell = document.querySelector('#orbBook tbody td:nth-child(4)');
    const page = document.querySelector('.orb-book');
    const head = document.querySelector('#orbBook thead th');
    return {
      headings: [...document.querySelectorAll('#orbBook thead th')].map(t => t.textContent.trim()),
      shipLine: document.querySelector('#orbBook .orb-book-meta div')?.textContent.trim(),
      partTitle: document.querySelector('#orbBook .orb-book-head h3')?.textContent.trim(),
      textColour: getComputedStyle(cell).color,
      pageColour: getComputedStyle(page).backgroundColor,
      headColour: getComputedStyle(head).color,
      wraps: getComputedStyle(cell).whiteSpace,
      sticky: getComputedStyle(head).position,
      signatures: document.querySelectorAll('#orbBook .orb-sign').length,
      pageScrollsSideways: (() => {
        const p = document.getElementById('page-orb');
        return p.scrollWidth > p.clientWidth + 1;
      })(),
      bookScrollsInItsOwnBox: (() => {
        const w = document.querySelector('.orb-book-wrap');
        return w.scrollWidth >= w.clientWidth;
      })()
    };
  });
  check('the four columns of the official book',
    book.headings, ['Date', 'Code', 'Item', 'Record of operations / signature of officer in charge']);
  check('the ship is identified at the head', /Name of ship/.test(book.shipLine), true);
  check('and the part is named', book.partTitle, 'Oil Record Book — Part I');
  check('each entry is signed', book.signatures, 3);
  /* The dark theme's table rules would otherwise paint this page's own text. */
  check('the record is readable on the cream page',
    contrast(book.textColour, book.pageColour) >= 7, true);
  check('so are the column headings', contrast(book.headColour, 'rgb(233, 226, 205)') >= 7, true);
  check('the operations column wraps rather than running off', book.wraps, 'normal');
  check('the heading does not float over the page like the app tables', book.sticky, 'static');
  check('the book scrolls inside its own box', book.bookScrollsInItsOwnBox, true);
  check('and never drags the page sideways', book.pageScrollsSideways, false);

  console.log('\npicking a range previews that period');
  const ranged = await pg.evaluate(async () => {
    document.getElementById('orb_from').value = '2026-08-16';
    document.getElementById('orb_to').value = '2026-08-19';
    document.getElementById('btnOrbFilter').click();
    await new Promise(r => setTimeout(r, 700));
    return {
      title: document.getElementById('orbBookTitle').textContent,
      range: document.querySelector('#orbBook .sub').textContent,
      dates: [...document.querySelectorAll('#orbBook tbody tr td:first-child')].map(t => t.textContent.trim()).filter(Boolean)
    };
  });
  check('the title says it is a chosen period', ranged.title, 'Record Book — Selected Period');
  check('the head carries the dates', ranged.range, '16-AUG-2026 to 19-AUG-2026');
  check('and only that period is in it', ranged.dates, ['16-AUG-2026', '18-AUG-2026']);

  console.log('\nclearing the dates goes back to the last 7 days');
  const cleared = await pg.evaluate(async () => {
    document.getElementById('orb_from').value = '';
    document.getElementById('orb_to').value = '';
    document.getElementById('btnOrbFilter').click();
    await new Promise(r => setTimeout(r, 700));
    return document.getElementById('orbBookTitle').textContent;
  });
  check('back to the default view', cleared, 'Record Book — Last 7 Days');

  console.log('\na period with nothing in it says so');
  const empty = await pg.evaluate(async () => {
    document.getElementById('orb_from').value = '2026-01-01';
    document.getElementById('orb_to').value = '2026-01-05';
    document.getElementById('btnOrbFilter').click();
    await new Promise(r => setTimeout(r, 600));
    return {
      msg: document.querySelector('#orbBook .orb-book-empty')?.textContent.trim(),
      stillABook: !!document.querySelector('#orbBook .orb-book-head')
    };
  });
  check('it says the period is empty', empty.msg, 'No entries in the selected period.');
  check('and still shows the book head rather than nothing', empty.stillABook, true);

  console.log('\nsaving an entry moves the tank cards');
  const moved = await pg.evaluate(async () => {
    const readCard = (name) => {
      const el = [...document.querySelectorAll('.orb-tank-card')]
        .find(c => c.querySelector('.tk-name span').textContent.trim() === name);
      return el ? el.querySelector('.tk-fig').textContent.replace(/\s+/g, ' ').trim() : null;
    };
    switchOrbPanel('browse');
    await new Promise(r => setTimeout(r, 400));
    const before = readCard('Bilge Holding Tk');
    switchOrbPanel('new');
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('[data-orb-scenario="aircooler-condensate"]').click();
    await new Promise(r => setTimeout(r, 400));
    const set = (n, v) => {
      const el = document.querySelector(`#orbFieldGrid [data-orb-field="${n}"]`);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('extraToTank', 'BW1');
    set('extraQty', '1.8');
    document.getElementById('orb_officerName').value = 'A. Ruiz';
    document.getElementById('btnOrbSaveEntry').click();
    await new Promise(r => setTimeout(r, 1400));
    switchOrbPanel('browse');
    await new Promise(r => setTimeout(r, 600));
    return { before, after: readCard('Bilge Holding Tk') };
  });
  check('the card read the old figure', moved.before, '6.200 m³ · 20.7%');
  check('and the new one after the entry was saved', moved.after, '8.000 m³ · 26.7%');

  console.log('\nnothing went wrong');
  check('no page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
