import { test, expect } from 'bun:test'
import { responseBodyStream } from '../adapters/stream.ts'

test('responseBodyStream converts fetch response bodies to node streams', async () => {
  const stream = responseBodyStream(new Response('hello'))
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString('utf8')).toBe('hello')
})

test('responseBodyStream fails clearly for empty response bodies', () => {
  expect(() => responseBodyStream(new Response(null))).toThrow('Response body is empty')
})
