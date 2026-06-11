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
  expect(daemon).toContain('Agent Control Path orchestrator room is ON')
  expect(daemon).toContain('Agent Control Path orchestrator room is OFF')
  expect(manifest).toContain('orchestrator')
  expect(manifest).toContain('orch')
})
