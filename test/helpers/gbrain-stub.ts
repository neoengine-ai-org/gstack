/**
 * Offline `gbrain` stub for hermetic test isolation.
 *
 * Several gstack binaries spawn `gbrain` by bare name — the cache refresh path
 * (`bin/gstack-brain-cache` → `lib/gbrain-exec.ts`) and the sync uninstall path
 * (`bin/gstack-brain-uninstall` → `bin/gstack-gbrain-source-wireup`). When a
 * real, configured gbrain is on PATH (any machine that ran /setup-gbrain), those
 * spawns connect to the LIVE brain database. In a unit test that is two distinct
 * failures:
 *
 *   1. Latency. A live DB connect is slow enough to blow bun's per-test timeout
 *      — `gbrain get` is bounded at 10s per call and the cache fans it out across
 *      ~7 entities on a schema/endpoint rebuild, and `gbrain sources remove`
 *      blocks the 30s brain-sync tests.
 *   2. Isolation. `gbrain sources remove` MUTATES real brain state, and the
 *      uninstall path can even `rm -rf ~/.gstack-brain-worktree` on the real home.
 *
 * CI has no gbrain, so those spawns fail fast (ENOENT) and the tests pass — which
 * is exactly why the coupling stayed invisible until a dev machine ran the suite.
 *
 * `createGbrainStub()` writes a deterministic `gbrain` shim into a temp bin dir
 * and hands back a PATH string that lists the shim FIRST, shadowing any real
 * gbrain. The shim never opens a database:
 *
 *   - `--version`          → prints a valid, above-floor version (`gbrain 0.41.0`)
 *   - `sources list ...`   → prints an empty source set (`{"sources":[]}`)
 *   - `get ...`            → exits 1 (brain unreachable → callers fall back)
 *   - anything else        → exits 0 (no-op; e.g. `sources remove` on uninstall)
 *
 * Every invocation is appended to `<dir>/calls.log`, so a test can assert the
 * real brain was never driven.
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';

/** Version the stub reports. Above the 0.20.0 MIN_GBRAIN_VERSION floor (#1744). */
export const STUB_GBRAIN_VERSION = '0.41.0';

export interface GbrainStub {
  /** The temp bin dir holding the `gbrain` shim. */
  dir: string;
  /** Absolute path to the calls log the shim appends to. */
  callsFile: string;
  /**
   * A PATH value with the stub dir prepended. Pass the base PATH you want to
   * keep (defaults to the current `process.env.PATH`) so real tools stay
   * resolvable while `gbrain` resolves to the shim.
   */
  path(base?: string): string;
  /** Parsed lines the shim recorded, one argv-string per invocation. */
  calls(): string[];
  /** Remove the temp bin dir. */
  cleanup(): void;
}

/**
 * Create a temp bin dir containing a deterministic offline `gbrain` shim.
 * The caller is responsible for calling `cleanup()` (typically in `afterEach`).
 */
export function createGbrainStub(): GbrainStub {
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-stub-'));
  const callsFile = join(dir, 'calls.log');
  const shim = join(dir, 'gbrain');

  // POSIX shell shim. Kept intentionally tiny and DB-free. The `calls.log`
  // append lets tests prove the real brain was never contacted.
  const script = `#!/bin/bash
# Deterministic offline gbrain stub (test/helpers/gbrain-stub.ts). Never opens a DB.
printf '%s\\n' "$*" >> ${JSON.stringify(callsFile)}
case "$1" in
  --version) echo "gbrain ${STUB_GBRAIN_VERSION}"; exit 0 ;;
esac
if [ "$1" = "sources" ] && [ "$2" = "list" ]; then
  echo '{"sources":[]}'
  exit 0
fi
if [ "$1" = "get" ]; then
  # Brain unreachable — callers (brain-cache) must fall back, not hang.
  exit 1
fi
# No-op for every other subcommand (e.g. \`sources remove\` during uninstall).
exit 0
`;
  writeFileSync(shim, script, { mode: 0o755 });

  return {
    dir,
    callsFile,
    path(base = process.env.PATH || '') {
      return base ? `${dir}${delimiter}${base}` : dir;
    },
    calls() {
      if (!existsSync(callsFile)) return [];
      return readFileSync(callsFile, 'utf-8').split('\n').filter(Boolean);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
