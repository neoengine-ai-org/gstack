/**
 * Drift guards for the committed diagram-render bundle (eng-review D2).
 *
 * Tier 1 (always, free, <50ms): dist/diagram-render.html must hash to exactly
 * what dist/BUILD_INFO.json records, and the BUILD_INFO dependency pins must
 * match package.json. Catches hand-edited dist files and "bumped the pin,
 * forgot to rebuild" commits.
 *
 * Tier 2 (deep, CI / post-install only): rebuild from source and compare
 * hashes. Skipped when lib/diagram-render/node_modules is absent (fresh
 * clone without `bun install` in that dir) or when the local bun version
 * differs from the one recorded at build time (minifier output is only
 * guaranteed deterministic within a bun version).
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..", "lib", "diagram-render");
const DIST_HTML = path.join(ROOT, "dist", "diagram-render.html");
const BUILD_INFO = path.join(ROOT, "dist", "BUILD_INFO.json");

describe("diagram-render bundle drift", () => {
  test("dist hash matches BUILD_INFO (tamper check)", async () => {
    const html = await Bun.file(DIST_HTML).text();
    const info = await Bun.file(BUILD_INFO).json();
    const sha = createHash("sha256").update(html).digest("hex");
    expect(sha).toBe(info.sha256);
    expect(Buffer.byteLength(html)).toBe(info.bytes);
  });

  test("BUILD_INFO dependency pins match package.json", async () => {
    const info = await Bun.file(BUILD_INFO).json();
    const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
    expect(info.deps).toEqual(pkg.dependencies);
  });

  test("page invariants: module script, base href, escaped terminators, error trap", async () => {
    const html = await Bun.file(DIST_HTML).text();
    expect(html).toContain('<script type="module">');
    expect(html).toContain('<base href="https://gstack-render.localhost/">');
    expect(html).toContain("window.__errors = []");
    // The inline module must contain no live </script> other than the page's
    // own closers: head error-trap closer + module closer.
    const closers = html.match(/<\/script>/g) ?? [];
    expect(closers.length).toBe(2);
  });

  const nodeModules = path.join(ROOT, "node_modules");
  let builtWithSameBun = false;
  try {
    const info = require(BUILD_INFO);
    builtWithSameBun = info.bunVersion === Bun.version;
  } catch {}
  const canDeepCheck = existsSync(nodeModules) && builtWithSameBun;

  test.skipIf(!canDeepCheck)(
    "deep: fresh build reproduces committed dist",
    async () => {
      const before = await Bun.file(BUILD_INFO).json();
      const proc = Bun.spawnSync(["bun", "run", "scripts/build.ts"], { cwd: ROOT });
      expect(proc.exitCode).toBe(0);
      const after = await Bun.file(BUILD_INFO).json();
      expect(after.sha256).toBe(before.sha256);
    },
    60000,
  );
});
