import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { test, expect } from 'bun:test'

const script = join(process.cwd(), 'scripts/e2e-result.sh')

function runResult(args: string[], extraEnv: Record<string, string | undefined> = {}): { ok: boolean; output: string } {
  try {
    const output = execFileSync(script, args, { encoding: 'utf8', env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, output }
  } catch (err) {
    const error = err as { stdout?: Buffer | string; stderr?: Buffer | string }
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

test('e2e result helper creates timestamped result copy', () => {
  const name = `test-${Date.now()}`
  const resultsDir = mkdtempSync(join(tmpdir(), 'ccm-e2e-results-dir-'))
  const result = runResult(['new', name], { CCM_E2E_RESULTS_DIR: resultsDir })
  expect(result.ok).toBe(true)
  const file = result.output.trim()
  expect(file).toBe(join(resultsDir, `${name}.md`))
  const content = readFileSync(file, 'utf8')
  expect(content).toContain('# CCM CC/CX Live E2E Result')
  expect(content).toMatch(/- Date\/time UTC: \d{4}-\d{2}-\d{2}T/)
  expect(content).toContain('| Slack Codex | `/cx help` shows `🟢 Codex`')
})

test('e2e result helper rejects incomplete TODO result files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-e2e-result-'))
  const file = join(dir, 'result.md')
  writeFileSync(file, [
    '- Date/time UTC: 2026-05-15T00:00:00Z',
    '- Tester: codex',
    '- Preflight command/output: ok',
    '- Cutover command/output: ok',
    '- Restore command/output: ok',
    '| Area | Check | Status | Evidence |',
    '| --- | --- | --- | --- |',
    '| Slack | check | TODO | |',
  ].join('\n'))
  const result = runResult(['check', file])
  expect(result.ok).toBe(false)
  expect(result.output).toContain('TODO checks')
})

test('e2e result helper accepts filled PASS/WARN result files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-e2e-result-'))
  const file = join(dir, 'result.md')
  writeFileSync(file, [
    '- Date/time UTC: 2026-05-15T00:00:00Z',
    '- Tester: codex',
    '- Preflight command/output: ok',
    '- Cutover command/output: ok',
    '- Restore command/output: ok',
    '| Area | Check | Status | Evidence |',
    '| --- | --- | --- | --- |',
    '| Slack | check | PASS | link |',
    '| Telegram | warning | WARN | accepted |',
  ].join('\n'))
  const result = runResult(['check', file])
  expect(result.ok).toBe(true)
  expect(result.output).toContain('complete enough for audit')
})

test('e2e helper scripts pass bash syntax checks', () => {
  for (const helper of ['scripts/e2e-preflight.sh', 'scripts/e2e-cutover.sh', 'scripts/e2e-result.sh']) {
    const result = (() => {
      try {
        execFileSync('bash', ['-n', helper], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        return { ok: true, output: '' }
      } catch (err) {
        const error = err as { stdout?: Buffer | string; stderr?: Buffer | string }
        return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
      }
    })()
    expect(result.ok).toBe(true)
    expect(result.output).toBe('')
  }
})
