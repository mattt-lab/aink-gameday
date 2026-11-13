import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('config: defaults', () => {
  const c = loadConfig('config.json', {});
  assert.equal(c.deviceUrl, 'http://192.168.200.119');
  assert.equal(c.pinnedTeam, 'washington');
  assert.ok(c.timeZone && c.timeZone.length > 0);
});

test('config: AINK_URL overrides deviceUrl', () => {
  const c = loadConfig('config.json', { AINK_URL: 'http://x' });
  assert.equal(c.deviceUrl, 'http://x');
});
