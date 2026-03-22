(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports != null) {
    module.exports = factory();
  } else {
    global.HtmlLinkProcessor = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TRACKING_PARAM_NAMES = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'msclkid', 'twclid', 'mc_eid', 'ref',
  ];
  const TRACKING_PARAMS = new Set(TRACKING_PARAM_NAMES);

  const isExternal = href => /^https?:\/\//i.test(href);

  function stripTracking(href) {
    try {
      const u = new URL(href);
      let removed = false;
      for (const p of TRACKING_PARAMS) {
        if (u.searchParams.has(p)) { u.searchParams.delete(p); removed = true; }
      }
      return removed ? u.toString() : href;
    } catch {
      return href;
    }
  }

  function parseHref(attrs) {
    const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/i);
    if (!m) return null;
    return { full: m[1], value: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] };
  }

  function setAttr(attrs, name, value) {
    const re = new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\S+)`, 'i');
    const token = `${name}="${value}"`;
    return re.test(attrs) ? attrs.replace(re, token) : `${attrs} ${token}`;
  }

  function hasAttr(attrs, name) {
    return new RegExp(`\\b${name}\\s*=`, 'i').test(attrs);
  }

  function mergeRel(attrs, add) {
    if (add.length === 0) return attrs;
    const m = attrs.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    const existing = new Set(
      (m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).split(/\s+/) : []).filter(Boolean)
    );
    for (const r of add) existing.add(r);
    return setAttr(attrs, 'rel', [...existing].join(' '));
  }

  function processHtml(html, opts) {
    const {
      nofollow      = false,
      noopener      = false,
      noreferrer    = false,
      externalOnly  = true,
      targetBlank   = false,
      stripTracking: doStrip = false,
    } = opts || {};

    const wantRels = [
      nofollow   && 'nofollow',
      noopener   && 'noopener',
      noreferrer && 'noreferrer',
    ].filter(Boolean);

    if (wantRels.length === 0 && !targetBlank && !doStrip) return html;

    return html.replace(/<a(\b[^>]*?)>/gi, (match, innerAttrs) => {
      const href = parseHref(innerAttrs);
      if (!href) return match;

      const ext = isExternal(href.value);
      if (externalOnly && !ext) return match;

      let attrs = innerAttrs;

      if (doStrip && ext) {
        const clean = stripTracking(href.value);
        if (clean !== href.value) attrs = attrs.replace(href.full, `"${clean}"`);
      }

      attrs = mergeRel(attrs, wantRels);

      if (targetBlank && ext && !hasAttr(attrs, 'target')) {
        attrs = setAttr(attrs, 'target', '_blank');
      }

      return `<a${attrs}>`;
    });
  }

  function extractExternalLinks(html) {
    const seen = new Set();
    for (const [, attrs] of html.matchAll(/<a\b([^>]*?)>/gi)) {
      const href = parseHref(attrs);
      if (href && isExternal(href.value)) seen.add(href.value);
    }
    return [...seen];
  }

  function buildChanges(inputHtml, outputHtml) {
    const pick = html => [...html.matchAll(/<a\b[^>]*>/gi)].map(m => m[0]);
    const inTags  = pick(inputHtml);
    const outTags = pick(outputHtml);
    const changes = [];
    const len = Math.min(inTags.length, outTags.length);
    for (let i = 0; i < len; i++) {
      if (inTags[i] !== outTags[i]) changes.push({ before: inTags[i], after: outTags[i] });
    }
    return changes;
  }

  return { TRACKING_PARAM_NAMES, isExternal, stripTracking, processHtml, extractExternalLinks, buildChanges };
});
