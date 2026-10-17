# Pharmacies de garde – Abidjan

On-duty pharmacy roster used by the **Pharmacy De Garde** app.

- **Source:** the official monthly "tour de garde" posted by the UNPPCI (Union Nationale des Pharmaciens Privés de Côte d'Ivoire) at <https://www.unppci.org>. One-week correction sheets ("SEMAINE DU …") are applied on top of the monthly roster.
- **Data file:** [`garde.json`](garde.json), read by the app at launch:
  `https://raw.githubusercontent.com/zoumana84/pharmacie-de-garde-data/main/garde.json`
- **Updates:** a GitHub Action ([`update-garde.yml`](.github/workflows/update-garde.yml)) runs every day at 05:00 UTC and commits `garde.json` when the roster changes. It can also be started by hand from the **Actions** tab ("Run workflow").

## Format

```json
{
  "generatedAt": "2026-10-17T05:00:00.000Z",
  "sources": ["garde-octobre-2026.pdf"],
  "weeks": [{ "start": "2026-10-17", "end": "2026-10-23" }],
  "pharmacies": [
    { "name": "Pharmacie Nissi (Nouvelle)", "commune": "Cocody", "zone": "Bingerville",
      "phones": ["27 22 40 19 04"], "address": "CITE FEH KESSE …", "weekStart": "2026-10-17" }
  ]
}
```

Weeks run Saturday to Friday. Weeks from the previous roster that have not ended yet are kept, so the current week stays available when the next month's roster is posted early.

## If the update fails

The Action fails, and `garde.json` stays unchanged, when the parsed roster looks wrong (fewer than 60 pharmacies in a week). That usually means the PDF layout or a heading changed: add the new heading to `SECTIONS`/`ZONES` in `scripts/parse_garde.js`. To test locally (needs Node 18+ and `pdftotext`):

```
node scripts/fetch_garde.js --out garde.json --pdf-dir pdfs
```
