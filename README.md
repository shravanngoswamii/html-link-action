# HTML Link Processor

A GitHub Action that post-processes a static HTML site — add `rel` attributes, open external links in a new tab, strip tracking parameters, and check for broken links. Pure Node.js, no dependencies.

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
| `check-links` | HTTP-check all external links for broken URLs | `false` |
| `fail-on-broken` | Exit with error if broken links are found | `false` |
| `ignore-patterns` | Comma-separated regex patterns to skip during link check | `''` |
| `timeout` | Per-request timeout in milliseconds | `5000` |
| `concurrency` | Max concurrent link-check requests | `20` |

### Outputs

| Output | Description |
|---|---|
| `modified-files` | Number of HTML files modified |
| `broken-links` | JSON array of `{ url, status }` for broken links |
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
```

## Releasing

Include a bump keyword in any commit message pushed to `main`:

| Keyword | Example result |
|---|---|
| `[patch]` | `v1.0.0` → `v1.0.1` |
| `[minor]` | `v1.0.0` → `v1.1.0` |
| `[major]` | `v1.0.0` → `v2.0.0` |

The workflow tags the commit, creates a GitHub Release with auto-generated notes, and advances the floating `v1` branch. Commits without a keyword are ignored.

## Contributing

Bug reports and pull requests are welcome. Please keep changes focused and add a test in `test/test.js` for any logic changes to `lib.js`.

## License

[MIT](LICENSE)
