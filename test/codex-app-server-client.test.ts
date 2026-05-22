import { test, expect } from 'bun:test'
import { appServerErrorMessage, appServerExitErrorMessage, appServerListenUrlFromLine, appServerMalformedLineMessage, jsonObject, parseAppServerMessage } from '../agents/codex/app-server-client.ts'
import { redactSensitiveText } from '../redact.ts'

test('parseAppServerMessage ignores malformed or non-object JSON-RPC lines', () => {
  expect(parseAppServerMessage('not json')).toBeUndefined()
  expect(parseAppServerMessage('null')).toBeUndefined()
  expect(parseAppServerMessage('[]')).toBeUndefined()
  expect(parseAppServerMessage('"notification"')).toBeUndefined()
})

test('parseAppServerMessage keeps typed object payloads without trusting unknown input', () => {
  const message = parseAppServerMessage('{"id":1,"method":"thread/new","params":{"items":[{"text":"hi"}]}}')
  expect(message).toEqual({ id: 1, method: 'thread/new', params: { items: [{ text: 'hi' }] } })
  expect(typeof message?.id).toBe('number')
  expect(typeof message?.method).toBe('string')
})

test('jsonObject recursively drops non-JSON object members from host objects', () => {
  const message = jsonObject({ id: 1, fn: () => {}, nested: { ok: true, skip: undefined, bad: NaN }, list: [1, undefined, Infinity, { text: 'x' }] })
  expect(message).toEqual({ id: 1, nested: { ok: true }, list: [1, null, null, { text: 'x' }] })
})

test('appServerErrorMessage extracts JSON-RPC error messages with safe fallback', () => {
  expect(appServerErrorMessage({ message: 'denied' })).toBe('denied')
  expect(appServerErrorMessage({ message: { reason: 'denied' } })).toBe('{"reason":"denied"}')
  expect(appServerErrorMessage({ code: -32000, data: { reason: 'bad' } })).toBe('{"code":-32000,"data":{"reason":"bad"}}')
  expect(appServerErrorMessage({ message: 'OPENAI_API_KEY=sk-1234567890abcdef' })).toBe('OPENAI_API_KEY=…redacted')
  expect(appServerErrorMessage('bad')).toBeUndefined()
})


test('appServerExitErrorMessage includes recent stderr without unbounded output', () => {
  expect(appServerExitErrorMessage(1, null, [])).toBe('codex app-server exited (1)')
  expect(appServerExitErrorMessage(1, null, ['warn', 'Missing environment variable: OPENAI_API_KEY'])).toBe('codex app-server exited (1): warn | Missing environment variable: OPENAI_API_KEY')
  expect(appServerExitErrorMessage(null, 'SIGTERM', ['a', 'b', 'c', 'd'])).toBe('codex app-server exited (SIGTERM): b | c | d')
})

test('appServerExitErrorMessage redacts secrets from stderr before user-visible surfacing', () => {
  expect(redactSensitiveText('OPENAI_API_KEY=sk-1234567890abcdef')).toBe('OPENAI_API_KEY=…redacted')
  expect(redactSensitiveText('token: ghp_abcdefghijklmnopqrstuvwxyz')).toBe('token: …redacted')
  expect(redactSensitiveText('secret = hunter2')).toBe('secret = …redacted')
  expect(appServerExitErrorMessage(1, null, ['using sk-1234567890abcdef'])).toBe('codex app-server exited (1): using sk-…redacted')
})


test('appServerMalformedLineMessage redacts and bounds ignored stdout', () => {
  const line = `not-json OPENAI_API_KEY=sk-1234567890abcdef ${'x'.repeat(700)}`
  const message = appServerMalformedLineMessage(line)
  expect(message).toStartWith('codex app-server ignored malformed stdout line: not-json OPENAI_API_KEY=…redacted')
  expect(message).not.toContain('sk-1234567890abcdef')
  expect(message.length).toBeLessThanOrEqual('codex app-server ignored malformed stdout line: '.length + 500)
})

test('appServerListenUrlFromLine extracts loopback websocket listener URL', () => {
  expect(appServerListenUrlFromLine('listening on: ws://127.0.0.1:41821')).toBe('ws://127.0.0.1:41821')
  expect(appServerListenUrlFromLine('[info] listening on: ws://127.0.0.1:41821/abc')).toBe('ws://127.0.0.1:41821/abc')
  expect(appServerListenUrlFromLine('listening on: http://127.0.0.1:41821')).toBeUndefined()
})
