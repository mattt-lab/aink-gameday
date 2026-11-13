import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from '../src/device.mjs';

test('device: naturalHeight posts a dryRun and returns bbox height', async () => {
  let url, init;
  const fake = async (u, i) => {
    url = u; init = i;
    return { ok: true, status: 200, json: async () => ({ validation: { commands: [{ bbox: [0, 0, 800, 572] }] } }) };
  };
  const d = createDevice('http://dev', fake);
  const h = await d.naturalHeight({ op: 'text', text: 'hi' });
  assert.equal(h, 572);
  assert.equal(url, 'http://dev/canvas');
  const body = JSON.parse(init.body);
  assert.equal(body.dryRun, true);
  assert.equal(body.commands[0].x, 20);
  assert.equal(body.commands[0].w, 760);
});

test("device: network error becomes 'device unreachable'", async () => {
  const d = createDevice('http://dev', async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => d.health(), /device unreachable/);
  await assert.rejects(() => d.render([]), /device unreachable/);
});

test('device: measure posts the raw array and returns parsed array', async () => {
  let url, init;
  const fake = async (u, i) => { url = u; init = i; return { ok: true, status: 200, json: async () => [{ width: 52, height: 45, lines: 1 }] }; };
  const items = [{ text: '88', size: 24, bold: true }];
  const out = await createDevice('http://dev', fake).measure(items);
  assert.equal(url, 'http://dev/measure');
  assert.deepEqual(JSON.parse(init.body), items);
  assert.deepEqual(out, [{ width: 52, height: 45, lines: 1 }]);
});

test('device: non-2xx becomes device error', async () => {
  const d = createDevice('http://dev', async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await assert.rejects(() => d.health(), /device error.*500/);
});
