import { test, expect } from 'bun:test'
import { daemonFrameFromLine, daemonInboundMessage, daemonPermissionResponse, daemonToolError, daemonToolResult, recordValue, stringList, toolArguments } from '../server-ipc.ts'

test('daemonFrameFromLine accepts only JSON object frames', () => {
  expect(daemonFrameFromLine('{"type":"pong"}')).toEqual({ type: 'pong' })
  expect(daemonFrameFromLine('not json')).toBeUndefined()
  expect(daemonFrameFromLine('[]')).toBeUndefined()
  expect(daemonFrameFromLine('null')).toBeUndefined()
})

test('daemon message helpers fail closed and coerce only supported fields', () => {
  expect(recordValue([])).toBeUndefined()
  expect(stringList(['a', 1, 'b'])).toEqual(['a', 'b'])
  expect(daemonPermissionResponse({ request_id: 'r', behavior: 'allow' })).toEqual({ request_id: 'r', behavior: 'allow' })
  expect(daemonPermissionResponse({ request_id: 'r', behavior: 'maybe' })).toBeUndefined()
  expect(daemonInboundMessage({ content: 'hi', meta: { ok: 'yes', bad: 1 } })).toEqual({ content: 'hi', meta: { ok: 'yes' } })
  expect(daemonInboundMessage({ content: 'hi', meta: [] })).toBeUndefined()
  expect(daemonToolResult({ callId: 'c', result: 1 })).toEqual({ callId: 'c', result: '' })
  expect(daemonToolError({ callId: 'c' })).toEqual({ callId: 'c', error: 'daemon tool error' })
  expect(toolArguments([])).toEqual({})
})
