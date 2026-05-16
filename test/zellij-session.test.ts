import { test, expect } from 'bun:test'
import { findZellijSessionLine, stripAnsi } from '../zellij.ts'

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
