# HTML Link Processor

A GitHub Action that post-processes a static HTML site, adds safer link attributes, strips tracking parameters, and checks external links. Pure Node.js, no dependencies.

## Usage

```yaml
- uses: shravanngoswamii/html-link-action@v1
  with:
    site-dir: _site
    nofollow: true
    noopener: true
    noreferrer: true
    external-target-blank: true
    strip-tracking-params: true
    check-links: true
    fail-on-broken: true
    fail-on-blocked: false
```

### Inputs

| Input | Description | Default |
|---|---|---|
| `site-dir` | Path to the static site directory | `__site` |
| `nofollow` | Add `rel="nofollow"` to external links | `false` |
| `noopener` | Add `rel="noopener"` to external links | `false` |
| `noreferrer` | Add `rel="noreferrer"` to external links | `false` |
| `external-only` | Scope changes to external links only | `true` |
| `external-target-blank` | Add `target="_blank"` to external links | `false` |
| `strip-tracking-params` | Strip UTM / fbclid / gclid / etc. params | `false` |
| `check-links` | Check external links with browser-like HTTP requests | `false` |
| `fail-on-broken` | Exit with error if broken links are found | `false` |
| `fail-on-blocked` | Exit with error if bot or auth blocking is detected | `false` |
| `ignore-patterns` | Comma-separated regex patterns to skip during link check | `''` |
| `timeout` | Per-request timeout in milliseconds | `5000` |
| `concurrency` | Max concurrent link-check requests | `20` |
| `user-agent` | User-Agent header used for link-check requests | browser-like default |
| `accept-language` | Accept-Language header used for link-check requests | `en-US,en;q=0.9` |
| `retry-with-get-statuses` | Status codes that retry with GET after HEAD | `401,403,405,406,999` |
| `blocked-statuses` | Status codes reported as blocked instead of broken | `401,403,429,999` |
| `max-redirects` | Maximum redirects followed per URL | `5` |

### Outputs

| Output | Description |
|---|---|
| `modified-files` | Number of HTML files modified |
| `broken-links` | JSON array of `{ url, status }` for broken links |
| `blocked-links` | JSON array of `{ url, status }` for blocked links |
| `checked-links` | Total number of unique external links checked |

### Use outputs in a later step

```yaml
- uses: shravanngoswamii/html-link-action@v1
  id: links
  with:
    site-dir: _site
    check-links: true

- run: |
    echo "Modified: ${{ steps.links.outputs.modified-files }}"
    echo "Broken:   ${{ steps.links.outputs.broken-links }}"
    echo "Blocked:  ${{ steps.links.outputs.blocked-links }}"
```

## Bot-blocked sites

No HTTP-only link checker can guarantee zero bot rejection from sites like LinkedIn or X. This action reduces false positives by:

- sending browser-like headers
- retrying selected `HEAD` responses with `GET`
- following redirects
- reporting `401`, `403`, `429`, and `999` as `blocked` by default instead of `broken`

For most CI workflows, keep `fail-on-broken: true` and `fail-on-blocked: false`. If you want stricter enforcement, set `fail-on-blocked: true` or add `ignore-patterns` for domains you never want checked.

## Releasing

Include a bump keyword in any commit message pushed to `main`:

| Keyword | Example result |
|---|---|
| `[patch]` | `v1.0.0` -> `v1.0.1` |
| `[minor]` | `v1.0.0` -> `v1.1.0` |
| `[major]` | `v1.0.0` -> `v2.0.0` |

The workflow tags the commit, creates a GitHub Release with auto-generated notes, and advances the floating `v1` branch. Commits without a keyword are ignored.

## Contributing

Bug reports and pull requests are welcome. Please keep changes focused and add a test in `test/test.js` for any logic changes to `lib.js` or `index.js`.

## License

[MIT](LICENSE)
