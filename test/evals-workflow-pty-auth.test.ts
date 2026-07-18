import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/evals.yml'), 'utf8');

describe('paid PTY E2E workflow auth preflight', () => {
  test('detects missing auth before seeding or launching Claude', () => {
    const detect = workflow.indexOf('- name: Detect PTY smoke auth');
    const seed = workflow.indexOf('- name: Seed claude interactive config');
    const run = workflow.indexOf('- name: Run ${{ matrix.suite.name }}');

    expect(detect).toBeGreaterThan(-1);
    expect(detect).toBeLessThan(seed);
    expect(seed).toBeLessThan(run);

    const preflight = workflow.slice(detect, seed);
    expect(preflight).toContain('id: pty-auth');
    expect(preflight).toContain('echo "available=true" >> "$GITHUB_OUTPUT"');
    expect(preflight).toContain('echo "available=false" >> "$GITHUB_OUTPUT"');
    expect(preflight).toContain('paid Claude PTY checks were not executed');
  });

  test('gates only the paid PTY setup and run steps on the boolean output', () => {
    const authCondition = "steps.pty-auth.outputs.available == 'true'";
    expect(workflow.match(new RegExp(authCondition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length).toBe(3);
    expect(workflow).toContain(
      "matrix.suite.name != 'e2e-pty-plan-smoke' || steps.pty-auth.outputs.available == 'true'",
    );
  });
});
