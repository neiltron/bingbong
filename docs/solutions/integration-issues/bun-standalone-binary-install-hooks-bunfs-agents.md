---
title: "Standalone Bun Binary Broke `install-hooks` with `/$bunfs/agents`"
category: integration-issues
problem_type: integration_issue
component: tooling
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - bun
  - standalone-binary
  - install-hooks
  - curl-installer
  - claude-code
  - bunfs
  - release
  - hooks
module: distribution
symptoms:
  - "`bingbong install-hooks --dry-run claude` failed in compiled binaries with `Error: Could not find agents directory at /$bunfs/agents`"
  - "Fresh-machine installs via the curl installer could not complete hook setup"
  - "The failure happened before the Claude and Cursor installers ran"
  - "Standalone binaries could not load OpenCode or Pi assets from a repo-local `agents/` directory"
date: 2026-03-27
---

# Standalone Bun Binary Broke `install-hooks` with `/$bunfs/agents`

## Problem
After installing the standalone Bingbong binary via the curl installer on a fresh machine, `bingbong install-hooks claude` failed immediately with:

```text
Error: Could not find agents directory at /$bunfs/agents
This can happen with bundled builds. Install from source checkout or binary release package.
```

That message was misleading for the actual distribution model. The standalone release binary was supposed to support `bingbong install-hooks <agent>` directly, but `install-hooks` still assumed it was running from a source checkout with a real `agents/` directory on disk.

## Investigation

1. **Reproduced the failure with a compiled binary**

```bash
bun build ./bin/cli.ts --compile --outfile /tmp/bingbong-build/bingbong
HOME=/tmp/bingbong-home PATH=/tmp/bingbong-build:$PATH \
  /tmp/bingbong-build/bingbong install-hooks --dry-run claude
```

2. **Traced the failure to early runtime path resolution**
   `src/install-hooks.ts` derived `ROOT_DIR` from `import.meta.dir`, then built `AGENTS_DIR`, then blocked all installers on `existsSync(AGENTS_DIR)`.

3. **Confirmed the check was stale for Claude and Cursor**
   `installClaude()` and `installCursor()` no longer read files from `agents/`. They only write `bingbong emit <Event>` commands into agent config.

4. **Checked release/install packaging**
   The curl installer ships only the compiled binary. Existing release smoke tests validated binary install and embedded UI assets, but did not exercise `install-hooks`.

5. **Rejected a packaging-only fix**
   A Bun/package config change to try to ship `agents/` would not solve the stale Claude/Cursor preflight check, and it would still leave OpenCode/Pi dependent on runtime filesystem layout.

## Root Cause
`install-hooks` used the wrong runtime boundary for a compiled Bun executable. In source runs, `import.meta.dir` points at the real repo and `agents/` exists beside the code. In `bun build --compile` output, `import.meta.dir` resolves under Bun's virtual filesystem (`/$bunfs/...`), so `AGENTS_DIR` became `/$bunfs/agents`.

That caused two separate problems:

- Claude and Cursor were blocked by a global filesystem check they no longer needed.
- OpenCode and Pi still read plugin/extension payloads from runtime disk paths instead of from the bundle.

## Working Solution

### 1) Remove the global runtime `agents/` preflight
`src/install-hooks.ts`

```ts
const INSTALLERS: Record<string, (dryRun: boolean) => Promise<string>> = {
  claude: installClaude,
  cursor: installCursor,
  opencode: installOpencode,
  pi: installPi,
};

const configPath = await installer(dryRun);
```

This stops `install-hooks` from failing before it reaches the actual agent-specific installer.

### 2) Embed OpenCode and Pi assets at build time
`src/install-hooks.ts`

```ts
import opencodePluginSource from "../agents/opencode/plugins/bingbong.js" with { type: "text" };
import piExtensionSource from "../agents/pi/extensions/bingbong.ts" with { type: "text" };
```

`installOpencode()` now writes `opencodePluginSource` directly, and `installPi()` transforms `piExtensionSource` in memory before writing it out. That makes both installers safe in standalone binaries.

### 3) Add release-path regression coverage
`scripts/test-local-release.sh`

- Install the prebuilt binary through the local release harness
- Run `install-hooks --dry-run` for `claude`, `cursor`, `opencode`, and `pi`
- Keep the existing UI asset smoke checks

## Why This Works
The root problem was not missing files in the repo. It was assuming a compiled Bun binary could still discover install-time assets through `import.meta.dir` like a source checkout.

By importing the OpenCode and Pi assets as raw text, the binary carries the payloads it needs. By removing the unconditional `agents/` directory check, Claude and Cursor no longer fail on a filesystem path they do not use. The result is that all four `install-hooks` flows work from the shipped standalone binary instead of only from a source checkout.

## Verification That Fixed It

- Reproduced the original `/$bunfs/agents` failure with a compiled standalone binary before the patch.
- Rebuilt the binary and confirmed `install-hooks --dry-run` succeeds for `claude`, `cursor`, `opencode`, and `pi`.
- Ran `scripts/test-local-release.sh` end to end and confirmed:
  - prebuilt installer path was used
  - checksum verification ran
  - `install-hooks` worked from the standalone binary
  - embedded UI assets still served correctly

## Prevention Checklist

- Treat `bun build --compile` as a different runtime, not just a packaging step.
- Do not gate one installer on filesystem assets needed only by other installers.
- For assets that must ship with the standalone binary, embed them at build time or install them explicitly alongside the binary.
- Do not use `import.meta.dir` as a proxy for an installed resource directory in Bun standalone builds.
- Require `scripts/test-local-release.sh` for release/distribution changes.
- Treat any `/$bunfs` path leakage in user-facing errors as release-blocking.

## Related References

- PR: #30
- Commit: `5dac071` — fix `install-hooks` in bundled binaries
- Related docs:
  - `docs/solutions/integration-issues/portable-hook-configs-emit-subcommand.md`
  - `docs/solutions/integration-issues/bun-standalone-binary-js-chunk-404-base-href.md`
- Release context:
  - `docs/guides/releasing-binaries.md`
  - `docs/brainstorms/2026-02-24-binary-installer-without-npm-brainstorm.md`
  - `docs/plans/2026-02-24-feat-binary-release-installer-without-npm-plan.md`
