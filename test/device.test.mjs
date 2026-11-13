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
