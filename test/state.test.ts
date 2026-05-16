import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from 'bun:test'
import { codexPendingRequestsFromJson, persistedCodexPendingRequests, readJsonRecordFile, readJsonValueFile, recordValue, stringRecord, transcriptDeliveriesFromJson } from '../state.ts'

test('recordValue accepts only plain JSON-style objects', () => {
  expect(recordValue({ ok: true })).toEqual({ ok: true })
  expect(recordValue(null)).toBeUndefined()
  expect(recordValue([])).toBeUndefined()
})

test('readJsonValueFile and readJsonRecordFile fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-state-test-'))
  try {
    const objectPath = join(dir, 'object.json')
    const arrayPath = join(dir, 'array.json')
    const badPath = join(dir, 'bad.json')
    writeFileSync(objectPath, '{"ok":true}')
    writeFileSync(arrayPath, '[1,2]')
    writeFileSync(badPath, 'not json')
    expect(readJsonValueFile(objectPath)).toEqual({ ok: true })
    expect(readJsonRecordFile(objectPath)).toEqual({ ok: true })
    expect(readJsonRecordFile(arrayPath)).toEqual({})
    expect(readJsonValueFile(badPath)).toBeUndefined()
    expect(readJsonRecordFile(join(dir, 'missing.json'))).toEqual({})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('stringRecord keeps only string values from persisted maps', () => {
  expect(stringRecord({ a: 'one', b: 2, c: '', d: 'two' })).toEqual({ a: 'one', d: 'two' })
  expect(stringRecord([])).toEqual({})
})

test('codexPendingRequestsFromJson keeps only complete typed pending requests', () => {
  const pending = codexPendingRequestsFromJson({
    good: {
      sessionId: 's1',
      requestId: 'r1',
      method: 'execCommandApproval',
      channelKey: 'slack:C1',
      channelId: 'C1',
      messageId: 'm1',
      messageIds: ['m1', 2, '', 'm2', 'm1'],
      threadId: 'thread-1',
      params: { command: 'echo ok', nested: { keep: true, drop: () => {}, nan: NaN }, list: [1, undefined, Infinity, { ok: 'yes' }] },
      createdAt: 123,
    },
    missingParams: { sessionId: 's2', requestId: 'r2', method: 'x', channelKey: 'slack:C1', channelId: 'C1', createdAt: 124 },
    badCreatedAt: { sessionId: 's3', requestId: 'r3', method: 'x', channelKey: 'slack:C1', channelId: 'C1', params: {}, createdAt: 'now' },
    badCreatedAtNaN: { sessionId: 's4', requestId: 'r4', method: 'x', channelKey: 'slack:C1', channelId: 'C1', params: {}, createdAt: NaN },
  })
  expect([...pending.entries()]).toEqual([
    [
      'good',
      {
        sessionId: 's1',
        requestId: 'r1',
        method: 'execCommandApproval',
        channelKey: 'slack:C1',
        channelId: 'C1',
        messageId: 'm1',
        messageIds: ['m1', 'm2'],
        threadId: 'thread-1',
        params: { command: 'echo ok', nested: { keep: true }, list: [1, null, null, { ok: 'yes' }] },
        createdAt: 123,
      },
    ],
    [
      'missingParams',
      {
        sessionId: 's2',
        requestId: 'r2',
        method: 'x',
        channelKey: 'slack:C1',
        channelId: 'C1',
        params: {},
        createdAt: 124,
      },
    ],
  ])
  expect(codexPendingRequestsFromJson([]).size).toBe(0)
})


test('persistedCodexPendingRequests omits params from disk snapshots', () => {
  const requests = codexPendingRequestsFromJson({
    request: {
      sessionId: 's1',
      requestId: 'r1',
      method: 'item/commandExecution/requestApproval',
      channelKey: 'slack:C1',
      channelId: 'C1',
      messageId: 'm1',
      threadId: 'thread-1',
      params: { command: 'echo secret', requestedSchema: { properties: { token: { type: 'string' } } } },
      createdAt: 123,
    },
  })
  expect(requests.get('request')?.params).toEqual({ command: 'echo secret', requestedSchema: { properties: { token: { type: 'string' } } } })
  expect(persistedCodexPendingRequests(requests)).toEqual({
    request: {
      sessionId: 's1',
      requestId: 'r1',
      method: 'item/commandExecution/requestApproval',
      channelKey: 'slack:C1',
      channelId: 'C1',
      messageId: 'm1',
      threadId: 'thread-1',
      createdAt: 123,
    },
  })
})


test('transcriptDeliveriesFromJson keeps only valid delivery entries', () => {
  expect(transcriptDeliveriesFromJson({
    uuid1: {
      key1: { channels: ['slack:C1', 2, '', 'telegram:T1', 'slack:C1'], ts: 10 },
      badChannels: { channels: 'slack:C1', ts: 11 },
      badTs: { channels: ['slack:C2'], ts: 'now' },
      badTsInfinity: { channels: ['slack:C3'], ts: Infinity },
    },
    uuid2: { onlyBad: { channels: [], ts: 12 } },
    uuid3: null,
  })).toEqual({
    uuid1: { key1: { channels: ['slack:C1', 'telegram:T1'], ts: 10 } },
  })
  expect(transcriptDeliveriesFromJson([])).toEqual({})
})
