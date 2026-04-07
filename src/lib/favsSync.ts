const SUPABASE_URL = 'https://catbkwmmwgvpywmsjijq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hRTXuA9pmUqlSNUQXuQFBw_l41pf8qM';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)

export function generateCode(): string {
  return Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

export async function pushFavs(code: string, stationIds: string[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/favs_sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ code, station_ids: stationIds, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
}

export async function pullFavs(code: string): Promise<string[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/favs_sync?code=eq.${encodeURIComponent(code)}&select=station_ids`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = await res.json();
  if (!data.length) throw new Error('Code not found');
  return data[0].station_ids as string[];
}
