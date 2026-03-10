---
name: release
description: Cut a new bingbong release. Bumps version in all 3 files, commits, tags, pushes, and creates a GitHub release with changelog notes from merged PRs. Use when asked to "cut a release", "bump version", "release", or "new version".
---

# Release

Cut a new bingbong release with changelog and GitHub release.

## Version files

All three must stay in sync:

- `package.json` — `"version": "x.y.z"`
- `src/server.ts` — `const VERSION = "x.y.z";`
- `bin/cli.ts` — `const VERSION = "x.y.z";`

## Steps

1. **Determine current version** from `package.json`.
2. **Determine bump type** from user input. Default to patch. Support `patch`, `minor`, `major`.
3. **Gather changes** since the last tag:
   ```bash
   git log v<current>..main --oneline
   ```
4. **Get PR details** for each merged PR in the range:
   ```bash
   gh pr view <number> --json title,body --jq '{title, body}'
   ```
5. **Draft release notes** in this exact style (lowercase, no emoji):
   ```
   ### what's new

   - **short bold title** — description of the change (#PR)
   - **another title** — another description (#PR)
   ```
   Omit trivial changes (readme typos, version bumps, lock file updates).
   Present the draft to the user for approval before proceeding.
6. **Update version** in all 3 files.
7. **Commit, tag, push:**
   ```bash
   git add package.json src/server.ts bin/cli.ts
   git commit -m "<new version>"
   git tag v<new version>
   git push origin main --tags
   ```
8. **Create GitHub release:**
   ```bash
   gh release create v<new version> --title "v<new version>" --notes "<release notes>"
   ```
9. **Report** the release URL to the user.

## Commit style

The version bump commit message is just the version number, e.g. `0.1.5`. No prefix, no attribution.
