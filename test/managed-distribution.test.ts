import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const CONFIG = path.join(ROOT, 'bin', 'gstack-config');
const UPDATE_CHECK = path.join(ROOT, 'bin', 'gstack-update-check');
const SESSION_UPDATE = path.join(ROOT, 'bin', 'gstack-session-update');

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

function runManagedScript(script: string) {
  return spawnSync(script, [], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GSTACK_HOME: stateDir,
      GSTACK_STATE_DIR: stateDir,
      GSTACK_MANAGED: '1',
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

  test('both automatic update entry points are silent no-ops', () => {
    for (const script of [UPDATE_CHECK, SESSION_UPDATE]) {
      const result = runManagedScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
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

  test('CI falls back when an upstream-only custom runner is unavailable', () => {
    const workflowDir = path.join(ROOT, '.github', 'workflows');
    const workflows = fs.readdirSync(workflowDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .map((name) => [name, fs.readFileSync(path.join(workflowDir, name), 'utf-8')] as const);

    for (const [name, content] of workflows) {
      expect(content, `${name} must not hard-code an org-external runner`).not.toContain(
        'ubicloud-standard-8',
      );
    }
    for (const name of [
      'actionlint.yml',
      'evals-periodic.yml',
      'evals.yml',
      'make-pdf-gate.yml',
      'pr-title-sync.yml',
      'skill-docs.yml',
      'version-gate.yml',
    ]) {
      const content = fs.readFileSync(path.join(workflowDir, name), 'utf-8');
      expect(content).toContain("vars.GSTACK_LINUX_RUNNER || 'ubuntu-latest'");
    }
  });
});
