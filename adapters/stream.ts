import { Readable } from 'stream'
import type { ReadableStream as NodeReadableStream } from 'stream/web'

export function responseBodyStream(response: Response): NodeJS.ReadableStream {
  if (!response.body) throw new Error('Response body is empty')
  return Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
}
