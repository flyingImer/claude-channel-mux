import { test, expect } from 'bun:test'
import { compactStartingMessage, preCompactSessionId } from '../hooks/pre-compact.ts'

test('preCompactSessionId extracts only non-empty string session ids', () => {
  expect(preCompactSessionId('{"session_id":"abc-123"}')).toBe('abc-123')
  expect(preCompactSessionId('{"session_id":""}')).toBeUndefined()
  expect(preCompactSessionId('{"session_id":123}')).toBeUndefined()
  expect(preCompactSessionId('[]')).toBeUndefined()
  expect(preCompactSessionId('not json')).toBeUndefined()
})

test('compactStartingMessage emits daemon IPC newline frame', () => {
  expect(compactStartingMessage('abc-123')).toBe('{"type":"compact_starting","uuid":"abc-123"}\n')
})
