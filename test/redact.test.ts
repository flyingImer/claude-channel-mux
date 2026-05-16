import { test, expect } from 'bun:test'
import { errorMessage, redactSensitiveText } from '../redact.ts'

test('redactSensitiveText covers common AI, Slack, GitHub, and bearer token forms', () => {
  expect(redactSensitiveText('OPENAI_API_KEY=sk-1234567890abcdef')).toBe('OPENAI_API_KEY=…redacted')
  expect(redactSensitiveText('using sk-proj-1234567890abcdef')).toBe('using sk-…redacted')
  expect(redactSensitiveText('slack xoxb-1234567890-abcdefghijk')).toBe('slack xoxb-…redacted')
  expect(redactSensitiveText('slack-app xapp-1-A1234567890-abcdef123456')).toBe('slack-app xapp-…redacted')
  expect(redactSensitiveText('github ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe('github ghp_…redacted')
  expect(redactSensitiveText('github-fg github_pat_1234567890abcdefghijklmnopqrstuvwxyz_ABCDEF')).toBe('github-fg github_pat_…redacted')
  expect(redactSensitiveText('Authorization: Bearer abcdefghijklmnop1234567890')).toBe('Authorization: Bearer …redacted')
  expect(redactSensitiveText('token: ghp_abcdefghijklmnopqrstuvwxyz')).toBe('token: …redacted')
  expect(redactSensitiveText('secret = hunter2')).toBe('secret = …redacted')
})

test('redactSensitiveText leaves ordinary short identifiers readable', () => {
  expect(redactSensitiveText('model gpt-5.2 and issue GH-123')).toBe('model gpt-5.2 and issue GH-123')
  expect(redactSensitiveText('Missing environment variable: OPENAI_API_KEY')).toBe('Missing environment variable: OPENAI_API_KEY')
})


test('errorMessage redacts Error messages and non-Error values', () => {
  expect(errorMessage(new Error('failed with token=ghp_abcdefghijklmnopqrstuvwxyz'))).toBe('failed with token=…redacted')
  expect(errorMessage('Authorization: Bearer abcdefghijklmnop1234567890')).toBe('Authorization: Bearer …redacted')
})
