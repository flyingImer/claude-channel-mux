import { test, expect } from 'bun:test'
import { buildKeyboard, detectInteractiveUI, parseEscortCallback, zellijSessionAlive } from '../escort.ts'

test('detectInteractiveUI extracts Claude selection prompts', () => {
  const ui = detectInteractiveUI(`Allow command?
  1. Yes
❯ 2. No
Enter to confirm`)
  expect(ui).toMatchObject({ type: 'selection', title: 'Allow command?', options: ['Yes', 'No'], selectedIndex: 1 })
})

test('buildKeyboard emits scoped escort callbacks', () => {
  const ui = detectInteractiveUI(`Allow command?
❯ 1. Yes
  2. No
Enter to confirm`)
  expect(ui).not.toBeNull()
  const keyboard = buildKeyboard(ui!, 123)
  expect(keyboard[0][0]).toMatchObject({ data: 'esc:123:select:0' })
  expect(keyboard.at(-1)?.map(button => button.data)).toContain('esc:123:key:Enter')
})

test('parseEscortCallback fails closed for malformed pane ids, indexes, and keys', () => {
  expect(parseEscortCallback('esc:123:key:Enter')).toEqual({ type: 'key', paneId: 123, key: 'Enter' })
  expect(parseEscortCallback('esc:123:select:0')).toEqual({ type: 'select', paneId: 123, targetIndex: 0 })
  expect(parseEscortCallback('esc:123abc:key:Enter')).toBeUndefined()
  expect(parseEscortCallback('esc:123:select:4abc')).toBeUndefined()
  expect(parseEscortCallback('esc:123:select:-1')).toBeUndefined()
  expect(parseEscortCallback('esc:123:key:Ctrl+C')).toBeUndefined()
  expect(parseEscortCallback('esc:123:key:Enter:extra')).toBeUndefined()
})


test('zellijSessionAlive handles missing, active, and exited sessions', () => {
  expect(zellijSessionAlive('adamant-lemur [Created 1h ago] (current)\nccmux [Created 1h ago] ', 'ccmux')).toBe(true)
  expect(zellijSessionAlive('adamant-lemur [Created 1h ago] (current)', 'ccmux')).toBe(false)
  expect(zellijSessionAlive('ccmux [Created 1h ago] (EXITED - attach to resurrect)', 'ccmux')).toBe(false)
  expect(zellijSessionAlive('my-ccmux [Created 1h ago]', 'ccmux')).toBe(false)
})
