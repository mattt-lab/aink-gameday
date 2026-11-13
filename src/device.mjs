const TIMEOUT_MS = 20_000; // a full render takes ~4 s; anything past this is a hung device

export function createDevice(baseUrl, fetchFn = fetch) {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(path, init) {
    let res;
    try {
      res = await fetchFn(base + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new Error(`device unreachable: ${e.message}`);
    }
    if (!res.ok) throw new Error(`device error: ${path} returned HTTP ${res.status}`);
    return res;
  }

  // Reading the body can fail too (connection dropped mid-response, or an HTML page instead of JSON);
  // map those to the same 'device unreachable' / 'device error' messages the loop keys on.
  async function readJson(res, path) {
    let text;
    try {
      text = await res.text();
    } catch (e) {
      throw new Error(`device unreachable: ${e.message}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`device error: ${path} returned non-JSON`);
    }
  }

  const postJson = async (path, body) =>
    readJson(await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), path);

  return {
    async health() {
      return readJson(await call('/health'), '/health');
    },
    async measure(items) {
      return postJson('/measure', items);
    },
    async naturalHeight(op) {
      const data = await postJson('/canvas', { dryRun: true, commands: [{ ...op, x: 20, y: 0, w: 760 }] });
      const h = data?.validation?.commands?.[0]?.bbox?.[3];
      if (typeof h !== 'number') throw new Error('device error: bad dryRun response');
      return h;
    },
    async render(commands, { refresh = 'full' } = {}) {
      // ?wait=1: return only after the panel refresh finishes, so nothing else hits the device mid-refresh
      // (overlapping requests during a refresh are the leading suspect for the 2026-11-13 reboots).
      return postJson('/canvas?wait=1', { commands, dryRun: false, refresh });
    },
    async screenshot() {
      const res = await call('/canvas/screenshot.png');
      try {
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        throw new Error(`device unreachable: ${e.message}`);
      }
    },
  };
}
