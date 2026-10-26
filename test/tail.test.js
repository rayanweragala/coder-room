import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tail } from '../src/tail.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cr-tail-'));
}

test('first poll reads only the tail and drops the partial first line', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.log');
  const lines = Array.from({ length: 200 }, (_, i) => `line-${String(i).padStart(4, '0')}-xxxxxxxxxx`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const t = new Tail(f, 100);
  const { lines: got } = await t.poll();
  assert.ok(got.length > 1 && got.length < 10);
  assert.equal(got.at(-1), lines.at(-1));
  assert.ok(got.every((l) => /^line-\d{4}-x{10}$/.test(l)));
  fs.rmSync(dir, { recursive: true });
});

test('small file is read whole; appends come back once', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.log');
  fs.writeFileSync(f, 'one\ntwo\n');
  const t = new Tail(f);
  assert.deepEqual((await t.poll()).lines, ['one', 'two']);
  assert.deepEqual((await t.poll()).lines, []);
  fs.appendFileSync(f, 'three\n');
  assert.deepEqual((await t.poll()).lines, ['three']);
  fs.rmSync(dir, { recursive: true });
});

test('half-written last line is buffered until its newline', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.log');
  fs.writeFileSync(f, 'one\ntw');
  const t = new Tail(f);
  assert.deepEqual((await t.poll()).lines, ['one']);
  fs.appendFileSync(f, 'o\nthr');
  assert.deepEqual((await t.poll()).lines, ['two']);
  fs.appendFileSync(f, 'ee\n');
  assert.deepEqual((await t.poll()).lines, ['three']);
  fs.rmSync(dir, { recursive: true });
});

test('truncate restarts from the new content', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.log');
  fs.writeFileSync(f, 'aaaaaaaa\nbbbbbbbb\n');
  const t = new Tail(f);
  await t.poll();
  fs.writeFileSync(f, 'new\n');
  const r = await t.poll();
  assert.equal(r.reset, true);
  assert.deepEqual(r.lines, ['new']);
  fs.rmSync(dir, { recursive: true });
});

test('rotation (rename + new file, new inode) restarts from the new file', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.log');
  fs.writeFileSync(f, 'old1\nold2\nold3\n');
  const t = new Tail(f);
  await t.poll();
  fs.renameSync(f, path.join(dir, 'a-prev-1200.log'));
  fs.writeFileSync(f, 'fresh1\nfresh2\nfresh3\nfresh4\n');
  const r = await t.poll();
  assert.equal(r.reset, true);
  assert.deepEqual(r.lines, ['fresh1', 'fresh2', 'fresh3', 'fresh4']);
  fs.rmSync(dir, { recursive: true });
});

test('missing file yields nothing', async () => {
  const t = new Tail('/nonexistent/zzz.log');
  assert.deepEqual(await t.poll(), { lines: [], reset: false });
});
