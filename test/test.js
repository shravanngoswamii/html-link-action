'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isExternal,
  stripTracking,
  processHtml,
  extractExternalLinks,
  buildChanges,
  TRACKING_PARAM_NAMES,
} = require('../lib.js');
const {
  DEFAULT_BLOCKED_STATUSES,
  DEFAULT_RETRY_WITH_GET_STATUSES,
  parseStatusList,
  shouldRetryWithGet,
  shouldTreatAsBlocked,
} = require('../index.js');

describe('isExternal', () => {
  test('http URL is external',           () => assert.equal(isExternal('http://example.com'), true));
  test('https URL is external',          () => assert.equal(isExternal('https://example.com'), true));
  test('HTTPS uppercase is external',    () => assert.equal(isExternal('HTTPS://example.com'), true));
  test('relative path is internal',      () => assert.equal(isExternal('/page'), false));
  test('root-relative is internal',      () => assert.equal(isExternal('/'), false));
  test('anchor is internal',             () => assert.equal(isExternal('#section'), false));
  test('mailto is internal',             () => assert.equal(isExternal('mailto:x@y.com'), false));
  test('protocol-relative is internal',  () => assert.equal(isExternal('//example.com'), false));
  test('empty string is internal',       () => assert.equal(isExternal(''), false));
});

describe('TRACKING_PARAM_NAMES', () => {
  test('is a non-empty array',  () => assert.ok(Array.isArray(TRACKING_PARAM_NAMES) && TRACKING_PARAM_NAMES.length > 0));
  test('includes utm_source',   () => assert.ok(TRACKING_PARAM_NAMES.includes('utm_source')));
  test('includes fbclid',       () => assert.ok(TRACKING_PARAM_NAMES.includes('fbclid')));
});

describe('stripTracking', () => {
  test('removes utm_source', () =>
    assert.equal(stripTracking('https://example.com/page?utm_source=test'), 'https://example.com/page'));

  test('removes multiple utm params', () =>
    assert.equal(stripTracking('https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c'), 'https://example.com/'));

  test('removes fbclid', () =>
    assert.equal(stripTracking('https://example.com/?fbclid=abc123'), 'https://example.com/'));

  test('removes gclid', () =>
    assert.equal(stripTracking('https://example.com/?gclid=xyz'), 'https://example.com/'));

  test('preserves non-tracking params', () =>
    assert.equal(stripTracking('https://example.com/?q=julia&page=2'), 'https://example.com/?q=julia&page=2'));

  test('strips tracking but keeps clean params', () =>
    assert.equal(stripTracking('https://example.com/?q=hello&utm_source=test&page=2'), 'https://example.com/?q=hello&page=2'));

  test('returns original on invalid URL', () =>
    assert.equal(stripTracking('not-a-url'), 'not-a-url'));

  test('returns original if nothing to strip', () =>
    assert.equal(stripTracking('https://example.com/page'), 'https://example.com/page'));
});

describe('processHtml — rel attributes', () => {
  test('adds nofollow', () =>
    assert.match(processHtml('<a href="https://example.com">link</a>', { nofollow: true }), /rel="nofollow"/));

  test('adds noopener', () =>
    assert.match(processHtml('<a href="https://example.com">link</a>', { noopener: true }), /rel="noopener"/));

  test('adds noreferrer', () =>
    assert.match(processHtml('<a href="https://example.com">link</a>', { noreferrer: true }), /rel="noreferrer"/));

  test('adds all three rel values together', () => {
    const out = processHtml('<a href="https://example.com">link</a>', { nofollow: true, noopener: true, noreferrer: true });
    assert.match(out, /nofollow/);
    assert.match(out, /noopener/);
    assert.match(out, /noreferrer/);
  });

  test('merges with existing rel — does not replace', () => {
    const out = processHtml('<a href="https://example.com" rel="noopener">link</a>', { nofollow: true });
    assert.match(out, /noopener/);
    assert.match(out, /nofollow/);
  });

  test('does not duplicate an already-present rel value', () => {
    const out = processHtml('<a href="https://example.com" rel="nofollow">link</a>', { nofollow: true });
    assert.doesNotMatch(out, /nofollow nofollow/);
    assert.equal((out.match(/nofollow/g) || []).length, 1);
  });

  test('handles single-quoted existing rel', () => {
    const out = processHtml("<a href='https://example.com' rel='noopener'>link</a>", { nofollow: true });
    assert.match(out, /nofollow/);
    assert.match(out, /noopener/);
  });
});

describe('processHtml — external-only (default)', () => {
  test('skips relative links by default', () => {
    const input = '<a href="/page">link</a>';
    assert.equal(processHtml(input, { nofollow: true }), input);
  });

  test('skips anchor links by default', () => {
    const input = '<a href="#section">link</a>';
    assert.equal(processHtml(input, { nofollow: true }), input);
  });

  test('processes external links by default', () =>
    assert.match(processHtml('<a href="https://example.com">link</a>', { nofollow: true }), /nofollow/));

  test('processes internal links when externalOnly=false', () =>
    assert.match(processHtml('<a href="/page">link</a>', { nofollow: true, externalOnly: false }), /nofollow/));

  test('processes anchor links when externalOnly=false', () =>
    assert.match(processHtml('<a href="#top">link</a>', { nofollow: true, externalOnly: false }), /nofollow/));
});

describe('processHtml — targetBlank', () => {
  test('adds target=_blank to external links', () =>
    assert.match(processHtml('<a href="https://example.com">link</a>', { targetBlank: true }), /target="_blank"/));

  test('does not add target=_blank to internal links', () =>
    assert.doesNotMatch(processHtml('<a href="/page">link</a>', { targetBlank: true }), /target/));

  test('does not overwrite existing target attribute', () => {
    const out = processHtml('<a href="https://example.com" target="_self">link</a>', { targetBlank: true });
    assert.match(out, /target="_self"/);
    assert.doesNotMatch(out, /_blank/);
  });

  test('works alongside rel attributes', () => {
    const out = processHtml('<a href="https://example.com">link</a>', { noopener: true, targetBlank: true });
    assert.match(out, /rel="noopener"/);
    assert.match(out, /target="_blank"/);
  });
});

describe('processHtml — stripTracking', () => {
  test('strips utm params from external links', () =>
    assert.doesNotMatch(
      processHtml('<a href="https://example.com/?utm_source=gh">link</a>', { stripTracking: true }),
      /utm_source/
    ));

  test('keeps non-tracking params', () => {
    const out = processHtml('<a href="https://example.com/?q=test&utm_source=gh">link</a>', { stripTracking: true });
    assert.match(out, /q=test/);
    assert.doesNotMatch(out, /utm_source/);
  });

  test('does not touch internal links (externalOnly default)', () => {
    const input = '<a href="/search?utm_source=internal">link</a>';
    assert.equal(processHtml(input, { stripTracking: true }), input);
  });

  test('strips tracking AND adds rel together', () => {
    const out = processHtml('<a href="https://example.com/?utm_source=gh&q=hi">link</a>', { nofollow: true, stripTracking: true });
    assert.doesNotMatch(out, /utm_source/);
    assert.match(out, /nofollow/);
    assert.match(out, /q=hi/);
  });
});

describe('processHtml — href edge cases', () => {
  test('link with no href is left unchanged', () => {
    const input = '<a name="anchor">text</a>';
    assert.equal(processHtml(input, { nofollow: true }), input);
  });

  test('single-quoted href is processed', () =>
    assert.match(processHtml("<a href='https://example.com'>link</a>", { nofollow: true }), /nofollow/));

  test('link with class is processed correctly', () => {
    const out = processHtml('<a href="https://example.com" class="btn primary">link</a>', { nofollow: true });
    assert.match(out, /rel="nofollow"/);
    assert.match(out, /class="btn primary"/);
  });

  test('preserves link text content', () =>
    assert.match(processHtml('<a href="https://example.com">Visit site</a>', { nofollow: true }), />Visit site<\/a>/));

  test('processes multiple links in document', () => {
    const html = '<a href="https://a.com">A</a> <a href="https://b.com">B</a> <a href="https://c.com">C</a>';
    assert.equal((processHtml(html, { nofollow: true }).match(/nofollow/g) || []).length, 3);
  });

  test('only external links modified in mixed document', () => {
    const out = processHtml('<a href="/local">local</a> <a href="https://ext.com">ext</a>', { nofollow: true });
    assert.doesNotMatch(out.split('https://')[0], /nofollow/);
    assert.match(out, /https:\/\/ext\.com/);
  });

  test('returns html unchanged when no options produce changes', () => {
    const input = '<a href="https://example.com">link</a>';
    assert.equal(processHtml(input, {}), input);
    assert.equal(processHtml(input), input);
  });

  test('handles uppercase <A HREF=...> tags', () =>
    assert.match(processHtml('<A HREF="https://example.com">link</A>', { nofollow: true }), /nofollow/));

  test('handles data-* attributes alongside href', () => {
    const out = processHtml('<a href="https://example.com" data-track="nav">link</a>', { nofollow: true });
    assert.match(out, /rel="nofollow"/);
    assert.match(out, /data-track="nav"/);
  });
});

describe('extractExternalLinks', () => {
  test('finds a single external link', () =>
    assert.deepEqual(extractExternalLinks('<a href="https://example.com">link</a>'), ['https://example.com']));

  test('ignores internal links', () =>
    assert.deepEqual(extractExternalLinks('<a href="/page">link</a>'), []));

  test('ignores anchor links', () =>
    assert.deepEqual(extractExternalLinks('<a href="#top">link</a>'), []));

  test('deduplicates repeated URLs', () => {
    const html = '<a href="https://example.com">1</a><a href="https://example.com">2</a>';
    assert.equal(extractExternalLinks(html).length, 1);
  });

  test('returns multiple distinct URLs', () => {
    const links = extractExternalLinks('<a href="https://a.com">1</a><a href="https://b.com">2</a>');
    assert.equal(links.length, 2);
    assert.ok(links.includes('https://a.com'));
    assert.ok(links.includes('https://b.com'));
  });

  test('ignores links with no href', () =>
    assert.deepEqual(extractExternalLinks('<a name="section">anchor</a>'), []));

  test('handles empty string', () =>
    assert.deepEqual(extractExternalLinks(''), []));

  test('handles html with no anchor tags', () =>
    assert.deepEqual(extractExternalLinks('<p>No links here</p>'), []));
});

describe('link checking helpers', () => {
  test('parseStatusList uses fallback when empty', () => {
    assert.deepEqual(
      [...parseStatusList('', DEFAULT_BLOCKED_STATUSES)].sort((a, b) => a - b),
      [...DEFAULT_BLOCKED_STATUSES].sort((a, b) => a - b)
    );
  });

  test('parseStatusList parses comma-separated status codes', () => {
    assert.deepEqual([...parseStatusList('403, 999', DEFAULT_BLOCKED_STATUSES)], [403, 999]);
  });

  test('shouldRetryWithGet retries selected HEAD responses once', () => {
    const statuses = parseStatusList(
      DEFAULT_RETRY_WITH_GET_STATUSES.join(','),
      DEFAULT_RETRY_WITH_GET_STATUSES
    );

    assert.equal(shouldRetryWithGet('HEAD', 403, false, statuses), true);
    assert.equal(shouldRetryWithGet('GET', 403, false, statuses), false);
    assert.equal(shouldRetryWithGet('HEAD', 403, true, statuses), false);
    assert.equal(shouldRetryWithGet('HEAD', 404, false, statuses), false);
  });

  test('shouldTreatAsBlocked distinguishes blocked from broken', () => {
    const statuses = parseStatusList(
      DEFAULT_BLOCKED_STATUSES.join(','),
      DEFAULT_BLOCKED_STATUSES
    );

    assert.equal(shouldTreatAsBlocked(403, statuses), true);
    assert.equal(shouldTreatAsBlocked(429, statuses), true);
    assert.equal(shouldTreatAsBlocked(404, statuses), false);
  });
});

describe('buildChanges', () => {
  test('reports a changed anchor', () => {
    const input   = '<a href="https://example.com">link</a>';
    const output  = processHtml(input, { nofollow: true });
    const changes = buildChanges(input, output);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].before, '<a href="https://example.com">');
    assert.match(changes[0].after, /nofollow/);
  });

  test('reports no changes when identical', () => {
    const html = '<a href="https://example.com">link</a>';
    assert.deepEqual(buildChanges(html, html), []);
  });

  test('reports only the changed links in a mixed document', () => {
    const input   = '<a href="/local">local</a> <a href="https://ext.com">ext</a>';
    const output  = processHtml(input, { nofollow: true });
    const changes = buildChanges(input, output);
    assert.equal(changes.length, 1);
    assert.match(changes[0].after, /nofollow/);
  });

  test('handles empty html', () =>
    assert.deepEqual(buildChanges('', ''), []));
});
