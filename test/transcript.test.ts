import { test, expect } from 'bun:test'
import { channelMessageIdFromContent, extractTextFromContent, nestedRecord, textBlocksFromContent, transcriptRecordFromLine, transcriptString, transcriptTextBlocks } from '../transcript.ts'

test('transcriptRecordFromLine parses only object JSONL records', () => {
  expect(transcriptRecordFromLine('{"type":"user"}')).toEqual({ type: 'user' })
  expect(transcriptRecordFromLine('[]')).toBeUndefined()
  expect(transcriptRecordFromLine('not json')).toBeUndefined()
})

test('transcript content helpers extract text conservatively', () => {
  expect(extractTextFromContent('hello')).toBe('hello')
  expect(extractTextFromContent([{ text: 'a' }, { input_text: 'b' }, { output_text: 'c' }, { nope: 'd' }])).toBe('a\nb\nc')
  expect(textBlocksFromContent([{ type: 'text', text: 'first' }, { type: 'tool_use', text: 'skip' }, 'raw'])).toBe('first')
})

test('channelMessageIdFromContent finds channel tags in strings and text blocks', () => {
  expect(channelMessageIdFromContent('<channel message_id="m1">x</channel>')).toBe('m1')
  expect(channelMessageIdFromContent([{ type: 'text', text: 'before <channel message_id="m2">x</channel>' }])).toBe('m2')
  expect(channelMessageIdFromContent([{ type: 'tool', text: '<channel message_id="skip">x</channel>' }])).toBeUndefined()
})

test('nestedRecord and transcriptString fail closed', () => {
  expect(nestedRecord({ payload: { cwd: '/repo' } }, 'payload')).toEqual({ cwd: '/repo' })
  expect(nestedRecord({ payload: [] }, 'payload')).toBeUndefined()
  expect(transcriptString('ok')).toBe('ok')
  expect(transcriptString(1)).toBe('')
})


test('transcriptTextBlocks returns trimmed text blocks with original indexes', () => {
  expect(transcriptTextBlocks([{ type: 'text', text: ' first ' }, { type: 'tool_use', text: 'skip' }, { type: 'text', text: '' }, { type: 'text', text: 'second' }])).toEqual([
    { index: 0, text: 'first' },
    { index: 3, text: 'second' },
  ])
  expect(transcriptTextBlocks('nope')).toEqual([])
})
