# ab1 — slugify and titleCase

## Goal
Add two helpers to `src/text.js`, exported by name, with tests in `tests/text.spec.js`.

## Items
### 1. `slugify(text, { maxLength } = {})`
- Non-string `text` throws `TypeError`.
- Lower-case; strip accents (`'Café'` → `'cafe'`, via NFD and removing combining marks).
- Every run of characters other than `a-z` and `0-9` becomes a single `-`; no leading or trailing `-`.
- `maxLength` is optional. When given it must be a positive integer, otherwise throw `RangeError`.
  The result is cut to at most `maxLength` characters and then any trailing `-` is removed.
- Examples: `slugify('  Hello, World!  ')` → `'hello-world'`; `slugify('Hello World', { maxLength: 6 })` → `'hello'`;
  `slugify('!!!')` → `''`.

### 2. `titleCase(text)`
- Non-string `text` throws `TypeError`; `''` returns `''`.
- Words are separated by whitespace, and the original whitespace is kept as is.
- Each word is lower-cased, then its first letter is upper-cased; each part of a hyphenated word is capitalized
  (`'well-known'` → `'Well-Known'`); apostrophes do not start a new word (`"don't"` → `"Don't"`).
- The small words `a an the and or of in on to for` stay lower-case, except the first and the last word.
- Examples: `titleCase('the lord of the rings')` → `'The Lord of the Rings'`; `titleCase('a well-known fact')` →
  `'A Well-Known Fact'`; `titleCase('WHAT TO DO')` → `'What to Do'`.

## Tests
Add tests for every rule and example above to `tests/text.spec.js`; keep the existing tests.

## Gates
`npm test` passes.

## Report
Write `.rounds/ab1-report.md`: files changed, items met, `npm test` output summary.

## Out of scope
Anything else; no new files besides the tests and the report; no dependencies.
