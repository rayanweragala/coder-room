import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, renderMarkdown, plainText } from '../public/markdown.js';
import { parseInline } from '../public/md-inline.js';

const inline = (s) => parseInline(s);
const kinds = (nodes) => nodes.map((n) => n.t);

/** Minimal DOM: only what renderMarkdown may use. innerHTML is a trap. */
function fakeDoc() {
  const mk = (tag) => {
    const e = {
      tag, children: [], dataset: {}, className: '', textContent: '',
      append(...k) { for (const c of k) (c.frag ? this.children.push(...c.children) : this.children.push(c)); },
    };
    Object.defineProperty(e, 'innerHTML', { set() { throw new Error('innerHTML used'); } });
    return e;
  };
  return {
    createElement: mk,
    createTextNode: (v) => ({ tag: '#text', v }),
    createDocumentFragment: () => ({ ...mk('#frag'), frag: true }),
  };
}
const html = (n) => (n.tag === '#text' ? n.v : n.tag === '#frag' ? n.children.map(html).join('') : `<${n.tag}${n.href ? `[${n.href}]` : ''}>${n.textContent || ''}${n.children.map(html).join('')}</${n.tag}>`);
const render = (s) => html(renderMarkdown(parseMarkdown(s), fakeDoc()));

test('paragraphs and line breaks', () => {
  const b = parseMarkdown('one\ntwo\n\nthree');
  assert.deepEqual(b.map((x) => x.type), ['p', 'p']);
  assert.deepEqual(kinds(b[0].inline), ['text', 'br', 'text']);
});

test('headings #..#### are blocks, ##### stays text', () => {
  const b = parseMarkdown('# a\n## b\n### c\n#### d\n##### e');
  assert.deepEqual(b.slice(0, 4).map((x) => x.level), [1, 2, 3, 4]);
  assert.equal(b[4].type, 'p');
});

test('bold, italic, underscore italic, inline code', () => {
  assert.deepEqual(inline('a **b** c'), [{ t: 'text', v: 'a ' }, { t: 'b', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }]);
  assert.equal(inline('*it*')[0].t, 'i');
  assert.equal(inline('_it_')[0].t, 'i');
  assert.deepEqual(inline('`x **y**`'), [{ t: 'code', v: 'x **y**' }]);
  assert.deepEqual(inline('snake_case_name'), [{ t: 'text', v: 'snake_case_name' }]);
  assert.equal(inline('**bold *and* italic**')[0].c[1].t, 'i');
});

test('fenced code block keeps text verbatim, with language', () => {
  const [c, p] = parseMarkdown('```js\nconst a = **1**;\n\nx\n```\nafter');
  assert.deepEqual([c.type, c.lang, c.text], ['code', 'js', 'const a = **1**;\n\nx']);
  assert.equal(p.type, 'p');
  assert.match(render('```\nx\n```'), /^<pre><code>x<\/code><\/pre>$/);
});

test('lists: bullet, numbered, one level of nesting', () => {
  const [ul, ol] = parseMarkdown('- a\n  - a1\n  - a2\n- b\n\n1. one\n2. two');
  assert.equal(ul.type, 'ul');
  assert.equal(ul.items.length, 2);
  assert.equal(ul.items[0].children.length, 2);
  assert.equal(ol.type, 'ol');
  assert.equal(ol.items.length, 2);
  assert.equal(parseMarkdown('* star item')[0].type, 'ul');
  assert.match(render('- a\n  - b'), /<ul><li>a<ul><li>b<\/li><\/ul><\/li><\/ul>/);
});

test('quote', () => {
  const [q] = parseMarkdown('> one\n> two');
  assert.equal(q.type, 'quote');
  assert.deepEqual(kinds(q.inline), ['text', 'br', 'text']);
});

test('GitHub pipe table', () => {
  const [t] = parseMarkdown('| a | b |\n|---|:-:|\n| 1 | **2** |\n| 3 | 4 |');
  assert.equal(t.type, 'table');
  assert.equal(t.head.length, 2);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][1][0].t, 'b');
  assert.match(render('a | b\n--|--\n1 | 2'), /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
});

test('links: only http(s) become anchors, others plain text', () => {
  const ok = inline('see [docs](https://example.com/a?b=1) now');
  assert.deepEqual(ok[1], { t: 'a', href: 'https://example.com/a?b=1', c: [{ t: 'text', v: 'docs' }] });
  assert.equal(inline('[x](http://a.b)')[0].t, 'a');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '/rel/path', 'vbscript:x']) {
    assert.deepEqual(inline(`[click](${bad})`), [{ t: 'text', v: 'click' }], bad);
  }
  assert.match(render('[a](https://x.y)'), /<a\[https:\/\/x\.y\/\]>a<\/a>/);
  assert.equal(render('[a](javascript:alert(1))'), '<p>a</p>');
  assert.deepEqual(inline('src/a/b.js and ~/x/y.txt'), [{ t: 'text', v: 'src/a/b.js and ~/x/y.txt' }]);
});

test('anchors get target and rel', () => {
  const doc = fakeDoc();
  const a = renderMarkdown(parseMarkdown('[a](https://x.y)'), doc).children[0].children[0];
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
});

test('unclosed markers render literally', () => {
  for (const s of ['**open', '*open', '_open', '`open', '[open](http', '[a]', '[a](b', 'a ** b ** c', '2 * 3 * 4']) {
    assert.equal(plainText(s), s, s);
  }
  assert.equal(parseMarkdown('```js\nnever closed')[0].type, 'code');
});

test('odd input never throws; empty input is empty', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
  assert.deepEqual(parseMarkdown(undefined), []);
  const odd = ['|', '||\n||', '| a |\n|--', '>', '- ', '-', '1.', '***', '____', '[](', '[]()', '``', '\u0000', '\r\n', '#', '# ', '**', '*****', '- - - -',
    '[[[[]]]]((((', '`'.repeat(5), '* ' + '*a '.repeat(50), '> > > x', '  - a\n- b\n    - c'];
  for (const s of odd) {
    assert.doesNotThrow(() => render(s), JSON.stringify(s));
    assert.doesNotThrow(() => plainText(s));
  }
});

test('text with markup characters stays text', () => {
  const [p] = parseMarkdown('<img src=x onerror=alert(1)> & **<b>**');
  assert.deepEqual(p.inline.map((n) => n.t), ['text', 'b']);
  assert.equal(p.inline[0].v, '<img src=x onerror=alert(1)> & ');
});

test('plainText strips markers to one line', () => {
  assert.equal(plainText('**Plan** the `fix`\n- one\n- two'), 'Plan the fix one two');
  assert.equal(plainText('# Head\n[t](https://a.b)'), 'Head t');
});

test('a 50 KB input parses and renders fast', () => {
  const para = 'Some **bold** and *it* text with `code` and [a link](https://example.com) and file src/a.js here.\n';
  const big = (para + '- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n').repeat(Math.ceil(50_000 / 200)).slice(0, 51_200);
  const nasty = '*a '.repeat(17_000);
  for (const [s, limit] of [[big, 200], [nasty, 200], ['**'.repeat(25_000), 200], ['['.repeat(50_000), 200], ['_a'.repeat(25_000), 200]]) {
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      render(s);
      runs.push(performance.now() - t0);
    }
    const ms = runs.sort((a, b) => a - b)[2];
    assert.ok(ms < limit, `${s.slice(0, 12)} took a median of ${ms} ms`);
  }
});
