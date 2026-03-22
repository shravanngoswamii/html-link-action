'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');
const { processHtml, extractExternalLinks } = require('./lib.js');

const SITE_DIR       = process.env.SITE_DIR       || '__site';
const NOFOLLOW       = process.env.OPT_NOFOLLOW       === 'true';
const NOOPENER       = process.env.OPT_NOOPENER       === 'true';
const NOREFERRER     = process.env.OPT_NOREFERRER     === 'true';
const EXTERNAL_ONLY  = process.env.OPT_EXTERNAL_ONLY  !== 'false';
const TARGET_BLANK   = process.env.OPT_TARGET_BLANK   === 'true';
const STRIP_TRACKING = process.env.OPT_STRIP_TRACKING === 'true';
const CHECK_LINKS    = process.env.OPT_CHECK_LINKS    === 'true';
const FAIL_ON_BROKEN = process.env.OPT_FAIL_ON_BROKEN === 'true';
const TIMEOUT        = parseInt(process.env.OPT_TIMEOUT     || '5000', 10);
const CONCURRENCY    = parseInt(process.env.OPT_CONCURRENCY || '20',   10);

const IGNORE_PATTERNS = (process.env.OPT_IGNORE_PATTERNS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(p => new RegExp(p));

function walkHtml(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

function checkUrl(url) {
  return new Promise(resolve => {
    if (IGNORE_PATTERNS.some(p => p.test(url))) return resolve({ url, status: 'ignored' });

    let u;
    try { u = new URL(url); } catch { return resolve({ url, status: 'invalid' }); }

    const lib = u.protocol === 'https:' ? https : http;

    function request(method, retrying) {
      const req = lib.request(
        { hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
          method, timeout: TIMEOUT, headers: { 'User-Agent': 'html-link-action/1' } },
        res => {
          res.resume();
          if (method === 'HEAD' && res.statusCode === 405) return request('GET', false);
          if (!retrying && (res.statusCode === 429 || res.statusCode >= 500)) {
            return setTimeout(() => request(method, true), 2000);
          }
          const loc = res.headers.location;
          resolve({ url, status: res.statusCode, ...(loc ? { redirect: loc } : {}) });
        }
      );
      req.on('timeout', () => { req.destroy(); resolve({ url, status: 'timeout' }); });
      req.on('error',   ()  => resolve({ url, status: 'error' }));
      req.end();
    }

    request('HEAD', false);
  });
}

async function pooled(items, fn, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

const notice  = msg => console.log(`::notice::${msg}`);
const warning = msg => console.log(`::warning::${msg}`);
const error   = msg => console.log(`::error::${msg}`);

async function main() {
  if (!fs.existsSync(SITE_DIR)) { error(`Site directory not found: ${SITE_DIR}`); process.exit(1); }

  const opts = {
    nofollow: NOFOLLOW, noopener: NOOPENER, noreferrer: NOREFERRER,
    externalOnly: EXTERNAL_ONLY, targetBlank: TARGET_BLANK, stripTracking: STRIP_TRACKING,
  };
  const MODIFY = NOFOLLOW || NOOPENER || NOREFERRER || TARGET_BLANK || STRIP_TRACKING;
  const files  = walkHtml(SITE_DIR);

  if (files.length === 0) {
    warning(`No HTML files found in ${SITE_DIR}`);
    setOutput('modified-files', '0'); setOutput('broken-links', '[]'); setOutput('checked-links', '0');
    return;
  }

  let modifiedCount = 0;
  const externalUrls = new Set();

  for (const file of files) {
    if (MODIFY) {
      const original = fs.readFileSync(file, 'utf8');
      const modified = processHtml(original, opts);
      if (modified !== original) { fs.writeFileSync(file, modified); modifiedCount++; }
    }
    if (CHECK_LINKS) {
      for (const url of extractExternalLinks(fs.readFileSync(file, 'utf8'))) externalUrls.add(url);
    }
  }

  if (MODIFY) notice(`Modified ${modifiedCount} of ${files.length} HTML files`);
  setOutput('modified-files', String(modifiedCount));

  if (!CHECK_LINKS || externalUrls.size === 0) {
    if (CHECK_LINKS) notice('No external links found to check');
    setOutput('broken-links', '[]'); setOutput('checked-links', '0');
    return;
  }

  console.log(`\nChecking ${externalUrls.size} external link(s) (concurrency: ${CONCURRENCY}, timeout: ${TIMEOUT}ms)…\n`);

  const results = await pooled([...externalUrls], checkUrl, CONCURRENCY);
  const broken  = [];

  for (const r of results) {
    const ok = typeof r.status === 'number' && r.status < 400;
    if      (r.status === 'ignored') console.log(`  · [ignored]  ${r.url}`);
    else if (ok)                     console.log(`  ✓ [${r.status}]  ${r.url}${r.redirect ? ` → ${r.redirect}` : ''}`);
    else { broken.push(r);           console.log(`  ✗ [${r.status}]  ${r.url}`); }
  }

  console.log(`\nResults: ${externalUrls.size - broken.length} OK, ${broken.length} broken`);
  setOutput('broken-links',  JSON.stringify(broken.map(r => ({ url: r.url, status: r.status }))));
  setOutput('checked-links', String(externalUrls.size));

  if (broken.length > 0) {
    for (const r of broken) warning(`Broken link [${r.status}]: ${r.url}`);
    if (FAIL_ON_BROKEN) { error(`${broken.length} broken link(s) found`); process.exit(1); }
  } else {
    notice('All external links are reachable');
  }
}

main().catch(err => { error(err.message); process.exit(1); });
