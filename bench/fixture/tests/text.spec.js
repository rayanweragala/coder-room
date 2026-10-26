import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalize, countWords } from '../src/text.js';

test('capitalize fixes case', () => {
  assert.equal(capitalize('hELLO'), 'Hello');
  assert.equal(capitalize(''), '');
});

test('capitalize rejects non-strings', () => {
  assert.throws(() => capitalize(5), TypeError);
});

test('countWords counts runs of words', () => {
  assert.equal(countWords('  one  two\tthree\n'), 3);
  assert.equal(countWords('   '), 0);
});

test('countWords rejects non-strings', () => {
  assert.throws(() => countWords(null), TypeError);
});
