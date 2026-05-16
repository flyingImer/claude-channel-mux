import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { test, expect } from 'bun:test'

const script = join(process.cwd(), 'scripts/e2e-preflight.sh')

function runPreflight(env: Record<string, string | undefined>): { ok: boolean; output: string } {
  const home = mkdtempSync(join(tmpdir(), 'ccm-preflight-home-'))
  const stateDir = mkdtempSync(join(tmpdir(), 'ccm-preflight-state-'))
  try {
    const output = execFileSync(script, {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        CHANNEL_DAEMON_STATE_DIR: stateDir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (err) {
    const error = err as { stdout?: Buffer | string; stderr?: Buffer | string }
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

test('e2e preflight requires an allowlist and platform tokens', () => {
  const missingAllow = runPreflight({ SLACK_BOT_TOKEN: 'x', SLACK_APP_TOKEN: 'y' })
  expect(missingAllow.ok).toBe(false)
  expect(missingAllow.output).toContain('CHANNEL_DAEMON_ALLOWED_CHANNELS')

  const missingToken = runPreflight({ CHANNEL_DAEMON_ALLOWED_CHANNELS: 'slack:C123' })
  expect(missingToken.ok).toBe(false)
  expect(missingToken.output).toContain('Set at least one platform token')
})

test('e2e preflight validates Slack token pairing and cwd', () => {
  const missingApp = runPreflight({ CHANNEL_DAEMON_ALLOWED_CHANNELS: 'slack:C123', SLACK_BOT_TOKEN: 'x' })
  expect(missingApp.ok).toBe(false)
  expect(missingApp.output).toContain('SLACK_APP_TOKEN is required')

  const badCwd = runPreflight({ CHANNEL_DAEMON_ALLOWED_CHANNELS: 'telegram:-1001', TELEGRAM_BOT_TOKEN: 't', CHANNEL_DAEMON_CWD: '/definitely/missing/ccm-preflight' })
  expect(badCwd.ok).toBe(false)
  expect(badCwd.output).toContain('CHANNEL_DAEMON_CWD/default cwd is not a readable directory')
})

test('e2e preflight loads isolated env while preserving shell overrides', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'ccm-preflight-'))
  const cwd = join(stateDir, 'cwd')
  mkdirSync(cwd)
  writeFileSync(join(stateDir, '.env'), [
    'TELEGRAM_BOT_TOKEN=from-file',
    `CHANNEL_DAEMON_CWD=${cwd}`,
    'CHANNEL_DAEMON_ALLOWED_CHANNELS=telegram:FROM_FILE',
  ].join('\n'))

  const result = runPreflight({
    CHANNEL_DAEMON_STATE_DIR: stateDir,
    CHANNEL_DAEMON_ALLOWED_CHANNELS: 'telegram:FROM_SHELL',
    TELEGRAM_BOT_TOKEN: 'from-shell',
  })

  expect(result.ok).toBe(true)
  expect(result.output).toContain(`state:    ${stateDir}`)
  expect(result.output).toContain('allow:    telegram:FROM_SHELL')
  expect(result.output).toContain(`default:  ${cwd}`)
})

test('e2e preflight points manual gate to reversible cutover helper', () => {
  const result = runPreflight({
    CHANNEL_DAEMON_ALLOWED_CHANNELS: 'slack:C123,telegram:-1001',
    SLACK_BOT_TOKEN: 'x',
    SLACK_APP_TOKEN: 'y',
  })
  expect(result.ok).toBe(true)
  expect(result.output).toContain('scripts/e2e-cutover.sh start-candidate')
  expect(result.output).toContain('docs/e2e-parity-plan.md')
  expect(result.output).toContain('scripts/e2e-cutover.sh restore-old')
  expect(result.output).toContain('scripts/e2e-cutover.sh status')
})
