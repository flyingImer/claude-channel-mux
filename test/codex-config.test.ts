import { test, expect } from 'bun:test'
import { codexConfigWithModelOverride, codexResolvedConfigFromEnv } from '../agents/codex/config.ts'

test('Codex resolved config centralizes command, model, transport, worktree, and trust knobs', () => {
  const config = codexResolvedConfigFromEnv({
    CODEX_BIN: 'env CODEX_PROFILE=prod codex -c public.key=value',
    CODEX_MODEL: 'base-model',
    CCM_CODEX_APP_SERVER_LISTEN: 'stdio',
    CCM_CODEX_WORKTREE: 'off',
    CODEX_HOME: '/tmp/codex-home',
    CCM_CODEX_APPROVAL_POLICY: 'never',
    CCM_CODEX_SANDBOX: 'danger-full-access',
    CCM_CODEX_CONFIG_ARGS: '["-c","model_providers.sfc.base_url=\\\"http://127.0.0.1:24000/v1\\\""]',
  })

  expect(config.command).toEqual(['env', 'CODEX_PROFILE=prod', 'codex', '-c', 'public.key=value'])
  expect(config.launchArgs).toEqual(['-m', 'base-model'])
  expect(config.configArgs).toEqual(['-c', 'model_providers.sfc.base_url="http://127.0.0.1:24000/v1"'])
  expect(config.model).toBe('base-model')
  expect(config.appServerListen).toBe('stdio')
  expect(config.worktreeMode).toBe('off')
  expect(config.home).toBe('/tmp/codex-home')
  expect(config.sessionsDir).toBe('/tmp/codex-home/sessions')
  expect(config.approvalPolicy).toBe('never')
  expect(config.sandbox).toBe('danger-full-access')
})

test('Codex room model override derives a new config without mutating deployment command', () => {
  const base = codexResolvedConfigFromEnv({ CODEX_BIN: 'codex -c public.key=value', CODEX_MODEL: 'base-model' })
  const override = codexConfigWithModelOverride(base, 'room-model')

  expect(base.launchArgs).toEqual(['-m', 'base-model'])
  expect(override.command).toEqual(base.command)
  expect(override.launchArgs).toEqual(['-m', 'room-model'])
  expect(override.model).toBe('room-model')
})
