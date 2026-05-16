import { test, expect } from 'bun:test'
import { ipcMessageFromLine } from '../ipc.ts'

test('ipcMessageFromLine accepts only JSON object lines', () => {
  expect(ipcMessageFromLine('{"type":"ping","uuid":"u"}')).toEqual({ type: 'ping', uuid: 'u' })
  expect(ipcMessageFromLine('not json')).toBeUndefined()
  expect(ipcMessageFromLine('[]')).toBeUndefined()
  expect(ipcMessageFromLine('null')).toBeUndefined()
  expect(ipcMessageFromLine('"ping"')).toBeUndefined()
})
