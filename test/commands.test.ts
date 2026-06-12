import { test, expect } from 'bun:test'
import { agentCommandBodyAfterPrefix, formatParsedAgentCommand, parseAgentCommandArgs, parseAgentCommandName } from '../commands.ts'

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

test('agentCommandBodyAfterPrefix preserves multiline slash command bodies', () => {
  const body = 'goal first line\nsecond line\nthird line'
  expect(agentCommandBodyAfterPrefix(`/cx ${body}`, 'cx')).toBe(body)
  expect(agentCommandBodyAfterPrefix(`/cc ${body}`, 'cc')).toBe(body)
  expect(agentCommandBodyAfterPrefix(`/cx_goal first line\nsecond line`, 'cx')).toBe('goal first line\nsecond line')
  expect(agentCommandBodyAfterPrefix('<@U123> /cx goal one\ntwo', 'cx')).toBe('goal one\ntwo')
})

test('formatParsedAgentCommand preserves multiline command visibility', () => {
  const command = '/raw /goal first line\nsecond line\nthird line'
  expect(formatParsedAgentCommand(command)).toBe('🧭 Parsed command:\n```\n/raw /goal first line\nsecond line\nthird line\n```')
})

test('formatParsedAgentCommand preserves long command visibility', () => {
  const tail = 'x'.repeat(900)
  const command = `/raw /goal first line\n${tail}`
  const formatted = formatParsedAgentCommand(command)
  expect(formatted).toContain(tail)
  expect(formatted).not.toContain('…')
})
