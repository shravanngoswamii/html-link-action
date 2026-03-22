# HTML Link Processor

A GitHub composite action that post-processes a static HTML site to modify and validate links. Pure Node.js -- no pip installs, no npm dependencies, works on any GitHub-hosted runner.

## Features

| Feature | Input | Default |
|---|---|---|
| Add `rel="nofollow"` | `nofollow: true` | false |
| Add `rel="noopener"` | `noopener: true` | false |
| Add `rel="noreferrer"` | `noreferrer: true` | false |
| External links only | `external-only: true` | **true** |
| Add `target="_blank"` to external links | `external-target-blank: true` | false |
| Strip tracking params (utm_*, fbclid…) | `strip-tracking-params: true` | false |
| Check links for broken URLs | `check-links: true` | false |
| Fail on broken links | `fail-on-broken: true` | false |
| Skip URLs matching patterns | `ignore-patterns: "localhost,staging"` | — |
| Request timeout (ms) | `timeout: 5000` | 5000 |
| Link check concurrency | `concurrency: 20` | 20 |

## Usage

### Add nofollow to all links

```yaml
- uses: shravanngoswamii/html-link-action@v1
  with:
    site-dir: _site
    nofollow: true
```

### Harden external links + strip tracking

```yaml
- uses: shravanngoswamii/html-link-action@v1
  with:
    site-dir: _site
    nofollow: true
    noopener: true
    noreferrer: true
    external-target-blank: true
    strip-tracking-params: true
```

### Check for broken links (warn, don't fail)

```yaml
- uses: shravanngoswamii/html-link-action@v1
  with:
    site-dir: _site
    check-links: true
    ignore-patterns: 'localhost,127\.0\.0\.1'
```

### Check for broken links and fail the build

```yaml
- uses: shravanngoswamii/html-link-action@v1
  with:
    site-dir: _site
    check-links: true
    fail-on-broken: true
    timeout: 10000
    concurrency: 10
```

### Use outputs in a later step

```yaml
- uses: shravanngoswamii/html-link-action@v1
  id: links
  with:
    site-dir: _site
    nofollow: true
    check-links: true

- run: |
    echo "Modified files: ${{ steps.links.outputs.modified-files }}"
    echo "Checked links:  ${{ steps.links.outputs.checked-links }}"
    echo "Broken links:   ${{ steps.links.outputs.broken-links }}"
```

## Inputs

| Input | Description | Default |
|---|---|---|
| `site-dir` | Path to the static site directory | `__site` |
| `nofollow` | Add `rel="nofollow"` | `false` |
| `noopener` | Add `rel="noopener"` | `false` |
| `noreferrer` | Add `rel="noreferrer"` | `false` |
| `external-only` | Scope modifications to external links only | `true` |
| `external-target-blank` | Add `target="_blank"` to external links | `false` |
| `strip-tracking-params` | Remove UTM/fbclid/gclid/etc. params | `false` |
| `check-links` | HTTP HEAD-check all external links (with GET fallback) | `false` |
| `fail-on-broken` | Exit 1 if broken links found | `false` |
| `ignore-patterns` | Comma-separated regex patterns to skip | `''` |
| `timeout` | Per-request timeout in milliseconds | `5000` |
| `concurrency` | Max concurrent link-check requests | `20` |

## Outputs

| Output | Description |
|---|---|
| `modified-files` | Number of HTML files modified |
| `broken-links` | JSON array of `{ url, status }` objects for broken links |
| `checked-links` | Total number of unique external links checked |

## Notes

- **`external-only` is `true` by default** — rel/target changes only apply to `http://` and `https://` links. Set to `false` to also process relative and anchor links.
- **`rel` attributes are merged**, not replaced — if a link already has `rel="noopener"` and you add `nofollow: true`, the result is `rel="noopener nofollow"`.
- **Link checking** sends `HEAD` first; falls back to `GET` if the server returns 405. Retries once on 429 or 5xx. Responses ≥ 400 and network errors are reported as broken.
- **No external dependencies** — pure Node.js stdlib only. Node.js is pre-installed on all standard GitHub-hosted runners.
- **Live playground** — [shravanngoswamii.github.io/html-link-action/playground/](https://shravanngoswamii.github.io/html-link-action/playground/)

## Releasing

Releases are fully automated via `.github/workflows/release.yml`. To cut a release, just include a bump keyword anywhere in your commit message when pushing (or merging a PR) to `main`:

| Keyword in commit message | What happens |
|---|---|
| `[patch]` | `v1.2.3` → `v1.2.4` |
| `[minor]` | `v1.2.3` → `v1.3.0` |
| `[major]` | `v1.2.3` → `v2.0.0` |

The workflow will automatically:
1. Compute the next semver tag from the latest existing tag
2. Push the new tag (e.g. `v1.2.4`)
3. Create a GitHub Release with auto-generated notes
4. Fast-forward the floating major branch (e.g. `v1`) so `@v1` users get the update

Commits without any keyword are ignored — nothing is tagged or released.

**Examples:**
```
git commit -m "fix: handle self-closing anchor tags [patch]"
git commit -m "feat: add support for data-href attributes [minor]"
git commit -m "refactor: drop Node 18 support [major]"
```

**First release:** If no tags exist yet, the first `[patch]` produces `v0.0.1`, `[minor]` produces `v0.1.0`, and `[major]` produces `v1.0.0`.

### Versioning strategy

| Ref | Meaning |
|---|---|
| `@v1` | Latest v1.x — recommended for most users |
| `@v1.2.3` | Exact version — use for reproducibility |
| `@main` | Development tip — unstable |
