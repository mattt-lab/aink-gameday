// The only two network data sources. No CFBD calls, ever.

const TIMEOUT_MS = 15_000; // a stalled request must not freeze the loop

async function getJson(url, fetchFn, label) {
  let res;
  try {
    res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`${label} unreachable: ${e.message}`);
  }
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  let text;
  try {
    text = await res.text();
  } catch (e) {
    throw new Error(`${label} unreachable: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON`);
  }
}

/** CFB HQ's published data file (raw GitHub). */
export async function fetchCurrent(url, fetchFn = fetch) {
  const data = await getJson(url, fetchFn, 'current.json');
  if (!Array.isArray(data?.allGames)) throw new Error('current.json has no allGames');
  return data;
}

/** ESPN FBS scoreboard for one ESPN date ('YYYYMMDD'). */
export async function fetchScoreboard(base, ymd, fetchFn = fetch) {
  const data = await getJson(`${base}?groups=80&limit=300&dates=${ymd}`, fetchFn, `ESPN ${ymd}`);
  if (!Array.isArray(data?.events)) throw new Error(`ESPN ${ymd} has no events list`);
  return data.events;
}
