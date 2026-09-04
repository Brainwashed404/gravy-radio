/**
 * Appends station records to the "Dead" tab on the Google Sheet: a permanent
 * record of every station that's been removed from the catalog, so removals
 * aren't just silently lost to git history and DELETED_STATION_IDS. Creates
 * the tab (with header row) on first run if it doesn't exist yet.
 *
 * Not part of the regular sync/export flow - run by hand whenever a batch of
 * stations gets retired, pointing DEAD_STATIONS at their data (id, name,
 * description, streamUrl, websiteUrl, genre, reason, dateRemoved). For a
 * removal going forward, the easiest source for that data is the entry
 * that's about to come out of src/data/stations.ts, plus a short reason.
 *
 * Run: node scripts/archive-dead-stations.mjs
 */
import { google } from 'googleapis';
import path from 'path';

const SHEET_ID = '1gfB4LfRESfMS25y8mXO80KIBnjAfued3OUuEDjRHvFA';
const CREDENTIALS = path.join(process.env.HOME, 'Documents/lucky-breaks-service-account.json');
const TAB_NAME = 'Dead';

// One-off backfill (2026-09-04): every station DELETED_STATION_IDS has ever
// denylisted in sync-stations.mjs, recovered from git history at the commit
// right before each was removed. Reasons/dates come from those removal
// commits: 8a8a10c (2026-07-08, 29 stations, mostly Live365's das-edge*
// CDN returning 401), 59373bd (2026-07-23, 4 stations), 57cf990 (2026-09-04,
// the 2 dead Dinamo channels). Leave this array in place as a log of that
// backfill; future one-off runs can replace it with just the new batch.
const DEAD_STATIONS = [
  { id: 'all-star-hip-hop', name: 'All-Star Hip-Hop', description: 'The ultimate destination for the best in hip-hop', streamUrl: 'https://das-edge16-live365-dal02.cdnstream.com/a59976', websiteUrl: 'https://live365.com/station/All-Star-Hip-Hop-a59976', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'the-block-105-radio', name: 'The Block 105 Radio', description: 'Unsigned Hip Hop & RnB', streamUrl: 'https://das-edge15-live365-dal02.cdnstream.com/a87626', websiteUrl: 'https://live365.com/station/The-Block-105-Radio-a87626', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'boom-bap-boombox', name: 'Boom Bap Boombox', description: "If it don't boom bap, its crap", streamUrl: 'https://das-edge15-live365-dal02.cdnstream.com/a27595', websiteUrl: 'https://live365.com/station/Boom-Bap-Boombox-a27595', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'compton-2-new-york-radio', name: 'Compton 2 New York Radio', description: 'Dirty-South, East-Coast rap, Gangsta rap', streamUrl: 'https://das-edge62-live365-dal03.cdnstream.com/a64640', websiteUrl: 'https://live365.com/station/The-Block-105-Radio-a87626', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'diggindaily-radio', name: 'Diggindaily Radio', description: "We digg so you don't have to! We digg daily!", streamUrl: 'https://das-edge13-live365-dal02.cdnstream.com/a79558', websiteUrl: 'https://live365.com/station/DIGGINDAILY-RADIO-a79558', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'gauguin-gardens', name: 'Gauguin Gardens', description: 'Sounds of a dreamt of, but unrealized, artists village in Paul Gauguins old Tahiti', streamUrl: 'https://das-edge15-live365-dal02.cdnstream.com/a94168', websiteUrl: 'https://live365.com/station/Gauguin-Gardens-a94168', genre: 'JAZZ + EXOTICA', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'hawaiian-hifi', name: 'Hawaiian Hi-Fi', description: 'A musical sunset dinner cruise celebrating the era of vintage vinyl Hawaiian & Exotica records', streamUrl: 'https://das-edge63-live365-dal03.cdnstream.com/a52179', websiteUrl: 'https://live365.com/station/Hawaiian-Hi-Fi-a52179', genre: 'JAZZ + EXOTICA', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'hip-hop-museum-network', name: 'The Hip Hop Museum Network', description: 'Hip hop history and culture', streamUrl: 'https://das-edge12-live365-dal02.cdnstream.com/a75', websiteUrl: '', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'interstellar-espionage-radio', name: 'Interstellar Espionage Radio', description: '', streamUrl: 'https://das-edge16-live365-dal02.cdnstream.com/a70', websiteUrl: '', genre: 'JAZZ + EXOTICA', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'jazz-from-gallery-41', name: 'Jazz from Gallery 41', description: 'The full Jazz spectrum from the Blues to the Avant-garde', streamUrl: 'https://das-edge12-live365-dal02.cdnstream.com/a94394', websiteUrl: 'https://live365.com/station/Jazz-from-Gallery-41-a94394', genre: 'JAZZ + EXOTICA', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'jet-set-radio', name: 'Jet Set Radio', description: '', streamUrl: 'https://das-edge15-live365-dal02.cdnstream.com/a25', websiteUrl: '', genre: 'JAZZ + EXOTICA', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'kpiss-fm', name: 'KPISS.FM', description: '', streamUrl: 'https://das-edge14-live365-dal02.cdnstream.com/a18', websiteUrl: '', genre: 'ECLECTIC', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'the-lake', name: 'The Lake', description: 'Continuously Weird', streamUrl: 'https://das-edge13-live365-dal02.cdnstream.com/a80732', websiteUrl: 'https://879thelake.com/', genre: 'ROCK + INDIE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'oldies-by-the-year', name: 'Oldies by the Year', description: '', streamUrl: 'https://das-edge62-live365-dal03.cdnstream.com/a03', websiteUrl: '', genre: 'LEGENDS + ERAS', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'public-enemy-radio', name: 'Public Enemy Radio', description: '', streamUrl: 'https://das-edge13-live365-dal02.cdnstream.com/a24', websiteUrl: '', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'rap-inst', name: 'Rap Inst', description: '', streamUrl: 'https://das-edge14-live365-dal02.cdnstream.com/a74', websiteUrl: '', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'reggae-memories', name: 'Reggae Memories', description: '', streamUrl: 'https://das-edge15-live365-dal02.cdnstream.com/a11', websiteUrl: '', genre: 'DUB + REGGAE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'reggae-town-music', name: 'Reggae Town Music', description: '', streamUrl: 'https://das-edge15-live365-dal02.cdnstream.com/a34', websiteUrl: '', genre: 'DUB + REGGAE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'rods-classic-rock', name: "Rod's Classic Rock", description: '', streamUrl: 'https://das-edge63-live365-dal03.cdnstream.com/a54', websiteUrl: '', genre: 'ROCK + INDIE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'the-slacker-bys', name: 'The Slacker-bys', description: '', streamUrl: 'https://das-edge16-live365-dal02.cdnstream.com/a25', websiteUrl: '', genre: 'ROCK + INDIE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'slackline-radio', name: 'Slackline Radio', description: '', streamUrl: 'https://das-edge62-live365-dal03.cdnstream.com/a54', websiteUrl: '', genre: 'ROCK + INDIE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'soul-monster', name: 'Soul Monster', description: 'The best in 1960s and early 1970s Motown, Funk, Soul and even some early Rock \'n\' roll', streamUrl: 'https://das-edge62-live365-dal03.cdnstream.com/a49028', websiteUrl: 'https://live365.com/station/The-Soul-Monster-a49028', genre: 'SOUL + FUNK', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'soul-source-radio', name: 'Soul Source Radio', description: '', streamUrl: 'https://das-edge63-live365-dal03.cdnstream.com/a45', websiteUrl: '', genre: 'SOUL + FUNK', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'surf-city-radio', name: 'Surf City Radio', description: '', streamUrl: 'https://das-edge13-live365-dal02.cdnstream.com/a40', websiteUrl: '', genre: 'ROCK + INDIE', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'ven-jahs-radio', name: 'Ven-Jahs Radio', description: 'Afrocentric internet radio station promoting socially progressive music with a strong cultural foundation', streamUrl: 'https://das-edge12-live365-dal02.cdnstream.com/a13083', websiteUrl: 'https://live365.com/station/Ven-Jahs-Radio-a13083', genre: 'HIP HOP + RNB', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-08' },
  { id: 'rovr', name: 'ROVR', description: '', streamUrl: 'https://switcher-prod.rovr.live/timezone/plus0', websiteUrl: '', genre: 'ECLECTIC', reason: 'Confirmed dead stream', dateRemoved: '2026-07-08' },
  { id: 'planet-pootwaddle', name: 'Planet Pootwaddle', description: '', streamUrl: 'https://ppw.streamguys1.com/sgplayer-mp3', websiteUrl: '', genre: 'ECLECTIC', reason: 'Confirmed dead stream', dateRemoved: '2026-07-08' },
  { id: 'radio-punctum', name: 'Radio Punctum', description: '', streamUrl: 'https://radiopunctum.cz:8001/radio', websiteUrl: '', genre: 'ECLECTIC', reason: 'Confirmed dead stream', dateRemoved: '2026-07-08' },
  { id: 'hall-oates-radio', name: 'Hall & Oates Radio', description: 'All Hall & Oates All The Time', streamUrl: 'https://3.mystreaming.net/er/hallandoateshits/icecast.audio', websiteUrl: '', genre: 'LEGENDS + ERAS', reason: 'Confirmed dead stream', dateRemoved: '2026-07-08' },
  { id: '20ft-radio', name: '20FT Radio', description: 'Ukraine-based platform sharing music from all over the world', streamUrl: 'https://20ft-radio.radiocult.fm/stream', websiteUrl: 'https://20ftradio.net/', genre: 'ECLECTIC', reason: 'Discontinued', dateRemoved: '2026-07-23' },
  { id: 'mmr-midnite-memories-radio', name: 'Midnite Memories Radio', description: 'Home of Pittsburgh Style Oldies', streamUrl: 'https://das-edge14-live365-dal02.cdnstream.com/a10221', websiteUrl: 'https://live365.com/station/MMR---Midnite-Memories-Radio-a10221', genre: 'SOUL + FUNK', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-23' },
  { id: 'vintage-broadcast', name: 'Vintage Broadcast', description: 'Those were the days', streamUrl: 'https://das-edge62-live365-dal03.cdnstream.com/a93477', websiteUrl: 'https://live365.com/station/Vintage-Broadcast-a93477', genre: 'ECLECTIC', reason: 'Live365 stream, 401 CDN error', dateRemoved: '2026-07-23' },
  { id: 'lucky-breaks', name: 'LuckyBreaks.xyz', description: 'Radio For Beatmakers. Tune In. Chop Up. Follow @LuckyBreaks.xyz. Infinite Loops. Start Digging.', streamUrl: 'https://stream-mixtape-geo.ntslive.net/mixtape27', websiteUrl: 'https://www.nts.live/infinite-mixtapes/feelings', genre: 'SOUL + FUNK', reason: 'Duplicate of the NTS Feelings mixtape (promotional test entry)', dateRemoved: '2026-07-23' },
  { id: 'dinamo-sleep', name: 'Dinamo Sleep', description: 'Lullabies for adults. Our selection of the best ambient electronica', streamUrl: 'https://channels.dinamo.fm/sleep-aac32', websiteUrl: 'https://dinamo.fm/content/4/channels/', genre: 'AMBIENT + CHILL', reason: 'Stream URL permanently 404s, no working replacement found', dateRemoved: '2026-09-04' },
  { id: 'dinamo-discotheque', name: 'Dinamo Discotheque', description: "Let's go back to Studio 54", streamUrl: 'https://channels.dinamo.fm/discotheque-aac32', websiteUrl: 'https://dinamo.fm/content/4/channels/', genre: 'SOUL + FUNK', reason: 'Stream URL permanently 404s, no working replacement found', dateRemoved: '2026-09-04' },
];

async function ensureTab(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(s => s.properties.title === title);
  if (existing) return existing.properties.sheetId;
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  console.log(`Created tab: ${title}`);
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureTab(sheets, SHEET_ID, TAB_NAME);

  // Only append rows for ids not already recorded, so re-running this script
  // (e.g. after adding a new batch to DEAD_STATIONS) doesn't duplicate rows.
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A2:A10000`,
  }).catch(() => ({ data: { values: [] } }));
  const existingIds = new Set((existingRes.data.values || []).flat());

  const toWrite = DEAD_STATIONS.filter(s => !existingIds.has(s.id));
  if (toWrite.length === 0) {
    console.log('Nothing new to archive.');
    return;
  }

  if (existingIds.size === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['ID', 'Name', 'Description', 'Stream URL', 'Website URL', 'Genre', 'Reason', 'Date Removed']] },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: toWrite.map(s => [s.id, s.name, s.description, s.streamUrl, s.websiteUrl, s.genre, s.reason, s.dateRemoved]),
    },
  });
  console.log(`Archived ${toWrite.length} station(s) to the ${TAB_NAME} tab.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
