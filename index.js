'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { processHtml, extractExternalLinks } = require('./lib.js');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const DEFAULT_RETRY_WITH_GET_STATUSES = [401, 403, 405, 406, 999];
const DEFAULT_BLOCKED_STATUSES = [401, 403, 429, 999];

function parseStatusList(rawValue, fallback) {
  const source = String(rawValue || '').trim();
  if (!source) return new Set(fallback);

  const values = source
    .split(',')
    .map(part => parseInt(part.trim(), 10))
    .filter(Number.isFinite);

  return new Set(values.length > 0 ? values : fallback);
}

function shouldRetryWithGet(method, status, didRetryWithGet, retryStatuses) {
  return method === 'HEAD' && !didRetryWithGet && retryStatuses.has(status);
}

function shouldTreatAsBlocked(status, blockedStatuses) {
  return typeof status === 'number' && blockedStatuses.has(status);
}

const SITE_DIR = process.env.SITE_DIR || '__site';
const NOFOLLOW = process.env.OPT_NOFOLLOW === 'true';
const NOOPENER = process.env.OPT_NOOPENER === 'true';
const NOREFERRER = process.env.OPT_NOREFERRER === 'true';
const EXTERNAL_ONLY = process.env.OPT_EXTERNAL_ONLY !== 'false';
const TARGET_BLANK = process.env.OPT_TARGET_BLANK === 'true';
const STRIP_TRACKING = process.env.OPT_STRIP_TRACKING === 'true';
const CHECK_LINKS = process.env.OPT_CHECK_LINKS === 'true';
const FAIL_ON_BROKEN = process.env.OPT_FAIL_ON_BROKEN === 'true';
const FAIL_ON_BLOCKED = process.env.OPT_FAIL_ON_BLOCKED === 'true';
const TIMEOUT = parseInt(process.env.OPT_TIMEOUT || '5000', 10);
const CONCURRENCY = parseInt(process.env.OPT_CONCURRENCY || '20', 10);
const USER_AGENT = (process.env.OPT_USER_AGENT || DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
const ACCEPT_LANGUAGE = (process.env.OPT_ACCEPT_LANGUAGE || DEFAULT_ACCEPT_LANGUAGE).trim() || DEFAULT_ACCEPT_LANGUAGE;
const MAX_REDIRECTS = parseInt(process.env.OPT_MAX_REDIRECTS || '5', 10);

const IGNORE_PATTERNS = (process.env.OPT_IGNORE_PATTERNS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map(pattern => new RegExp(pattern));
const RETRY_WITH_GET_STATUSES = parseStatusList(
  process.env.OPT_RETRY_WITH_GET_STATUSES,
  DEFAULT_RETRY_WITH_GET_STATUSES
);
const BLOCKED_STATUSES = parseStatusList(
  process.env.OPT_BLOCKED_STATUSES,
  DEFAULT_BLOCKED_STATUSES
);

function walkHtml(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

function buildRequestHeaders() {
  return {
    'User-Agent': USER_AGENT,
    'Accept': DEFAULT_ACCEPT,
    'Accept-Language': ACCEPT_LANGUAGE,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

function checkUrl(url) {
  return new Promise(resolve => {
    if (IGNORE_PATTERNS.some(pattern => pattern.test(url))) {
      return resolve({ url, status: 'ignored' });
    }

    function request(currentUrl, method, retrying, redirectsRemaining, didRetryWithGet) {
      let parsedUrl;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        return resolve({ url, status: 'invalid' });
      }

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || undefined,
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          timeout: TIMEOUT,
          headers: buildRequestHeaders(),
        },
        res => {
          res.resume();

          const status = Number(res.statusCode || 0);
          const location = res.headers.location;

          if (location && status >= 300 && status < 400) {
            let redirectedUrl;
            try {
              redirectedUrl = new URL(location, parsedUrl).toString();
            } catch {
              return resolve({ url, status, finalUrl: currentUrl, redirect: location });
            }

            if (redirectsRemaining <= 0) {
              return resolve({ url, status: 'redirect-limit', finalUrl: currentUrl, redirect: redirectedUrl });
            }

            return request(redirectedUrl, method, false, redirectsRemaining - 1, didRetryWithGet);
          }

          if (shouldRetryWithGet(method, status, didRetryWithGet, RETRY_WITH_GET_STATUSES)) {
            return request(currentUrl, 'GET', false, redirectsRemaining, true);
          }

          if (!retrying && (status === 429 || status >= 500)) {
            return setTimeout(
              () => request(currentUrl, method, true, redirectsRemaining, didRetryWithGet),
              2000
            );
          }

          resolve({
            url,
            status,
            ...(currentUrl !== url ? { finalUrl: currentUrl } : {}),
            ...(shouldTreatAsBlocked(status, BLOCKED_STATUSES) ? { blocked: true } : {}),
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ url, status: 'timeout' });
      });
      req.on('error', () => resolve({ url, status: 'error' }));
      req.end();
    }

    request(url, 'HEAD', false, MAX_REDIRECTS, false);
  });
}

async function pooled(items, fn, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    fs.appendFileSync(file, `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  }
}

const notice = message => console.log(`::notice::${message}`);
const warning = message => console.log(`::warning::${message}`);
const error = message => console.log(`::error::${message}`);

async function main() {
  if (!fs.existsSync(SITE_DIR)) {
    error(`Site directory not found: ${SITE_DIR}`);
    process.exit(1);
  }

  const opts = {
    nofollow: NOFOLLOW,
    noopener: NOOPENER,
    noreferrer: NOREFERRER,
    externalOnly: EXTERNAL_ONLY,
    targetBlank: TARGET_BLANK,
    stripTracking: STRIP_TRACKING,
  };
  const shouldModify = NOFOLLOW || NOOPENER || NOREFERRER || TARGET_BLANK || STRIP_TRACKING;
  const files = walkHtml(SITE_DIR);

  if (files.length === 0) {
    warning(`No HTML files found in ${SITE_DIR}`);
    setOutput('modified-files', '0');
    setOutput('broken-links', '[]');
    setOutput('blocked-links', '[]');
    setOutput('checked-links', '0');
    return;
  }

  let modifiedCount = 0;
  const externalUrls = new Set();

  for (const file of files) {
    if (shouldModify) {
      const original = fs.readFileSync(file, 'utf8');
      const modified = processHtml(original, opts);
      if (modified !== original) {
        fs.writeFileSync(file, modified);
        modifiedCount++;
      }
    }

    if (CHECK_LINKS) {
      for (const externalUrl of extractExternalLinks(fs.readFileSync(file, 'utf8'))) {
        externalUrls.add(externalUrl);
      }
    }
  }

  if (shouldModify) notice(`Modified ${modifiedCount} of ${files.length} HTML files`);
  setOutput('modified-files', String(modifiedCount));

  if (!CHECK_LINKS || externalUrls.size === 0) {
    if (CHECK_LINKS) notice('No external links found to check');
    setOutput('broken-links', '[]');
    setOutput('blocked-links', '[]');
    setOutput('checked-links', '0');
    return;
  }

  console.log(`\nChecking ${externalUrls.size} external link(s) (concurrency: ${CONCURRENCY}, timeout: ${TIMEOUT}ms)...\n`);

  const results = await pooled([...externalUrls], checkUrl, CONCURRENCY);
  const broken = [];
  const blocked = [];
  let checkedCount = 0;
  let okCount = 0;

  for (const result of results) {
    const ok = typeof result.status === 'number' && result.status < 400;
    const suffix = result.finalUrl ? ` -> ${result.finalUrl}` : '';

    if (result.status === 'ignored') {
      console.log(`  - [ignored] ${result.url}`);
      continue;
    }

    checkedCount++;

    if (result.blocked) {
      blocked.push(result);
      console.log(`  ~ [blocked:${result.status}] ${result.url}${suffix}`);
      continue;
    }

    if (ok) {
      okCount++;
      console.log(`  OK [${result.status}] ${result.url}${suffix}`);
      continue;
    }

    broken.push(result);
    console.log(`  X [${result.status}] ${result.url}${suffix}`);
  }

  console.log(`\nResults: ${okCount} OK, ${blocked.length} blocked, ${broken.length} broken`);
  setOutput('broken-links', JSON.stringify(broken.map(result => ({ url: result.url, status: result.status }))));
  setOutput('blocked-links', JSON.stringify(blocked.map(result => ({ url: result.url, status: result.status }))));
  setOutput('checked-links', String(checkedCount));

  for (const result of blocked) {
    warning(`Blocked link [${result.status}]: ${result.url}`);
  }

  if (broken.length > 0) {
    for (const result of broken) {
      warning(`Broken link [${result.status}]: ${result.url}`);
    }
    if (FAIL_ON_BROKEN) {
      error(`${broken.length} broken link(s) found`);
      process.exit(1);
    }
  }

  if (blocked.length > 0 && FAIL_ON_BLOCKED) {
    error(`${blocked.length} blocked link(s) found`);
    process.exit(1);
  }

  if (broken.length === 0 && blocked.length === 0) {
    notice('All external links are reachable');
  }
}

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
} else {
  module.exports = {
    DEFAULT_BLOCKED_STATUSES,
    DEFAULT_RETRY_WITH_GET_STATUSES,
    parseStatusList,
    shouldRetryWithGet,
    shouldTreatAsBlocked,
  };
}
