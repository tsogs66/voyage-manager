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
  /* The book's Date column is title-case — "16-Aug-2026" — since "Match
     company beORB date / code / Item No. print layout"; only the signature
     line uppercases it. Asserting the uppercase form here made the
     fortnight-old check vacuous (it could never match either way) and failed
     the three that follow. */
  check('the fortnight-old entry is not in it', first.dates.includes('08-Aug-2026'), false);
  check('the last week of entries is', first.dates, ['16-Aug-2026', '18-Aug-2026', '21-Aug-2026']);

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
  /* The headings carry the paper book's parenthetical qualifiers, as MARPOL
     and the company beORB print them. */
  check('the four columns of the official book',
    book.headings,
    ['Date', 'Code(letter)', 'Item No.(number)',
      'Record of operations / signature of officer in charge']);
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
  check('the head carries the dates alongside the part',
    ranged.range, 'Machinery Space Operations (All Ships) · 16-Aug-2026 to 19-Aug-2026');
  check('and only that period is in it', ranged.dates, ['16-Aug-2026', '18-Aug-2026']);

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

  console.log('\nthe printout is the same document as the book on screen');
  const same = await pg.evaluate(async () => {
    document.getElementById('orb_from').value = '';
    document.getElementById('orb_to').value = '';
    document.getElementById('btnOrbFilter').click();
    await new Promise(r => setTimeout(r, 700));
    const screenEl = document.querySelector('.orb-book');
    const { entries, from, to } = orbBookEntries();
    const label = `${EORB.formatOrbDate(from)} to ${EORB.formatOrbDate(to)}`;
    const d = document.createElement('div');
    d.innerHTML = EORB.buildPrintHtml(orbSetup(), entries, label)
      .replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');
    const grab = (root) => ({
      title: root.querySelector('.orb-book-head h3').textContent.trim(),
      sub: root.querySelector('.orb-book-head .sub').textContent.trim(),
      meta: [...root.querySelectorAll('.orb-book-meta div')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      headings: [...root.querySelectorAll('thead th')].map(x => x.textContent.trim()),
      rows: [...root.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim())),
      foot: root.querySelector('.orb-book-foot').textContent.replace(/\s+/g, ' ').trim()
    });
    const a = grab(screenEl), b2 = grab(d);
    return {
      a, b: b2,
      screenHasMaster: !!screenEl.querySelector('.orb-book-master'),
      printHasMaster: !!d.querySelector('.orb-book-master'),
      /* One stylesheet, injected on the page and embedded in the printed document. */
      cssInjected: !!document.getElementById('orbBookCss'),
      cssIsShared: (document.getElementById('orbBookCss') || {}).textContent === EORB.BOOK_CSS,
      printEmbedsSameCss: EORB.buildPrintHtml(orbSetup(), entries, label).includes(EORB.BOOK_CSS)
    };
  });
  check('same title', same.a.title, same.b.title);
  check('same subtitle', same.a.sub, same.b.sub);
  check('same ship particulars, cell for cell', same.a.meta, same.b.meta);
  check('same column headings', same.a.headings, same.b.headings);
  check('same rows, cell for cell', same.a.rows, same.b.rows);
  check('same footer', same.a.foot, same.b.foot);
  /* The one intended difference: a screen is not a signed sheet. */
  check('only the printed sheet carries the Master\'s block',
    [same.screenHasMaster, same.printHasMaster], [false, true]);
  check('the page uses the book stylesheet from eorb.js', same.cssIsShared, true);
  check('and the printed document embeds that same stylesheet', same.printEmbedsSameCss, true);

  console.log('\nthe Print button prints what the book shows');
  const printed = await pg.evaluate(async () => {
    document.getElementById('orb_from').value = '2026-08-16';
    document.getElementById('orb_to').value = '2026-08-21';
    document.getElementById('btnOrbFilter').click();
    await new Promise(r => setTimeout(r, 700));
    /* Capture what the handler builds, rather than a label invented by the test —
       the handler used to hand the builder raw ISO dates and an arrow. */
    let captured = null;
    const real = EORB.buildPrintHtml;
    EORB.buildPrintHtml = function(){ captured = real.apply(this, arguments); return captured; };
    try { document.getElementById('btnOrbPrint').click(); }
    finally { EORB.buildPrintHtml = real; }
    await new Promise(r => setTimeout(r, 600));
    document.querySelectorAll('iframe').forEach(f => f.remove());
    return { doc: captured, screenSub: document.querySelector('#orbBook .orb-book-head .sub').textContent.trim() };
  });
  check('the button produced a document', typeof printed.doc === 'string' && printed.doc.length > 500, true);
  const printedSub = (printed.doc.match(/class="sub">([^<]*)</) || [])[1];
  check('the printed period reads as the book writes dates',
    printedSub, printed.screenSub);
  check('and not as raw ISO with an arrow', /\d{4}-\d{2}-\d{2} →/.test(printedSub || ''), false);

  console.log('\nprinting from a phone gives the same sheet as from a desktop');
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const mob = await phone.newPage();
  const mobErrs = [];
  mob.on('pageerror', e => mobErrs.push(e.message));
  mob.on('dialog', async d => { await d.accept(); });
  await mob.goto(`${BASE}/voyage_manager.html`, { waitUntil: 'domcontentloaded' });
  await mob.waitForTimeout(1200);
  await mob.evaluate(() => document.getElementById('loginGate')?.setAttribute('hidden', ''));
  await mob.evaluate(async () => { await installTestFleet({ switchToFirst: true }); });
  await mob.waitForTimeout(4000);
  const fromPhone = await mob.evaluate(async () => {
    switchTab('orb');
    const st = orbSetup();
    st.shipName = 'M/V HARBOUR KEY'; st.imo = '9684412'; st.callSign = 'V7AB9'; st.gt = 24560;
    state.setup.orb = st;
    fillOrbSetupForm();
    const day = (n) => new Date(Date.UTC(2026, 7, 22 - n)).toISOString().slice(0, 10);
    state.orbEntries = [{
      id: 'ph1', vesselId: state.activeVesselId, part: 1, code: 'C', date: day(1),
      lines: [{ itemNo: '12.3', text: '1.100 m³ from Sludge Tank, incinerated 3.5 h' }],
      officerName: 'A. Ruiz', officerRank: 'Chief Engineer',
      officerSignedAt: day(1) + 'T12:00:00', createdAt: day(1) + 'T12:00:00', voided: false
    }];
    switchOrbPanel('browse');
    await new Promise(r => setTimeout(r, 600));
    let captured = null;
    const real = EORB.buildPrintHtml;
    EORB.buildPrintHtml = function(){ captured = real.apply(this, arguments); return captured; };
    try { document.getElementById('btnOrbPrint').click(); }
    finally { EORB.buildPrintHtml = real; }
    await new Promise(r => setTimeout(r, 600));
    const frame = [...document.querySelectorAll('iframe')].slice(-1)[0];
    const css = frame ? frame.style.cssText : '';
    document.querySelectorAll('iframe').forEach(f => f.remove());
    return { doc: captured, css };
  });
  check('a phone produces a document too', typeof fromPhone.doc === 'string' && fromPhone.doc.length > 500, true);
  /* The sheet is laid out in an iframe pinned to A4, so the phone's own screen width
     never reaches the page. */
  check('printed through an A4-sized frame, not the phone viewport',
    /width:\s*210mm/.test(fromPhone.css) && /height:\s*297mm/.test(fromPhone.css), true);

  /* Lay the phone's document out and check it neither overflows A4 nor breaks narrow. */
  const sheet = await phone.newPage();
  await sheet.setViewportSize({ width: 794, height: 1123 });
  await sheet.setContent(fromPhone.doc);
  await sheet.waitForTimeout(500);
  const a4 = await sheet.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    minWidth: getComputedStyle(document.querySelector('.orb-book')).minWidth,
    border: getComputedStyle(document.querySelector('.orb-book')).borderTopWidth
  }));
  check('the sheet does not run off A4', a4.overflow, false);
  /* The card border and the 640px floor belong to the panel on screen, not to paper. */
  check('the page has no card border on paper', a4.border, '0px');
  check('and no minimum width to overflow a narrow preview', a4.minWidth, '0px');
  await sheet.setViewportSize({ width: 390, height: 844 });
  await sheet.waitForTimeout(400);
  const narrow = await sheet.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rows: document.querySelectorAll('tbody tr').length,
    stillSigned: !!document.querySelector('.orb-book-master')
  }));
  check('it reflows into a narrow preview rather than being cut', narrow.overflow, false);
  check('with every row still there', narrow.rows > 0, true);
  check('and the Master\'s block still on it', narrow.stillSigned, true);
  check('no page errors on the phone', mobErrs.length, 0);
  if (mobErrs.length) console.log(mobErrs.slice(0, 5));
  await phone.close();

  console.log('\nnothing went wrong');
  check('no page errors', errs.length, 0);
  if (errs.length) console.log(errs.slice(0, 5));

  await b.close();
  console.log();
  if (f) { console.log(`FAILED — ${f} of ${c} checks`); process.exit(1); }
  console.log(`PASSED — ${c} checks`);
})();
