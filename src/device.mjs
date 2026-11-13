export function createDevice(baseUrl, fetchFn = fetch) {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(path, init) {
    let res;
    try {
      res = await fetchFn(base + path, init);
    } catch (e) {
      throw new Error(`device unreachable: ${e.message}`);
    }
    if (!res.ok) throw new Error(`device error: ${path} returned HTTP ${res.status}`);
    return res;
  }

  const postJson = (path, body) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    async health() {
      return (await call('/health')).json();
    },
    async measure(items) {
      return (await postJson('/measure', items)).json();
    },
    async naturalHeight(op) {
      const res = await postJson('/canvas', { dryRun: true, commands: [{ ...op, x: 20, y: 0, w: 760 }] });
      const data = await res.json();
      return data.validation.commands[0].bbox[3];
    },
    async render(commands, { refresh = 'full' } = {}) {
      return (await postJson('/canvas', { commands, dryRun: false, refresh })).json();
    },
    async screenshot() {
      return Buffer.from(await (await call('/canvas/screenshot.png')).arrayBuffer());
    },
  };
}
