/**
 * Sync from Google Sheet → stations.ts
 *
 * Reads Genres and Stations tabs as source of truth.
 * Also checks Form Responses for new submissions and appends them to Stations tab.
 *
 * Run: npm run sync-stations
 */
import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIONS_FILE = path.join(ROOT, 'src/data/stations.ts');
const SHEET_ID = '1gfB4LfRESfMS25y8mXO80KIBnjAfued3OUuEDjRHvFA';
const CREDENTIALS = process.env.GOOGLE_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
  : path.join(process.env.HOME, 'Documents/lucky-breaks-service-account.json');

function toId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function generateStationsTs(genres, stations) {
  const genreType = genres
    .map(g => `  | '${g.internalName}'`)
    .join('\n');

  const padLabelsArr = genres
    .map(g => `  '${g.padLabel}'`)
    .join(',\n');

  const padGenreMapEntries = genres
    .map(g => `  '${g.padLabel}': '${g.internalName}'`)
    .join(',\n');

  // Group stations by primary genre for section comments
  const byGenre = {};
  for (const g of genres) byGenre[g.internalName] = [];
  const multiGenre = [];

  for (const s of stations) {
    const genres = s.genre.split(',').map(g => g.trim()).filter(Boolean);
    if (genres.length > 1) {
      multiGenre.push({ ...s, genreArr: genres });
    } else {
      const g = genres[0];
      if (byGenre[g]) byGenre[g].push(s);
      else byGenre[g] = [s];
    }
  }

  // Sort stations within each genre alphabetically
  const sortKey = name => {
    const stripped = name.replace(/^(the|a|an)\s+/i, '').toLowerCase();
    return /^\d/.test(stripped) ? 'zzz_' + stripped : stripped;
  };

  for (const g of Object.keys(byGenre)) {
    byGenre[g].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
  }
  multiGenre.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));

  const stationToTs = (s) => {
    const genreArr = Array.isArray(s.genreArr) ? s.genreArr : s.genre.split(',').map(g => g.trim());
    const genreVal = genreArr.length > 1
      ? `[${genreArr.map(g => `'${g}'`).join(', ')}]`
      : `'${genreArr[0]}'`;
    return `  {
    id: '${s.id}',
    name: '${s.name.replace(/'/g, "\\'")}',
    description: '${(s.description || '').replace(/'/g, "\\'")}',
    streamUrl: '${s.streamUrl}',
    websiteUrl: '${s.websiteUrl}',
    genre: ${genreVal},
  },`;
  };

  let stationsSections = '';
  for (const g of Object.keys(byGenre)) {
    if (byGenre[g].length === 0) continue;
    const bar = '─'.repeat(70 - g.length);
    stationsSections += `\n  // ─── ${g} ${bar}\n`;
    stationsSections += byGenre[g].map(stationToTs).join('\n') + '\n';
  }
  if (multiGenre.length > 0) {
    stationsSections += `\n  // ─── MULTI-GENRE ──────────────────────────────────────────────────────\n`;
    stationsSections += multiGenre.map(stationToTs).join('\n') + '\n';
  }

  return `// AUTO-GENERATED — edit via Google Sheet, not directly in this file
// Sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}
// Last synced: ${new Date().toISOString()}

export type Genre =
${genreType};

export interface Station {
  id: string;
  name: string;
  description: string;
  streamUrl: string;
  websiteUrl: string;
  genre: Genre | Genre[];
}

export function stationInGenre(station: Station, genre: Genre): boolean {
  return Array.isArray(station.genre)
    ? station.genre.includes(genre)
    : station.genre === genre;
}

export const PAD_LABELS = [
${padLabelsArr},
] as const;

export type PadLabel = typeof PAD_LABELS[number];

export const PAD_GENRE_MAP: Record<PadLabel, Genre> = {
${padGenreMapEntries},
};

export function getStationsByGenre(genre: Genre): Station[] {
  return stations.filter((s) => stationInGenre(s, genre));
}

export const stations: Station[] = [${stationsSections}];
`;
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    ...(typeof CREDENTIALS === 'string' ? { keyFile: CREDENTIALS } : { credentials: CREDENTIALS }),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Read Genres tab
  const genresRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Genres!A2:B1000',
  });
  const genres = (genresRes.data.values || [])
    .filter(r => r[0] && r[1])
    .map(r => ({ internalName: r[0].trim(), padLabel: r[1].trim() }));

  if (genres.length === 0) {
    console.error('No genres found in Genres tab. Run export-to-sheet.mjs first.');
    process.exit(1);
  }

  const validGenres = new Set(genres.map(g => g.internalName));

  // Read Stations tab
  const stationsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Stations!A2:F10000',
  });
  const stationRows = stationsRes.data.values || [];
  const stations = stationRows
    .filter(r => r[1] && r[3]) // must have name and stream URL
    .map(r => ({
      id: r[0]?.trim() || toId(r[1]),
      name: r[1].trim(),
      description: (r[2] || '').trim(),
      streamUrl: r[3].trim(),
      websiteUrl: (r[4] || '').trim(),
      genre: (r[5] || '').trim(),
    }))
    .filter(s => {
      const gs = s.genre.split(',').map(g => g.trim());
      return gs.length > 0 && gs[0] !== '' && gs.every(g => validGenres.has(g));
    });

  // Check Form Responses for new submissions
  let newStations = [];
  try {
    const formRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Form responses 1!B2:F1000',
    });
    const existingIds = new Set(stations.map(s => s.id));
    const formRows = formRes.data.values || [];
    newStations = formRows
      .filter(r => r[0] && r[2])
      .map(r => ({
        id: toId(r[0]),
        name: r[0].trim(),
        description: (r[1] || '').trim(),
        streamUrl: r[2].trim(),
        websiteUrl: (r[3] || '').trim(),
        genre: (r[4] || '').trim(),
      }))
      .filter(s => {
        if (existingIds.has(s.id)) return false;
        const gs = s.genre.split(',').map(g => g.trim());
        return gs.length > 0 && gs[0] !== '' && gs.every(g => validGenres.has(g));
      });

    if (newStations.length > 0) {
      console.log(`Found ${newStations.length} new form submission(s) — adding to Stations tab:`);
      newStations.forEach(s => console.log(`  + ${s.name} (${s.genre})`));

      // Append to Stations tab
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Stations!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: newStations.map(s => [s.id, s.name, s.description, s.streamUrl, s.websiteUrl, s.genre]),
        },
      });
      stations.push(...newStations);
    }
  } catch {
    // Form responses tab may not exist — that's fine
  }

  console.log(`Generating stations.ts from ${genres.length} genres, ${stations.length} stations...`);

  const content = generateStationsTs(genres, stations);
  writeFileSync(STATIONS_FILE, content);
  console.log('stations.ts written.');

  if (!process.env.CI) {
    console.log('Building...');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    execSync('git config user.email "bot@luckybreaks.xyz"', { cwd: ROOT });
    execSync('git config user.name "lucky-breaks-bot"', { cwd: ROOT });
    execSync('git add src/data/stations.ts', { cwd: ROOT });
    const hasChanges = (() => {
      try { execSync('git diff --staged --quiet', { cwd: ROOT }); return false; }
      catch { return true; }
    })();
    if (hasChanges) {
      execSync(`git commit -m "Sync stations from sheet"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('Done — pushed.');
    } else {
      console.log('No changes.');
    }
  } else {
    if (newStations.length > 0) {
      console.log(`ADDED_STATIONS=${newStations.map(s => s.name).join(', ')}`);
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
