import { test, expect } from 'bun:test'
import { claudeBackendZellijSessionName, codexTuiZellijSessionName, exitedCcmZellijSessionNames, findZellijSessionLine, parseZellijClients, stripAnsi, zellijAttachCommand } from '../zellij.ts'

test('findZellijSessionLine matches the exact session name token', () => {
  const output = [
    'ccmux-old EXITED',
    'my-ccmux-test EXITED',
    'ccmux (Created 1h ago)',
  ].join('\n')

  expect(findZellijSessionLine(output, 'ccmux')).toBe('ccmux (Created 1h ago)')
  expect(findZellijSessionLine(output, 'ccmux-old')).toBe('ccmux-old EXITED')
  expect(findZellijSessionLine(output, 'missing')).toBeUndefined()
})



test('findZellijSessionLine strips ANSI formatting from zellij output', () => {
  const output = '\x1b[32;1mccmux\x1b[m [Created 1h ago] (\x1b[31;1mEXITED\x1b[m - attach to resurrect)'

  expect(stripAnsi(output)).toBe('ccmux [Created 1h ago] (EXITED - attach to resurrect)')
  expect(findZellijSessionLine(output, 'ccmux')).toBe('ccmux [Created 1h ago] (EXITED - attach to resurrect)')
})

test('findZellijSessionLine ignores whitespace and substring matches', () => {
  const output = '  ccmux-backup EXITED\n\tccmux ACTIVE\nother-ccmux ACTIVE'

  expect(findZellijSessionLine(output, 'ccmux')).toBe('\tccmux ACTIVE')
  expect(findZellijSessionLine(output, 'mux')).toBeUndefined()
})

test('exitedCcmZellijSessionNames returns only exited per-session CCM resources', () => {
  const output = [
    '\x1b[32;1mccm-cc-deadbeef\x1b[m [Created 2days ago] (\x1b[31;1mEXITED\x1b[m - attach to resurrect)',
    'ccm-cx-cafebabe [Created 1h ago] (EXITED - attach to resurrect)',
    'ccm-cc-01234567 [Created 5m ago]',
    'ccmux [Created 2h ago] (EXITED - attach to resurrect)',
    'unrelated [Created 3h ago] (EXITED - attach to resurrect)',
    'ccm-cc-deadbeef [Created 2days ago] (EXITED - attach to resurrect)',
  ].join('\n')

  expect(exitedCcmZellijSessionNames(output)).toEqual([
    'ccm-cc-deadbeef',
    'ccm-cx-cafebabe',
  ])
})

import { parseZellijJson, zellijPanes, zellijTabs } from '../zellij-json.ts'

test('zellijPanes keeps only typed pane records from unknown JSON', () => {
  expect(zellijPanes([
    { id: 1, tab_name: 'ccm:abc', is_plugin: false, exited: false, exit_status: null },
    { id: '2', tab_name: 'bad' },
    null,
    { id: 3, tab_name: 4, is_plugin: 'no', exited: 'no', exit_status: 'bad' },
  ])).toEqual([
    { id: 1, tab_name: 'ccm:abc', is_plugin: false, exited: false, exit_status: null },
    { id: 3, tab_name: undefined, is_plugin: undefined, exited: undefined, exit_status: undefined },
  ])
})

test('zellijTabs keeps only typed tab records from unknown JSON', () => {
  expect(zellijTabs([
    { name: 'ccm:abc', tab_id: 10 },
    { name: 'bad', tab_id: '11' },
    { name: 12, tab_id: 12 },
  ])).toEqual([{ name: 'ccm:abc', tab_id: 10 }])
})


test('parseZellijJson ignores malformed zellij output', () => {
  expect(parseZellijJson('[{"id":1}]')).toEqual([{ id: 1 }])
  expect(parseZellijJson('not json')).toBeUndefined()
})

test('per-session zellij names use deterministic safe prefixes', () => {
  expect(claudeBackendZellijSessionName('019e94e57c377cb3b3152443705b9aaf')).toBe('ccm-cc-019e94e5')
  expect(codexTuiZellijSessionName('ccm-session')).toBe('ccm-cx-ccm-sess')
  expect(() => claudeBackendZellijSessionName('!bad')).toThrow('invalid session uuid prefix')
})

test('zellij attach command rejects unsafe session names', () => {
  expect(zellijAttachCommand('ccm-cc-019e94e5')).toBe('zellij attach ccm-cc-019e94e5')
  expect(() => zellijAttachCommand('ccm;rm -rf /')).toThrow('unsafe zellij session name')
})

test('parseZellijClients parses table output without leaking command parsing assumptions', () => {
  expect(parseZellijClients([
    'CLIENT_ID PANE_ID RUNNING_COMMAND',
    '1 42 zsh',
    'client-2 7 claude',
  ].join('\n'))).toEqual([
    { clientId: '1', paneId: '42', runningCommand: 'zsh' },
    { clientId: 'client-2', paneId: '7', runningCommand: 'claude' },
  ])
})

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'

test('memory measurement script exposes rollout gate options', () => {
  expect(existsSync('scripts/measure-zellij-tui-memory.ts')).toBe(true)
  const result = spawnSync('bun', ['scripts/measure-zellij-tui-memory.ts'], { encoding: 'utf8' })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('--max-per-session-rss-kb')
  expect(result.stderr).toContain('--require-per-session')
})
