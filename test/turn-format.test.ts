import { test, expect } from 'bun:test'
import { escapedCurrentMessageBytes, truncateAgentContextTurnText } from '../agents/turn-format.ts'

test('truncateAgentContextTurnText caps escaped current-message bytes', () => {
  const input = '<&'.repeat(10_000)
  const result = truncateAgentContextTurnText(input, 'Use fetch_thread(thread_id="t1").', 800)
  expect(result.truncated).toBe(true)
  expect(escapedCurrentMessageBytes(result.text)).toBeLessThanOrEqual(800)
  expect(result.text).toContain('truncated by CCM')
})

test('truncateAgentContextTurnText preserves small text unchanged', () => {
  const input = 'small peer context'
  expect(truncateAgentContextTurnText(input, 'hint', 800)).toEqual({ text: input, truncated: false })
})

test('truncateAgentContextTurnText fails closed for impossible caps', () => {
  expect(truncateAgentContextTurnText('abc', 'hint', 1)).toEqual({ text: '', truncated: true })
  expect(truncateAgentContextTurnText('abc', 'hint', 0)).toEqual({ text: '', truncated: true })
})
