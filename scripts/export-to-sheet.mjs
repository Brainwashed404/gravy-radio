/**
 * One-time export: reads stations.ts and populates the Google Sheet
 * with Genres and Stations tabs.
 *
 * Run once: node scripts/export-to-sheet.mjs
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIONS_FILE = path.join(ROOT, 'src/data/stations.ts');
const SHEET_ID = '1gfB4LfRESfMS25y8mXO80KIBnjAfued3OUuEDjRHvFA';
const CREDENTIALS = path.join(process.env.HOME, 'Documents/lucky-breaks-service-account.json');

function parseStationsTs(source) {
  // Parse genres from type definition
  const genreBlock = source.match(/export type Genre =\n([\s\S]*?);\n/);
  const genres = [...genreBlock[1].matchAll(/\| '([^']+)'/g)].map(m => m[1]);

  // Parse PAD_LABELS
  const padLabelsBlock = source.match(/export const PAD_LABELS = \[([\s\S]*?)\] as const/);
  const padLabels = [...padLabelsBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

  // Parse PAD_GENRE_MAP
  const padGenreMapBlock = source.match(/export const PAD_GENRE_MAP[^{]*\{([\s\S]*?)\};/);
  const padGenreMap = {};
  [...padGenreMapBlock[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].forEach(([, k, v]) => {
    padGenreMap[k] = v;
  });

  // Parse station objects by finding each { id: '...' ... } block
  const stationsStart = source.indexOf('\nexport const stations');
  const stationsBody = source.slice(stationsStart);
  const stations = [];

  // Matches both single and double quoted strings for each field
  const sq = `'((?:[^'\\\\]|\\\\.)*)'`;
  const dq = `"((?:[^"\\\\]|\\\\.)*)"`;
  const anyStr = `(?:${sq}|${dq})`;
  const stationRegex = new RegExp(
    `\\{\\s*id:\\s*'([^']+)',\\s*name:\\s*${anyStr},\\s*description:\\s*${anyStr},\\s*streamUrl:\\s*${anyStr},\\s*websiteUrl:\\s*${anyStr},\\s*genre:\\s*([\\s\\S]*?),?\\s*\\},`,
    'g'
  );

  for (const m of stationsBody.matchAll(stationRegex)) {
    const id = m[1];
    const name = (m[2] ?? m[3] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"');
    const description = (m[4] ?? m[5] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"');
    const streamUrl = (m[6] ?? m[7] ?? '').replace(/\\'/g, "'");
    const websiteUrl = (m[8] ?? m[9] ?? '').replace(/\\'/g, "'");
    const genreRaw = m[10].trim();
    let genre;
    if (genreRaw.startsWith('[')) {
      genre = [...genreRaw.matchAll(/'([^']+)'/g)].map(g => g[1]).join(', ');
    } else {
      genre = genreRaw.replace(/^['"]|['"]$/g, '');
    }
    stations.push({ id, name, description, streamUrl, websiteUrl, genre });
  }

  return { genres, padLabels, padGenreMap, stations };
}

async function ensureTab(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
    console.log(`Created tab: ${title}`);
  }
}

async function main() {
  const source = readFileSync(STATIONS_FILE, 'utf8');
  const { genres, padLabels, padGenreMap, stations } = parseStationsTs(source);

  console.log(`Parsed ${genres.length} genres, ${stations.length} stations`);

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Ensure tabs exist
  await ensureTab(sheets, SHEET_ID, 'Genres');
  await ensureTab(sheets, SHEET_ID, 'Stations');

  // Write Genres tab: Internal Name | Pad Label
  const genreRows = [
    ['Internal Name', 'Pad Label'],
    ...padLabels.map(padLabel => [padGenreMap[padLabel], padLabel]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Genres!A1',
    valueInputOption: 'RAW',
    requestBody: { values: genreRows },
  });
  console.log(`Wrote ${genreRows.length - 1} genres to Genres tab`);

  // Write Stations tab: ID | Name | Description | Stream URL | Website URL | Genre
  const stationRows = [
    ['ID', 'Name', 'Description', 'Stream URL', 'Website URL', 'Genre'],
    ...stations.map(s => [s.id, s.name, s.description, s.streamUrl, s.websiteUrl, s.genre]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Stations!A1',
    valueInputOption: 'RAW',
    requestBody: { values: stationRows },
  });
  console.log(`Wrote ${stationRows.length - 1} stations to Stations tab`);

  console.log('Export complete. Sheet is now the master source of truth.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
