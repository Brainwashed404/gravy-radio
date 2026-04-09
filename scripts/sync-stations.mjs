import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIONS_FILE = path.join(ROOT, 'src/data/stations.ts');
const SHEET_ID = '1gfB4LfRESfMS25y8mXO80KIBnjAfued3OUuEDjRHvFA';
// In CI: GOOGLE_CREDENTIALS env var contains the JSON content directly
// Locally: falls back to the file on disk
const CREDENTIALS = process.env.GOOGLE_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
  : path.join(process.env.HOME, 'Documents/lucky-breaks-service-account.json');

const VALID_GENRES = [
  'AMBIENT + CHILLOUT',
  'CLASSICAL',
  'DISCO + FUNK + SOUL',
  'DNB + JUNGLE + RAVE',
  'DUB + REGGAE',
  'ECLECTIC ELECTRIC',
  'HIP HOP + RNB',
  'HOUSE + UKG',
  'JAZZ',
  'LEGENDS',
  'ROCK + INDIE',
  'VOCAL DRAMA + ATMOS',
];

function toId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchNewStations() {
  const auth = new google.auth.GoogleAuth({
    ...(typeof CREDENTIALS === 'string' ? { keyFile: CREDENTIALS } : { credentials: CREDENTIALS }),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A2:F1000',
  });
  const rows = res.data.values || [];
  return rows
    .filter(r => r[1] && r[3]) // must have name and stream URL
    .map(r => ({
      id: toId(r[1]),
      name: r[1].trim(),
      description: (r[2] || '').trim(),
      streamUrl: r[3].trim(),
      websiteUrl: (r[4] || '').trim(),
      genre: r[5]?.trim() || '',
    }))
    .filter(s => VALID_GENRES.includes(s.genre));
}

function getExistingIds(source) {
  const matches = source.matchAll(/id: '([^']+)'/g);
  return new Set([...matches].map(m => m[1]));
}

function stationToTs(s) {
  const genre = `'${s.genre}'`;
  return `  {
    id: '${s.id}',
    name: '${s.name.replace(/'/g, "\\'")}',
    description: '${s.description.replace(/'/g, "\\'")}',
    streamUrl: '${s.streamUrl}',
    websiteUrl: '${s.websiteUrl}',
    genre: ${genre},
  },`;
}

async function main() {
  console.log('Fetching new stations from Google Sheet...');
  const newStations = await fetchNewStations();

  if (newStations.length === 0) {
    console.log('No valid stations found in sheet.');
    return;
  }

  const source = readFileSync(STATIONS_FILE, 'utf8');
  const existingIds = getExistingIds(source);

  const toAdd = newStations.filter(s => !existingIds.has(s.id));

  if (toAdd.length === 0) {
    console.log('All sheet stations already exist in stations.ts — nothing to add.');
    return;
  }

  console.log(`Adding ${toAdd.length} new station(s):`);
  toAdd.forEach(s => console.log(`  + ${s.name} (${s.genre})`));

  // Insert each station before the closing bracket of its genre section
  let updated = source;
  for (const s of toAdd) {
    const block = stationToTs(s);
    // Find the next section comment or the export closing after this genre's stations
    const genreComment = `// ─── ${s.genre}`;
    const idx = updated.indexOf(genreComment);
    if (idx === -1) {
      // Genre section doesn't have a comment header — append before end of stations array
      updated = updated.replace(/\n];\n\nexport const PAD_LABELS/, `\n${block}\n];\n\nexport const PAD_LABELS`);
    } else {
      // Find the next section comment after this genre
      const nextComment = updated.indexOf('\n  // ───', idx + 1);
      if (nextComment === -1) {
        updated = updated.replace(/\n];\n\nexport const PAD_LABELS/, `\n${block}\n];\n\nexport const PAD_LABELS`);
      } else {
        updated = updated.slice(0, nextComment) + '\n' + block + updated.slice(nextComment);
      }
    }
  }

  writeFileSync(STATIONS_FILE, updated);
  console.log('stations.ts updated.');

  // In CI, commit/push is handled by the workflow
  if (!process.env.CI) {
    console.log('Building...');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    const names = toAdd.map(s => s.name).join(', ');
    execSync(`git config user.email "bot@luckybreaks.xyz"`, { cwd: ROOT });
    execSync(`git config user.name "lucky-breaks-bot"`, { cwd: ROOT });
    execSync(`git add src/data/stations.ts`, { cwd: ROOT });
    execSync(`git commit -m "Add stations from Google Form: ${names}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    console.log(`Done. ${toAdd.length} station(s) added and pushed.`);
  } else {
    // Print names for the workflow commit message
    console.log(`ADDED_STATIONS=${toAdd.map(s => s.name).join(', ')}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
