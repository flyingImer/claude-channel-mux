import { test, expect } from 'bun:test'
import { agentHeader, agentLabel, agentName, formatAgentReply } from '../agents/identity.ts'

test('agent identity labels and headers are stable', () => {
  expect(agentLabel('claude')).toBe('🟣 Claude')
  expect(agentLabel('codex')).toBe('🟢 Codex')
  expect(agentName('claude')).toBe('Claude')
  expect(agentName('codex')).toBe('Codex')
  expect(agentHeader('claude')).toBe('**🟣 Claude**')
  expect(agentHeader('codex')).toBe('**🟢 Codex**')
})

test('formatAgentReply prefixes unlabelled replies once', () => {
  expect(formatAgentReply('claude', 'hello')).toBe('**🟣 Claude**\nhello')
  expect(formatAgentReply('codex', ' hello\n')).toBe('**🟢 Codex**\nhello')
  expect(formatAgentReply('codex', '')).toBe('**🟢 Codex**')
})

test('formatAgentReply is idempotent for markdown and plain identity headers', () => {
  expect(formatAgentReply('claude', '**🟣 Claude**\nhello')).toBe('**🟣 Claude**\nhello')
  expect(formatAgentReply('claude', '🟣 Claude\r\nhello')).toBe('🟣 Claude\r\nhello')
  expect(formatAgentReply('codex', '**🟢 Codex**\r\nhello')).toBe('**🟢 Codex**\r\nhello')
  expect(formatAgentReply('codex', '🟢 Codex\nhello')).toBe('🟢 Codex\nhello')
})
