// Download the latest "tour de garde" roster from the UNPPCI website (https://www.unppci.org)
// and regenerate src/data/gardeData.ts with scripts/parse_garde.js.
// Usage: node scripts/fetch_garde.js [--dry-run] [--out <file.ts|file.json>] [--pdf-dir <dir>]
//   default --out is src/data/gardeData.ts (the copy bundled in the app);
//   --out garde.json is what the daily GitHub Action publishes for the app to download.
//
// UNPPCI posts one article per month ("TOUR DE GARDE DU MOIS D'OCTOBRE 2026") with download links:
//   "GARDE OCTOBRE 2026"            -> Abidjan roster (the one the app uses)
//   "GARDE INTERIEUR OCTOBRE 2026"  -> rest of the country (ignored for now)
//   "SEMAINE DU 17 AU 23 OCTOBRE 2026" -> optional one-week corrections, applied on top of the monthly roster
// PDFs are saved in garde_pdfs/ so each release can be traced back to its source.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = 'https://www.unppci.org/';
// The site answers 406 to requests without browser-like headers.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};
const argValue = name => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PDF_DIR = path.resolve(argValue('--pdf-dir') || path.join(__dirname, '..', 'garde_pdfs'));
const dryRun = process.argv.includes('--dry-run');
const outFile = argValue('--out') && path.resolve(argValue('--out'));

async function get(url, referer) {
  const res = await fetch(url, { headers: referer ? { ...HEADERS, Referer: referer } : HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

const articleIds = html => [...html.matchAll(/\?p=articles&(?:amp;)?id=(\d+)/g)].map(m => Number(m[1]));

// Download links of an article: [{ id, label }]
const downloadLinks = html => [...html.matchAll(/downloads\.php\?id=(\d+)'[^>]*>\s*([^<]+?)\s*<\/a>/g)]
  .map(m => ({ id: m[1], label: m[2].replace(/\s+/g, ' ').trim() }));

const isMonthlyAbidjan = label => /^GARDE\s+(?!INTERIEUR)/i.test(label);
const isWeeklyUpdate = label => /^SEMAINE DU/i.test(label);

async function findLatestRosterArticle() {
  const home = await (await get(BASE)).text();
  const known = articleIds(home);
  if (!known.length) throw new Error('No articles found on the UNPPCI homepage: has the site changed?');
  // The homepage does not always list the newest posts, so also probe a few ids above the highest one.
  const highest = Math.max(...known);
  for (let id = highest + 5; id >= highest - 15; id--) {
    const url = `${BASE}?p=articles&id=${id}`;
    let html;
    try { html = await (await get(url)).text(); } catch { continue; }
    const links = downloadLinks(html);
    if (links.some(l => isMonthlyAbidjan(l.label))) return { url, links };
    await new Promise(r => setTimeout(r, 300)); // be gentle with their server
  }
  throw new Error(`No roster article found between ids ${highest - 15} and ${highest + 5}`);
}

async function download(link, referer) {
  const res = await get(`${BASE}controllers/downloads.php?id=${link.id}`, referer);
  const disposition = res.headers.get('content-disposition') || '';
  const name = (disposition.match(/filename="?([^";]+)"?/) || [])[1] || `unppci-${link.id}.pdf`;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error(`"${link.label}" is not a PDF`);
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const file = path.join(PDF_DIR, path.basename(name));
  fs.writeFileSync(file, buf);
  return file;
}

// JSON output only:
// - keep weeks from the previous file that are not over yet and not in the new roster, so the
//   current week does not disappear when UNPPCI posts next month's roster before this one ends;
// - if nothing changed, restore the previous file untouched (keeps generatedAt, so no empty commit).
function mergeWithPrevious(file, previous) {
  const next = JSON.parse(fs.readFileSync(file, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const have = new Set(next.weeks.map(w => w.start));
  const carried = previous.weeks.filter(w => !have.has(w.start) && w.end >= today);
  if (carried.length) {
    const starts = new Set(carried.map(w => w.start));
    next.weeks = [...carried, ...next.weeks].sort((a, b) => a.start.localeCompare(b.start));
    next.pharmacies = [...previous.pharmacies.filter(p => starts.has(p.weekStart)), ...next.pharmacies];
    next.sources = [...new Set([...previous.sources, ...next.sources])];
    console.log('Kept from previous roster:', carried.map(w => w.start).join(', '));
  }
  const same = JSON.stringify([previous.weeks, previous.pharmacies]) === JSON.stringify([next.weeks, next.pharmacies]);
  fs.writeFileSync(file, JSON.stringify(same ? previous : next, null, 1) + '\n');
  console.log(same ? 'Roster unchanged.' : 'Roster updated.');
}

(async () => {
  const { url, links } = await findLatestRosterArticle();
  console.log('Roster article:', url);
  links.forEach(l => console.log('  -', l.label));

  const monthly = links.find(l => isMonthlyAbidjan(l.label));
  // Weekly sheets in date order, so a later correction wins over an earlier one
  const weekly = links.filter(l => isWeeklyUpdate(l.label))
    .sort((a, b) => Number(a.label.match(/\d+/)[0]) - Number(b.label.match(/\d+/)[0]));

  const files = [];
  for (const link of [monthly, ...weekly]) {
    const file = await download(link, url);
    console.log('Downloaded', link.label, '->', path.relative(process.cwd(), file));
    files.push(file);
  }

  const target = dryRun ? path.join(PDF_DIR, 'gardeData.preview.ts') : outFile;
  const previous = target && target.endsWith('.json') && fs.existsSync(target)
    ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;

  const parseArgs = [path.join(__dirname, 'parse_garde.js'), ...files];
  if (target) parseArgs.splice(1, 0, '-o', target);
  execFileSync(process.execPath, parseArgs, { stdio: 'inherit' });

  if (previous) mergeWithPrevious(target, previous);
})().catch(err => {
  console.error('fetch_garde failed:', err.message);
  process.exit(1);
});
