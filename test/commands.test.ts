import { test, expect } from 'bun:test'
import { parseAgentCommandArgs, parseAgentCommandName } from '../commands.ts'

test('parseAgentCommandName accepts slash and bare command forms', () => {
  expect(parseAgentCommandName('/model gpt-5.4')).toBe('model')
  expect(parseAgentCommandName('model gpt-5.4')).toBe('model')
  expect(parseAgentCommandName('  /NAV 1 allow  ')).toBe('nav')
  expect(parseAgentCommandName('')).toBe('')
})

test('parseAgentCommandArgs preserves the command argument tail', () => {
  expect(parseAgentCommandArgs('/model gpt-5.4')).toBe('gpt-5.4')
  expect(parseAgentCommandArgs('raw /goal set ship it')).toBe('/goal set ship it')
  expect(parseAgentCommandArgs('/nav 1 answer yes please')).toBe('1 answer yes please')
  expect(parseAgentCommandArgs('/ss')).toBe('')
})
