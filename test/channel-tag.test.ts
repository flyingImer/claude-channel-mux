import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { channelMessageIdFromContent } from '../transcript.ts'

test('channelMessageIdFromContent helper handles typed text blocks without any casts', () => {
  const helper = readFileSync('transcript.ts', 'utf8')
  expect(channelMessageIdFromContent('<channel message_id="m1">x</channel>')).toBe('m1')
  expect(channelMessageIdFromContent([{ type: 'text', text: '<channel message_id="m2">x</channel>' }])).toBe('m2')
  expect(helper).toContain('function transcriptRecord(value: unknown): Record<string, unknown> | undefined')
  expect(helper).toContain('const block = transcriptRecord(item)')
  expect(helper).toContain("block?.type !== 'text'")
  expect(helper).not.toContain('as any')
  expect(helper).not.toContain('(c as any)')
  expect(helper).not.toContain('item as TextContentBlock')
})
