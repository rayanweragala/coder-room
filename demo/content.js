// Invented, neutral content for the demo room: two projects, a few rounds each. No real names, paths or projects.

const item = (title, file, before, after) => ({ title, file, before, after });

const CART = [
  item('Sum line items', 'src/cart.js', 'return 0;', 'return items.reduce((n, i) => n + i.price * i.qty, 0);'),
  item('Round to cents', 'src/money.js', 'return value;', 'return Math.round(value * 100) / 100;'),
  item('Apply tax rate', 'src/tax.js', 'return net;', 'return net * (1 + rate);'),
  item('Handle empty carts', 'src/cart.js', 'if (!items) return 0;', 'if (!items || items.length === 0) return 0;'),
  item('Format totals', 'src/format.js', 'return String(n);', "return n.toFixed(2).replace('.', ',');"),
  item('Cart summary endpoint', 'src/api/summary.js', 'res.end();', 'res.end(JSON.stringify(summary(cart)));'),
  item('Reject negative quantities', 'src/validate.js', 'return true;', 'return Number.isInteger(qty) && qty > 0;'),
  item('Totals unit tests', 'test/cart.test.js', '// todo', "assert.equal(total([{ price: 2, qty: 3 }]), 6);"),
];

const DISCOUNTS = [
  item('Coupon model', 'src/coupon.js', 'export const coupons = [];', 'export const coupons = new Map();'),
  item('Percent discounts', 'src/discounts.js', 'return total;', 'return total * (1 - coupon.percent / 100);'),
  item('Fixed-amount discounts', 'src/discounts.js', 'return total;', 'return Math.max(0, total - coupon.amount);'),
  item('Expiry check', 'src/coupon.js', 'return true;', 'return !coupon.expires || coupon.expires > now;'),
  item('One coupon per cart', 'src/cart.js', 'cart.coupons.push(code);', 'cart.coupons = [code];'),
  item('Coupon lookup route', 'src/api/coupons.js', 'res.end();', 'res.end(JSON.stringify(find(req.query.code)));'),
  item('Usage limits', 'src/coupon.js', 'return true;', 'return coupon.used < coupon.limit;'),
  item('Show discount in summary', 'src/api/summary.js', 'return { total };', 'return { total, discount };'),
  item('Discount unit tests', 'test/discounts.test.js', '// todo', "assert.equal(percentOff(100, 10), 90);"),
  item('Error messages', 'src/validate.js', "throw new Error('bad');", "throw new Error('Unknown or expired code');"),
];

const SHIPPING = [
  item('Threshold setting', 'src/config.js', 'freeShipping: null', 'freeShipping: 50'),
  item('Shipping cost helper', 'src/shipping.js', 'return 5;', 'return total >= config.freeShipping ? 0 : 5;'),
  item('Include in summary', 'src/api/summary.js', 'return { total };', 'return { total, shipping };'),
  item('Progress hint', 'src/format.js', 'return "";', 'return `Add ${left} more for free shipping`;'),
  item('Edge: exactly at threshold', 'src/shipping.js', 'total > t', 'total >= t'),
  item('Shipping unit tests', 'test/shipping.test.js', '// todo', 'assert.equal(shippingFor(50), 0);'),
  item('Update the README table', 'README.md', '| Shipping | flat |', '| Shipping | free over 50 |'),
  item('Changelog entry', 'CHANGELOG.md', '## Unreleased', '## Unreleased\n- Free shipping over 50'),
];

const NAV = [
  item('Sidebar data file', 'site/nav.json', '[]', '[{"title":"Guide","path":"/guide"}]'),
  item('Render the sidebar', 'site/sidebar.js', 'return "";', 'return items.map(link).join("");'),
  item('Highlight the current page', 'site/sidebar.js', 'cls = "";', 'cls = path === current ? "on" : "";'),
  item('Collapse long sections', 'site/sidebar.js', 'open = true;', 'open = section.items.length < 6;'),
  item('Keyboard navigation', 'site/keys.js', '// todo', "if (e.key === 'j') focusNext();"),
  item('Search box markup', 'site/search.html', '<div></div>', '<input type="search" placeholder="Search docs">'),
  item('Index builder', 'site/search.js', 'return [];', 'return pages.map((p) => ({ path: p.path, words: tokens(p.text) }));'),
  item('Rank by title match', 'site/search.js', 'return hits;', 'return hits.sort((a, b) => b.title - a.title);'),
  item('Sidebar tests', 'test/sidebar.test.js', '// todo', "assert.match(render(items, '/guide'), /class=\"on\"/);"),
];

const LINKS = [
  item('Link checker script', 'tools/links.js', '// todo', 'for (const page of pages) check(page);'),
  item('Report broken links', 'tools/links.js', 'return;', "console.log(`broken: ${url} in ${page}`);"),
  item('Skip external links', 'tools/links.js', 'check(url);', "if (!url.startsWith('http')) check(url);"),
  item('Anchor checks', 'tools/links.js', 'return true;', 'return headings.includes(anchor);'),
  item('Run in CI', '.github/workflows/docs.yml', 'steps: []', 'steps: [{ run: "node tools/links.js" }]'),
  item('Fix two broken links', 'docs/guide.md', '](/setup-old)', '](/setup)'),
];

const ORDERS = [
  item('Order number format', 'src/orders.js', 'return id;', "return `A-${String(id).padStart(6, '0')}`;"),
  item('Confirmation text', 'src/mail.js', 'return "";', 'return `Thanks for your order ${number}.`;'),
  item('Queue the confirmation', 'src/orders.js', '// todo', 'queue.push(confirmation(order));'),
  item('Order tests', 'test/orders.test.js', '// todo', "assert.equal(orderNumber(7), 'A-000007');"),
];

export const CHECKOUT_UI = [
  item('Code input and Apply button', 'web/checkout.html', '<div id="totals"></div>', '<input id="code"><button id="apply">Apply</button><div id="totals"></div>'),
  item('Call the apply-code endpoint', 'web/checkout.js', '// todo', "const res = await fetch('/api/coupons/apply', { method: 'POST', body: code });"),
  item('Show the discount line', 'web/summary.js', 'return lines;', 'return discount ? [...lines, `Discount -${money(discount)}`] : lines;'),
  item('Message for unknown codes', 'web/checkout.js', 'return;', "if (!res.ok) return showError('Unknown or expired code');"),
  item('Remove-code link', 'web/summary.js', 'return html;', "return html + (code ? '<a id=\"remove\">Remove code</a>' : '');"),
  item('Disable Apply while loading', 'web/checkout.js', 'button.disabled = false;', 'button.disabled = pending;'),
  item('Keep the code after a reload', 'web/checkout.js', '// todo', "sessionStorage.setItem('code', code);"),
  item('Focus the input after an error', 'web/checkout.js', 'showError(msg);', 'showError(msg); input.focus();'),
  item('Checkout UI tests', 'test/checkout-ui.test.js', '// todo', 'assert.match(render({ discount: 5 }), /Discount -5.00/);'),
];

export { DISCOUNTS };

export const PROJECTS = [
  {
    name: 'acme-shop',
    what: 'A small online shop: product pages, a cart and a checkout API. Plain Node, no framework.',
    next: 'Add discount codes end to end: API (q04), checkout UI (q05), then a review round.',
    gate: 'npm test',
    rounds: [
      { id: 'q01', title: 'Cart totals', goal: 'Compute cart totals with tax and rounding, and expose them through a summary endpoint.', coder: 'codex-ui gpt-6-luna', style: 'codex', done: true, items: CART },
      { id: 'q02', title: 'Free-shipping threshold', goal: 'Waive shipping above a configurable order total and show how much is left to reach it.', coder: 'claude-api claude-sonnet-5-5', style: 'claude', done: true, items: SHIPPING },
      { id: 'q03', title: 'Order confirmation', goal: 'Give every order a readable number and queue a confirmation message for it.', coder: 'codex-ui gpt-6-luna', style: 'codex', done: true, items: ORDERS },
    ],
  },
  {
    name: 'docs-site',
    what: 'A static documentation site with a sidebar, search and a link checker.',
    next: 'Review q02 (link checker) when the coder finishes.',
    gate: 'npm test',
    rounds: [
      { id: 'q01', title: 'Sidebar and search', goal: 'Add a generated sidebar with keyboard navigation and a client-side search.', coder: 'codex-docs gpt-6-luna', style: 'codex', done: true, items: NAV },
      { id: 'q02', title: 'Link checker', goal: 'Add a script that finds broken internal links and anchors and runs in CI.', coder: 'codex-docs gpt-6-luna', style: 'codex', items: LINKS },
    ],
  },
];

export const specText = (round) => [
  `# ${round.id}: ${round.title}`, '', '## Goal', round.goal, '', '## Items',
  ...round.items.flatMap((it, i) => [`### ${i + 1}. ${it.title}`, `Change \`${it.file}\` and cover it with a test.`, '']),
  '## Gates', '1. The project test command passes.', '',
].join('\n');

export const reportText = (round, gate) => [
  `# ${round.id} report`, '',
  `- Implemented ${round.items.length} items: ${round.items.slice(0, 3).map((i) => i.title.toLowerCase()).join(', ')} and more.`,
  `- Gate \`${gate}\` passes.`, '- No files outside the round file were touched.', '',
].join('\n');

export const handoffText = (project) => [
  `# ${project.name} handoff`, '', '## What this is', project.what, '', '## Next step', `- ${project.next}`, '',
].join('\n');
