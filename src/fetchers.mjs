// The only two network data sources. No CFBD calls, ever.

async function getJson(url, fetchFn, label) {
  let res;
  try {
    res = await fetchFn(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new Error(`${label} unreachable: ${e.message}`);
  }
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const text = await res.text();
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
  return Array.isArray(data?.events) ? data.events : [];
}
