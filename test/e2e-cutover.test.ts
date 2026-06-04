import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { test, expect } from 'bun:test'

const script = join(process.cwd(), 'scripts/e2e-cutover.sh')
const repoRoot = process.cwd()
const prodCwd = `${repoRoot}__prod`
const allowedChannels = 'slack:<SLACK_CHANNEL_ID>,telegram:<TELEGRAM_GROUP_ID>'

type Harness = { dir: string; bin: string; unit: string; cwdFile: string; log: string; procRoot: string; failStartFile: string; prodCwd: string }

function makeHarness(initialCwd = prodCwd): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-cutover-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const unit = join(dir, 'ccm-daemon.service')
  const cwdFile = join(dir, 'cwd')
  const log = join(dir, 'systemctl.log')
  const failStartFile = join(dir, 'fail-start')
  const procRoot = join(dir, 'proc')
  mkdirSync(join(procRoot, '12345'), { recursive: true })
  writeFileSync(join(procRoot, '12345', 'cwd'), '')
  writeFileSync(unit, [
    '[Unit]',
    'Description=fake ccm',
    '',
    '[Service]',
    `WorkingDirectory=${initialCwd}`,
    'ExecStart=/bin/true',
    'Environment=CHANNEL_DAEMON_SPAWN_MODE=worktree',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n'))
  writeFileSync(cwdFile, initialCwd)
  writeFileSync(log, '')
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> '${log}'
if [[ "$1" == "--user" && "$2" == "is-active" ]]; then echo active; exit 0; fi
if [[ "$1" == "--user" && "$2" == "show" ]]; then
  if [[ "$*" == *MainPID* && "$*" == *--value* ]]; then echo 12345; exit 0; fi
  echo 'FragmentPath=${unit}'
  echo "WorkingDirectory=$(cat '${cwdFile}')"
  echo 'ExecStart={ path=/bin/true ; argv[]=/bin/true ; }'
  exit 0
fi
if [[ "$1" == "--user" && "$2" == "start" ]]; then
  if [[ -f '${failStartFile}' ]]; then exit 0; fi
  wd=$(awk -F= '$1=="WorkingDirectory" { value=$2 } END { print value }' '${unit}')
  printf '%s' "$wd" > '${cwdFile}'
  exit 0
fi
if [[ "$1" == "--user" && ( "$2" == "stop" || "$2" == "daemon-reload" ) ]]; then exit 0; fi
exit 0
`)
  writeFileSync(join(bin, 'readlink'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == '${procRoot}/12345/cwd' ]]; then cat '${cwdFile}'; exit 0; fi
/bin/readlink "$@"
`)
  writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n')
  chmodSync(join(bin, 'systemctl'), 0o755)
  chmodSync(join(bin, 'readlink'), 0o755)
  chmodSync(join(bin, 'sleep'), 0o755)
  return { dir, bin, unit, cwdFile, log, procRoot, failStartFile, prodCwd }
}

function runCutover(args: string[], harness: Harness, extraEnv: Record<string, string | undefined> = {}): { ok: boolean; output: string } {
  try {
    const output = execFileSync(script, args, {
      encoding: 'utf8',
      env: {
        PATH: `${harness.bin}:${process.env.PATH ?? ''}`,
        HOME: harness.dir,
        CCM_E2E_SYSTEMD_UNIT: harness.unit,
        CHANNEL_DAEMON_ALLOWED_CHANNELS: allowedChannels,
        SLACK_BOT_TOKEN: 'x',
        SLACK_APP_TOKEN: 'y',
        CCM_E2E_PROC_ROOT: harness.procRoot,
        CCM_E2E_PROD_CWD: harness.prodCwd,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (err) {
    const error = err as { stdout?: Buffer | string; stderr?: Buffer | string }
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

test('e2e cutover helper starts candidate and rewrites only the test unit', () => {
  const harness = makeHarness()
  const result = runCutover(['start-candidate'], harness)
  expect(result.ok).toBe(true)
  expect(result.output).toContain('Candidate running')
  const unit = readFileSync(harness.unit, 'utf8')
  expect(unit).toContain(`WorkingDirectory=${repoRoot}`)
  expect(unit).toContain(`Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS=${allowedChannels}`)
  expect(readFileSync(`${harness.unit}.before-cx-e2e`, 'utf8')).toContain(`WorkingDirectory=${harness.prodCwd}`)
  expect(readFileSync(harness.log, 'utf8')).toContain('--user stop ccm-daemon.service')
  expect(readFileSync(harness.log, 'utf8')).toContain('--user daemon-reload')
})

test('e2e cutover helper restores old unit and verifies production cwd', () => {
  const harness = makeHarness(repoRoot)
  writeFileSync(`${harness.unit}.before-cx-e2e`, [
    '[Service]',
    `WorkingDirectory=${harness.prodCwd}`,
    'ExecStart=/bin/true',
  ].join('\n'))
  const result = runCutover(['restore-old'], harness)
  expect(result.ok).toBe(true)
  expect(result.output).toContain('Restored production service')
  expect(readFileSync(harness.unit, 'utf8')).toContain(`WorkingDirectory=${harness.prodCwd}`)
  expect(readFileSync(harness.cwdFile, 'utf8')).toBe(harness.prodCwd)
})

test('e2e cutover helper refuses manual self-test prefix', () => {
  const harness = makeHarness()
  const result = runCutover(['start-candidate'], harness, { CHANNEL_DAEMON_SELF_TEST_PREFIX: 'bot:' })
  expect(result.ok).toBe(false)
  expect(result.output).toContain('CHANNEL_DAEMON_SELF_TEST_PREFIX must be unset')
  expect(readFileSync(harness.unit, 'utf8')).toContain(`WorkingDirectory=${harness.prodCwd}`)
})


test('e2e cutover helper adds candidate cwd when unit lacks WorkingDirectory', () => {
  const harness = makeHarness()
  writeFileSync(harness.unit, [
    '[Service]',
    'ExecStart=/bin/true',
    'Environment=CHANNEL_DAEMON_SPAWN_MODE=worktree',
  ].join('\n'))
  const result = runCutover(['start-candidate'], harness)
  expect(result.ok).toBe(true)
  const unit = readFileSync(harness.unit, 'utf8')
  expect(unit).toContain(`WorkingDirectory=${repoRoot}`)
  expect(unit).toContain(`Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS=${allowedChannels}`)
})


test('e2e cutover helper auto-restores old unit when candidate cwd verification fails', () => {
  const harness = makeHarness()
  writeFileSync(harness.failStartFile, '1')
  const result = runCutover(['start-candidate'], harness)
  expect(result.ok).toBe(false)
  expect(result.output).toContain('Restoring previous unit automatically')
  expect(result.output).toContain(`restored cwd: ${harness.prodCwd}`)
  expect(readFileSync(harness.unit, 'utf8')).toContain(`WorkingDirectory=${harness.prodCwd}`)
  const log = readFileSync(harness.log, 'utf8')
  expect((log.match(/--user stop ccm-daemon\.service/g) ?? []).length).toBeGreaterThanOrEqual(2)
  expect((log.match(/--user start ccm-daemon\.service/g) ?? []).length).toBeGreaterThanOrEqual(2)
})

test('e2e cutover helper refuses to overwrite suspicious existing backup', () => {
  const harness = makeHarness()
  writeFileSync(`${harness.unit}.before-cx-e2e`, [
    '[Service]',
    `WorkingDirectory=${repoRoot}`,
    'ExecStart=/bin/true',
  ].join('\n'))
  const result = runCutover(['start-candidate'], harness)
  expect(result.ok).toBe(false)
  expect(result.output).toContain('Refusing to overwrite existing backup with unexpected cwd')
  expect(readFileSync(harness.unit, 'utf8')).toContain(`WorkingDirectory=${harness.prodCwd}`)
})
