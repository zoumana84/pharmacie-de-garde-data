// Parse the monthly "tour de garde" roster into src/data/gardeData.ts for the app.
// Input: the official UNPPCI PDF (https://www.unppci.org, "GARDE <MOIS> <ANNEE>"), or text
// already extracted from it (e.g. garde_novembre_raw.txt). PDFs need `pdftotext` (ships with Git for Windows).
// Usage: node scripts/parse_garde.js [-o src/data/gardeData.ts] <monthly.pdf|raw.txt> [weekly-update.pdf ...]
// UNPPCI sometimes posts extra one-week sheets ("SEMAINE DU 17 AU 23 OCTOBRE 2026") that add or
// correct pharmacies: pass them after the monthly file and they replace that week's list for the
// zones they cover.
// Check the printed counts: each week should have ~110 pharmacies and no UNATTACHED lines.
// A new commune/zone heading in the PDF must be added to SECTIONS or ZONES below.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const norm = s => s.replace(/\s+/g, ' ').trim();
const args = process.argv.slice(2);
const outIdx = args.indexOf('-o');
const outFile = outIdx >= 0 ? args.splice(outIdx, 2)[1] : path.join(__dirname, '..', 'src', 'data', 'gardeData.ts');
const inputs = args;
if (!inputs.length) {
  console.error('Usage: node scripts/parse_garde.js [-o out.ts] <monthly.pdf|raw.txt> [weekly-update.pdf ...]');
  process.exit(1);
}
const readText = input => /\.pdf$/i.test(input)
  ? execFileSync('pdftotext', ['-enc', 'UTF-8', input, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  : fs.readFileSync(input, 'utf8');

// Headings are matched on letters/digits only, so "D’ABOBO" = "D'ABOBO" and
// "Z ONE A KOUEDO – P ALMERAIE" = "ZONE AKOUEDO - PALMERAIE".
const headingKey = s => s.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');
const byKey = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [headingKey(k), v]));

const SECTIONS = byKey({
  "SECTION D'ABOBO": 'ABOBO', "SECTION D'ADJAME": 'ADJAME', 'SECTION DE COCODY': 'COCODY',
  'SECTION DE KOUMASSI': 'KOUMASSI', 'SECTION DE MARCORY': 'MARCORY', 'SECTION DU PLATEAU': 'PLATEAU',
  'SECTION DE PORT BOUET': 'PORT BOUET', 'SECTION DE TREICHVILLE': 'TREICHVILLE', 'SECTION DE YOPOUGON': 'YOPOUGON',
});
// Sub-zone headings -> [section, display zone]
const ZONES = byKey({
  'ABOBO': ['ABOBO', 'Abobo'], 'ABOBO PK 18': ['ABOBO', 'Abobo PK 18'], 'ANYAMA': ['ABOBO', 'Anyama'],
  'ALEPE / MONTEZO / BROFODOUME': ['ABOBO', 'Alépé / Montezo / Brofodoumé'],
  'ADJAME CENTRE': ['ADJAME', 'Adjamé Centre'], 'ATTECOUBE': ['ADJAME', 'Attécoubé'], 'WILLIAMSVILLE': ['ADJAME', 'Williamsville'],
  'BINGERVILLE': ['COCODY', 'Bingerville'], 'ZONE AKOUEDO - PALMERAIE EXTENSION - ABATTA': ['COCODY', 'Akouédo / Palmeraie Ext. / Abatta'],
  'RIVIERA': ['COCODY', 'Riviera'], 'COCODY': ['COCODY', 'Cocody'], 'II PLATEAUX': ['COCODY', 'II Plateaux'],
  'MARCORY NORD': ['MARCORY', 'Marcory Nord'], 'ANOUMABO': ['MARCORY', 'Anoumabo'], 'MARCORY SUD': ['MARCORY', 'Marcory Sud'],
  'CENTRE': ['PORT BOUET', 'Port-Bouët Centre'], 'VRIDI': ['PORT BOUET', 'Vridi'], 'ADJOUFFOU /GONZAQ/ ANANI': ['PORT BOUET', 'Adjouffou / Gonzagueville / Anani'],
  'ABOBODOUME / LOCODJORO': ['YOPOUGON', 'Abobodoumé / Locodjoro'], 'ALLOKOI PK 23': ['YOPOUGON', 'Allokoi PK 23'], 'YOPOUGON': ['YOPOUGON', 'Yopougon'],
});
const SECTION_LABEL = {
  ABOBO: 'Abobo', ADJAME: 'Adjamé', COCODY: 'Cocody', KOUMASSI: 'Koumassi', MARCORY: 'Marcory',
  PLATEAU: 'Plateau', 'PORT BOUET': 'Port-Bouët', TREICHVILLE: 'Treichville', YOPOUGON: 'Yopougon',
};
const MONTHS = {
  JANVIER: 1, FEVRIER: 2, MARS: 3, AVRIL: 4, MAI: 5, JUIN: 6,
  JUILLET: 7, AOUT: 8, SEPTEMBRE: 9, OCTOBRE: 10, NOVEMBRE: 11, DECEMBRE: 12,
};
const pad = n => String(n).padStart(2, '0');

// "SEMAINE DU SAMEDI 29 NOVEMBRE AU VENDREDI 05 DECEMBRE 2025" -> ['2025-11-29', '2025-12-05']
// The PDF text has stray spaces inside words and numbers ("0 1", "NOVEM BRE"), so strip them all.
function parseWeek(l) {
  const s = l.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
  const m = s.match(/^SEMAINEDUSAMEDI(\d\d)([A-Z]*?)AUVENDREDI(\d\d)([A-Z]+?)(\d{4})/);
  if (!m) return null;
  const endMonth = MONTHS[m[4]];
  const startMonth = m[2] ? MONTHS[m[2]] : endMonth;
  if (!startMonth || !endMonth) throw new Error('Unknown month in: ' + l);
  const endYear = Number(m[5]);
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  return [`${startYear}-${pad(startMonth)}-${m[1]}`, `${endYear}-${pad(endMonth)}-${m[3]}`];
}

// "PHCIE" also shows up as "PHCI E" / "PH CIE" in the PDF text
const ENTRY_START = /^(?:Secteur \d+\s+)?(?:P\s?H\s?C\s?I\s?E|PHARMACIE|ST SYLVESTRE)\b/i;
const TEL = /\bT\s?E\s?L\s*[.:]*\s*/;
// "Secteur 1 Secteur 2 ..." is the Yopougon sector legend
const isNoise = l => !l || /^--- Page Break|^Permanence|TOUR DE GARDE|^(?:Secteur \d+\s*)+$/i.test(l);

const titleCase = s => s.toLowerCase().replace(/(^|[\s(’'\-\/.])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());

// entryLines: first line is the pharmacy line, the rest are continuation lines.
function parseEntry(entryLines) {
  const text = entryLines.join(' \n ');
  let head, tail;
  const m = text.match(TEL);
  if (m) { head = text.slice(0, m.index); tail = text.slice(m.index + m[0].length); }
  else { head = entryLines[0]; tail = entryLines.slice(1).join(' \n '); }

  // Name ends at the owner part: "/", " – ", or an owner title (M., MME, MLLE)
  const nameRaw = head.replace(/\n/g, ' ')
    .replace(/^Secteur \d+\s+/i, '').replace(/^(?:P\s?H\s?C\s?I\s?E|PHARMACIE)\s*/i, '')
    .split(/\/|\s–\s|\s–$|\s(?:M\.?|MME\.?|MLLE\.?)\s/)[0].replace(/[\s–-]+$/, '').trim();
  const name = 'Pharmacie ' + titleCase(nameRaw).replace(/\(Nlle\)|\(Nvlle\)/i, '(Nouvelle)');

  // Phones come first after TEL, separated by "/" (sometimes "–"); everything after is address.
  // The address can follow the last phone without a "/" ("TEL. 27 24 39 13 84 EN FACE DE ...").
  const phones = [];
  const rest = [];
  const segs = tail.replace(/^(?:T\s?E\s?L\s*[.:]*\s*)+/, '').replace(/\s[–-]\s(?=\d\d(?:\s?\d\d){3,4}\b)/g, ' / ').split(/\/|\n/);
  for (const seg of segs) {
    const t = seg.trim();
    if (!t) continue;
    const m = rest.length === 0 && t.match(/^([\d ]*\d)(?:\s+(.*))?$/);
    const digits = m ? m[1].replace(/\s/g, '') : '';
    if (digits.length >= 8) {
      phones.push(digits.match(/.{1,2}/g).join(' '));
      if (m[2]) rest.push(m[2]);
    } else if (m && !m[2]) {
      // short digit runs are extension fragments like "27 80": skip
    } else rest.push(t);
  }
  // Yopougon entries end with the next entry's "Secteur N" label ("Se cteur 1 5")
  const address = rest.join(' / ').replace(/S\s?e\s?c\s?t\s?e\s?u\s?r\s?\d[\d\s]*$/i, '');
  return { name, phones, address: norm(address.replace(/^[\s/,–-]+|[\s/,–-]+$/g, '')) };
}

// Longest heading (section or zone) at the start of `text`, if what follows it is another
// heading, a pharmacy entry, or nothing. Returns [headingText, rest] or null.
function leadingHeading(text) {
  const words = text.split(' ');
  for (let k = Math.min(words.length, 8); k >= 1; k--) {
    const key = headingKey(words.slice(0, k).join(' '));
    if (!SECTIONS[key] && !ZONES[key]) continue;
    const rest = words.slice(k).join(' ');
    if (!rest || ENTRY_START.test(rest) || leadingHeading(rest)) return [words.slice(0, k).join(' '), rest];
  }
  return null;
}

// The PDF text puts headings and several pharmacies on one line
// ("Permanence 24 h/24 h SECTION DE COCODY BINGERVILLE PHCIE NISSI ... PHCIE MOTTO ...").
// Split each line into: week line, headings, and one line per pharmacy entry.
function splitLine(line) {
  const parts = [];
  let l = line;
  const w = parseWeek(l);
  if (w) {
    parts.push(l.slice(0, l.search(/\d{4}/) + 4));
    l = norm(l.slice(l.search(/\d{4}/) + 4));
  }
  l = norm(l.replace(/^Permanence 24 h\s?\/\s?24 h/i, ''));
  for (let h; (h = leadingHeading(l)); l = h[1]) parts.push(h[0]);
  l = l.replace(/\bS\s?e\s?c\s?t\s?e\s?u\s?r\s?\d[\d\s]*?\s(?=P\s?H\s?C\s?I\s?E\b)/gi, '');
  // A "PHCIE ..." piece without TEL is a landmark inside an address ("AVANT LA PHCIE HERMES"),
  // not a new entry: glue it back onto the previous piece.
  const pieces = [];
  for (const p of l.split(/\s(?=(?:P\s?H\s?C\s?I\s?E|PHARMACIE)\s)/).map(norm)) {
    if (pieces.length && !TEL.test(p)) pieces[pieces.length - 1] += ' ' + p;
    else pieces.push(p);
  }
  parts.push(...pieces);
  return parts.filter(Boolean);
}

function parseFile(input) {
  const entries = [];
  let week = null, section = null, zone = null, current = null;
  const flush = () => {
    if (!current) return;
    entries.push({ ...parseEntry(current.lines), commune: current.commune, zone: current.zone, start: current.start, end: current.end });
    current = null;
  };

  for (const l of readText(input).split(/\r?\n/).map(norm).flatMap(splitLine)) {
    if (isNoise(l)) continue;
    const w = parseWeek(l);
    if (w) { flush(); week = w; continue; }
    const key = headingKey(l);
    if (SECTIONS[key]) { flush(); section = SECTIONS[key]; zone = null; continue; }
    if (ZONES[key]) { flush(); [section, zone] = ZONES[key]; continue; }
    if (ENTRY_START.test(l)) {
      flush();
      current = { lines: [l], commune: SECTION_LABEL[section], zone: zone || SECTION_LABEL[section], start: week[0], end: week[1] };
      continue;
    }
    if (current) current.lines.push(l);
    else console.error('UNATTACHED:', l);
  }
  flush();
  return entries;
}

// Monthly file first; each later file replaces the (week, zone) lists it contains.
let out = parseFile(inputs[0]);
const zoneOrder = [...new Set(out.map(x => x.zone))];
for (const input of inputs.slice(1)) {
  const update = parseFile(input);
  const replaced = new Set(update.map(x => x.start + '|' + x.zone));
  const before = out.length;
  out = out.filter(x => !replaced.has(x.start + '|' + x.zone)).concat(update);
  console.log(`${path.basename(input)}: ${update.length} entries replace ${before - out.length + update.length} for`, [...replaced].join(', '));
}
out = out
  .map((x, i) => ({ x, i }))
  .sort((a, b) => a.x.start.localeCompare(b.x.start) || zoneOrder.indexOf(a.x.zone) - zoneOrder.indexOf(b.x.zone) || a.i - b.i)
  .map(({ x }) => x);

const weeks = [...new Map(out.map(x => [x.start, { start: x.start, end: x.end }])).values()];
const rows = out.map(x => ({ name: x.name, commune: x.commune, zone: x.zone, phones: x.phones, address: x.address, weekStart: x.start }));

// Sanity check before publishing: a layout change in the PDF shows up as missing weeks or tiny lists.
// The roster has ~110 pharmacies per week.
const perWeek = weeks.map(w => rows.filter(r => r.weekStart === w.start).length);
if (!weeks.length || perWeek.some(n => n < 60)) {
  console.error('Parsed roster looks wrong, nothing written. Pharmacies per week:',
    Object.fromEntries(weeks.map((w, i) => [w.start, perWeek[i]])));
  process.exit(2);
}

// .json output is what the app downloads at launch (see the pharmacie-de-garde-data repo)
if (outFile.endsWith('.json')) {
  const json = { generatedAt: new Date().toISOString(), sources: inputs.map(f => path.basename(f)), weeks, pharmacies: rows };
  fs.writeFileSync(outFile, JSON.stringify(json, null, 1) + '\n');
  console.log('wrote', outFile, `(${rows.length} pharmacies)`);
  process.exit(0);
}

const ts = `/**
 * Tour de garde des pharmacies d'Abidjan (${weeks[0].start} → ${weeks[weeks.length - 1].end})
 * Généré par scripts/parse_garde.js depuis ${inputs.map(f => path.basename(f)).join(', ')} (UNPPCI).
 * Ne pas modifier à la main : relancer le script à chaque nouveau calendrier.
 */

export interface GardeWeek {
  start: string; // YYYY-MM-DD (samedi)
  end: string; // YYYY-MM-DD (vendredi)
}

export interface GardePharmacy {
  name: string;
  commune: string;
  zone: string;
  phones: string[];
  address: string;
  weekStart: string;
}

export const GARDE_WEEKS: GardeWeek[] = ${JSON.stringify(weeks, null, 2)};

export const GARDE_PHARMACIES: GardePharmacy[] = [
${rows.map(r => '  ' + JSON.stringify(r)).join(',\n')},
];
`;
fs.writeFileSync(outFile, ts);
console.log('wrote', outFile);

const count = k => out.reduce((m, d) => (m[d[k]] = (m[d[k]] || 0) + 1, m), {});
console.log('total', out.length);
console.log(count('start'));
console.log(count('commune'));
console.log(count('zone'));
console.log('no phone:', out.filter(d => !d.phones.length).map(d => d.name));
console.log('no address:', out.filter(d => !d.address).map(d => d.name));
