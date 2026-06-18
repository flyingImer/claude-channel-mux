import { readFileSync } from 'fs'
import { test, expect } from 'bun:test'

test('ccm orchestrator command exposes on off and status controls', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const manifest = readFileSync('slack-app-manifest.json', 'utf8')

  expect(daemon).toContain('`ccm orchestrator on|off|status` / `ccm orch on|off|status`')
  expect(daemon).toContain('`ccm orch on|off|status`')
  expect(daemon).toContain('orchestrator|orch')
  expect(daemon).toContain("case 'orchestrator':")
  expect(daemon).toContain("setRoomOrchestratorFlag(ck, true)")
  expect(daemon).toContain("setRoomOrchestratorFlag(ck, false)")
  expect(daemon).toContain('roomOrchestratorStatusText')
  expect(daemon).toContain("const state = binding.isOrchestrator ? 'ON' : 'OFF'")
  expect(daemon).toContain('ordinary default-enabled')
  expect(daemon).toContain('worker-forced-disabled')
  // Break-glass: re-enabling a worker-forced-disabled room is audit-logged and announced (no
  // separate confirmation step — an explicit human `/ccm orch on` is the break-glass).
  expect(daemon).toContain("event: 'orchestrator_break_glass_enabled'")
  expect(daemon).toContain("priorSource === 'worker-forced-disabled'")
  expect(manifest).toContain('orchestrator')
  expect(manifest).toContain('orch')
})
