import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const CONFIG = path.join(ROOT, 'bin', 'gstack-config');

let stateDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-managed-'));
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function run(args: string[], managed = true) {
  return spawnSync(CONFIG, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GSTACK_HOME: stateDir,
      GSTACK_STATE_DIR: stateDir,
      GSTACK_MANAGED: managed ? '1' : '0',
    },
  });
}

describe('NeoEngine managed distribution policy', () => {
  test('forces both update reads off', () => {
    expect(run(['get', 'auto_upgrade']).stdout.trim()).toBe('false');
    expect(run(['get', 'update_check']).stdout.trim()).toBe('false');
  });

  test('rejects writes to both managed update keys', () => {
    for (const key of ['auto_upgrade', 'update_check']) {
      const result = run(['set', key, 'true']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('locked by the NeoEngine managed release');
    }
  });

  test('list masks stale preferences without rewriting the config file', () => {
    fs.writeFileSync(
      path.join(stateDir, 'config.yaml'),
      'auto_upgrade: true\nupdate_check: true\n',
    );

    const result = run(['list']);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('auto_upgrade: true');
    expect(result.stdout).not.toContain('update_check: true');
    expect(result.stdout).toContain('auto_upgrade: false # managed release policy');
    expect(result.stdout).toContain('update_check: false # managed release policy');
    expect(result.stdout).toMatch(/auto_upgrade:\s+false \(managed\)/);
    expect(result.stdout).toMatch(/update_check:\s+false \(managed\)/);
    expect(fs.readFileSync(path.join(stateDir, 'config.yaml'), 'utf-8')).toContain(
      'auto_upgrade: true',
    );
  });

  test('unmanaged distributions retain the upstream behavior', () => {
    expect(run(['set', 'update_check', 'true'], false).status).toBe(0);
    expect(run(['get', 'update_check'], false).stdout.trim()).toBe('true');
  });
});
