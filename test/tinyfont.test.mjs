import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyWidth, tinyTextOp, TINY_H } from '../src/tinyfont.mjs';

test('tinyWidth: 6 px per glyph, 3 per space, minus trailing gap', () => {
  assert.equal(tinyWidth('AB'), 11);
  assert.equal(tinyWidth('A B'), 14);
  assert.equal(tinyWidth(''), 0);
});

test('tinyTextOp: 1-bit raw bitmap, rows byte-aligned, ink = 0 bits', () => {
  const op = tinyTextOp('I', 10, 20);
  assert.deepEqual([op.op, op.x, op.y, op.w, op.h], ['raw_bitmap', 10, 20, 5, TINY_H]);
  const rows = [...Buffer.from(op.data, 'base64')];
  assert.equal(rows.length, TINY_H); // 5 px wide -> 1 byte per row
  assert.equal(rows[0], 0b10001111);  // '.###.' -> ink at columns 1-3, padding bits stay white
});

test('tinyTextOp: clips to maxW', () => {
  assert.equal(tinyTextOp('VS #22 MIZ', 0, 0, 20).w, 20);
});
