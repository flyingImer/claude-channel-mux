import { createWriteStream } from 'fs'
import { homedir } from 'os'
import { basename } from 'path'
import { pipeline } from 'stream/promises'
import type { ArchiveRoomRequest, ArchiveRoomResult, ButtonItem, ChannelAdapter, CreateRoomWithBotInvitedRequest, CreateRoomWithBotInvitedResult, InboundMessage, InteractionCallback, PickerItem, SearchContext, SendOptions } from './types.js'
import { renderForTelegram, splitForLimit } from './markdown.js'
import { responseBodyStream } from './stream.js'
import { errorMessage, redactSensitiveText } from '../redact.js'

// Telegram Bot API caps messages at 4096 chars. Leave headroom for MV2
// escape expansion (each `_*[]()~>#+-=|{}.!` gets a backslash added).
const MESSAGE_LIMIT = 3800
const SEARCH_CONTEXT_TTL_MS = 10 * 60 * 1000
const REACTION_CACHE_TTL_MS = 60 * 60 * 1000
const CALLBACK_DATA_LIMIT = 64
const CALLBACK_DATA_TTL_MS = 10 * 60 * 1000

type TelegramInlineButton = { text: string; callback_data: string }
type TelegramInlineKeyboard = TelegramInlineButton[][]

function telegramInlineKeyboard(value: unknown): TelegramInlineKeyboard | undefined {
  return Array.isArray(value) ? value as TelegramInlineKeyboard : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function telegramApiResult<T = unknown>(method: string, value: unknown): T {
  const envelope = recordValue(value)
  if (!envelope) throw new Error(`Telegram ${method}: invalid response`)
  if (envelope.ok !== true) {
    const description = redactSensitiveText(typeof envelope.description === 'string' ? envelope.description : 'request failed')
    const errorCode = typeof envelope.error_code === 'number' && Number.isSafeInteger(envelope.error_code) ? ` error_code=${envelope.error_code}` : ''
    const parameters = recordValue(envelope.parameters)
    const retryAfter = typeof parameters?.retry_after === 'number' && Number.isFinite(parameters.retry_after) ? ` retry_after=${parameters.retry_after}` : ''
    const migrateToChatId = typeof parameters?.migrate_to_chat_id === 'number' && Number.isSafeInteger(parameters.migrate_to_chat_id) ? ` migrate_to_chat_id=${parameters.migrate_to_chat_id}` : ''
    throw new Error(`Telegram ${method}: ${description}${errorCode}${retryAfter}${migrateToChatId}`)
  }
  return envelope.result as T
}

export async function telegramApiResultFromResponse<T = unknown>(method: string, response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? 'unknown content-type'
  const raw = await response.text()
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    const preview = redactSensitiveText(raw).replace(/\s+/g, ' ').trim().slice(0, 200)
    throw new Error(`Telegram ${method}: invalid JSON response (HTTP ${response.status}, ${contentType}${preview ? `, body: ${preview}` : ''})`)
  }
  return telegramApiResult<T>(method, value)
}

type TelegramMessageResult = { message_id?: number | string }
type TelegramFileResult = { file_path?: string }
type TelegramUser = { id?: number | string; username?: string; first_name?: string }
type TelegramChat = { id?: number | string }
type TelegramDocument = { file_id?: string; file_name?: string; mime_type?: string; file_size?: number | string }
type TelegramPhoto = { file_id?: string }
type TelegramQuotedMessage = { message_id?: number | string; text?: string }
type TelegramMessage = {
  message_id?: number | string
  date?: number | string
  text?: string
  caption?: string
  chat?: TelegramChat
  from?: TelegramUser
  document?: TelegramDocument
  photo?: TelegramPhoto[]
  reply_to_message?: TelegramQuotedMessage
}
type TelegramCallbackQuery = { id?: string; data?: string; message?: { message_id?: number | string; chat?: TelegramChat } }
type TelegramUpdate = { update_id?: number; callback_query?: TelegramCallbackQuery; message?: TelegramMessage }

function telegramMessageResult(value: unknown): TelegramMessageResult {
  return recordValue(value) ?? {}
}

function telegramUpdates(value: unknown): TelegramUpdate[] {
  return Array.isArray(value) ? value.filter((item): item is TelegramUpdate => typeof item === 'object' && item !== null) : []
}

function telegramString(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function telegramChatId(chat: TelegramChat | undefined): string {
  return telegramString(chat?.id) ?? ''
}

function telegramStringId(value: unknown): string | undefined {
  const id = telegramString(value)
  return id ? id : undefined
}

function telegramMessageIdNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function telegramErrorMessage(err: unknown): string {
  return errorMessage(err)
}

function isTelegramMarkdownError(err: unknown): boolean {
  return /can't parse entities|parse entities/i.test(telegramErrorMessage(err))
}

function truncateTelegramText(text: string): string {
  return text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT - 3) + '...' : text
}

function plainFallbackChunk(chunks: string[], index: number, original: string): string {
  return truncateTelegramText(chunks[index] ?? original)
}

function telegramTimestampIso(value: number | string | undefined): string {
  const timestamp = Number(value ?? 0)
  return new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : 0).toISOString()
}

function telegramText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function telegramPhotos(value: unknown): TelegramPhoto[] {
  return Array.isArray(value) ? value.filter((item): item is TelegramPhoto => typeof item === 'object' && item !== null) : []
}

function telegramDocument(value: unknown): TelegramDocument | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as TelegramDocument : undefined
}

function telegramAttachmentSize(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function safeDownloadName(value: string): string {
  return value.replace(/[<>[\]{}|\\^`/\x00-\x1f]/g, '_') || 'file'
}

export async function telegramDownloadHttpError(fileId: string, resp: Response): Promise<Error> {
  const contentType = resp.headers.get('content-type') ?? 'unknown content-type'
  const raw = await resp.text().catch(() => '')
  const preview = redactSensitiveText(raw).replace(/\s+/g, ' ').trim().slice(0, 200)
  return new Error(`Telegram download ${fileId}: HTTP ${resp.status}, ${contentType}${preview ? `, body: ${preview}` : ''}`)
}

function searchContextKey(channelId: string, messageId: string | undefined): string | undefined {
  return channelId && messageId ? `${channelId}:${messageId}` : undefined
}

export function telegramCallbackInteraction(cb: TelegramCallbackQuery): InteractionCallback | undefined {
  const channelId = telegramChatId(cb.message?.chat)
  if (!cb.id || !cb.data || !channelId) return undefined
  return {
    channelId,
    data: cb.data,
    ackId: cb.id,
    messageId: telegramStringId(cb.message?.message_id),
  }
}

export function telegramInboundMessage(msg: TelegramMessage, botId = '', selfTestPrefix = ''): InboundMessage | undefined {
  const rawText = telegramText(msg.text) || telegramText(msg.caption)
  const document = telegramDocument(msg.document)
  const photos = telegramPhotos(msg.photo)
  if (!rawText && !document && photos.length === 0) return undefined
  const channelId = telegramChatId(msg.chat)
  const userId = telegramStringId(msg.from?.id)
  const messageId = telegramStringId(msg.message_id)
  if (!channelId || !userId || !messageId) return undefined
  const inboundText = normalizeTelegramInboundText(rawText, userId, botId, selfTestPrefix)
  if (inboundText == null) return undefined
  const meta: Record<string, string> = { ts: telegramTimestampIso(msg.date) }
  if (document) {
    const fileId = telegramText(document.file_id)
    if (fileId) meta.attachment_file_id = fileId
    meta.attachment_name = telegramText(document.file_name)
    const mimeType = telegramText(document.mime_type)
    if (mimeType) meta.attachment_mime = mimeType
    const fileSize = telegramAttachmentSize(document.file_size)
    if (fileSize) meta.attachment_size = fileSize
  }
  if (photos.length > 0) {
    const largest = photos[photos.length - 1]
    if (largest?.file_id) meta.attachment_file_id = largest.file_id
    meta.attachment_mime = 'image/jpeg'
    meta.attachment_name = 'photo.jpg'
  }
  return {
    channelId,
    userId,
    userName: telegramText(msg.from?.username) || telegramText(msg.from?.first_name) || userId,
    text: inboundText,
    messageId,
    replyToId: msg.reply_to_message ? telegramStringId(msg.reply_to_message.message_id) : undefined,
    meta,
  }
}

function telegramFileResult(value: unknown): TelegramFileResult {
  return recordValue(value) ?? {}
}

export function normalizeCommandAliases(text: string): string {
  return text.replace(/^\/(ccm|cc|cx)_([A-Za-z0-9_-]+)(?:@[A-Za-z0-9_]+)?(?=\s|$)/, '/$1 $2')
}

export function normalizeTelegramInboundText(
  rawText: string,
  fromUserId: string,
  botId = '',
  selfTestPrefix = '',
): string | undefined {
  const isSelf = !!botId && fromUserId === botId
  if (!isSelf) return normalizeCommandAliases(rawText)
  if (!selfTestPrefix || !rawText.startsWith(selfTestPrefix)) return undefined
  return normalizeCommandAliases(rawText.slice(selfTestPrefix.length).trimStart())
}

const TELEGRAM_REACTION_ALLOWLIST = new Set([
  '👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡', '🥱', '🥴', '😍', '🐳', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿', '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷', '🤷‍♀', '😡',
])

const TELEGRAM_REACTION_FALLBACKS: Record<string, string> = {
  '✅': '👍',
  '❌': '👎',
  '🚫': '👎',
  '⏳': '👀',
  '🔄': '👀',
}

export function normalizeTelegramReaction(emoji: string): string | undefined {
  if (TELEGRAM_REACTION_ALLOWLIST.has(emoji)) return emoji
  const fallback = TELEGRAM_REACTION_FALLBACKS[emoji]
  if (fallback && TELEGRAM_REACTION_ALLOWLIST.has(fallback)) return fallback
  return undefined
}

export class TelegramAdapter implements ChannelAdapter {
  readonly platform = 'telegram'
  readonly configured: boolean
  readonly buttonTextLimit = 30  // visual display width on phone
  readonly pageSize = 20

  private token: string
  private inboxDir: string
  private offset = 0
  private polling = false
  private botId = ''
  private apiOverride: ((method: string, body?: Record<string, unknown>) => Promise<unknown>) | null = null
  private messageCb: ((msg: InboundMessage) => void | Promise<void>) | null = null
  private interactionCb: ((i: InteractionCallback) => void | Promise<void>) | null = null
  private searchCb: ((channelId: string, query: string, context?: SearchContext) => void) | null = null
  private pendingSearchContexts = new Map<string, { context: SearchContext; createdAt: number }>()
  private callbackDataMap = new Map<string, { data: string; createdAt: number }>()
  private callbackDataSeq = 0
  // Telegram's setMessageReaction is REPLACE-ALL — to implement add-semantics
  // we track reactions we've set per message and resend the union. Key is
  // `${chat_id}:${message_id}`. Bot API caps at 3 reactions; oldest drops.
  private reactionCache = new Map<string, { emojis: string[]; updatedAt: number }>()
  private static SEARCH_PROMPT = '🔍 Search:'

  constructor(opts: { token?: string; inboxDir: string }) {
    this.token = opts.token ?? ''
    this.inboxDir = opts.inboxDir
    this.configured = !!this.token
  }

  injectApiForTest(api: (method: string, body?: Record<string, unknown>) => Promise<unknown>): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('injectApiForTest is test-only')
    this.apiOverride = api
  }

  private async api<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
    if (this.apiOverride) return this.apiOverride(method, body) as Promise<T>
    const res = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {},
    )
    return telegramApiResultFromResponse<T>(method, res)
  }

  private async multipartApi<T = unknown>(method: string, form: FormData): Promise<T> {
    if (this.apiOverride) return this.apiOverride(method, Object.fromEntries(form.entries())) as Promise<T>
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      body: form,
    })
    return telegramApiResultFromResponse<T>(method, res)
  }

  async start(): Promise<void> {
    if (!this.configured) return

    try {
      const me = await this.api<{ id?: number | string; username?: string }>('getMe')
      this.botId = telegramStringId(me.id) ?? ''
      process.stderr.write(`telegram: bot @${telegramText(me.username) || 'unknown'}\n`)
    } catch (err) {
      process.stderr.write(`telegram: getMe failed: ${errorMessage(err)}\n`)
    }

    // Register bot commands for autocomplete
    try {
      await this.api('setMyCommands', {
        commands: [
          { command: 'ccm', description: 'Bind room directory' },
          { command: 'ccm_new', description: 'Start a fresh agent session' },
          { command: 'ccm_agents', description: 'Show room agent slots' },
          { command: 'ccm_route', description: 'Explain default routing' },
          { command: 'ccm_resume', description: 'Browse & resume agent sessions' },
          { command: 'ccm_stop', description: 'Disconnect / stop agent slot' },
          { command: 'ccm_help', description: 'Room status & commands' },
          { command: 'ccm_find', description: 'Search directories' },
          { command: 'cc_help', description: 'Claude: commands' },
          { command: 'cc_ss', description: 'Claude: snapshot' },
          { command: 'cc_nav', description: 'Claude: pending TUI prompts' },
          { command: 'cc_transcript', description: 'Claude: transcript' },
          { command: 'cc_status', description: 'Claude: room status' },
          { command: 'cc_model', description: 'Claude: native model command' },
          { command: 'cc_compact', description: 'Claude: native compact command' },
          { command: 'cc_cancel', description: 'Claude: interrupt turn' },
          { command: 'cc_stop', description: 'Claude: interrupt turn' },
          { command: 'cx_help', description: 'Codex: commands' },
          { command: 'cx_ss', description: 'Codex: snapshot + pending buttons' },
          { command: 'cx_nav', description: 'Codex: pending N action/answer' },
          { command: 'cx_transcript', description: 'Codex: transcript' },
          { command: 'cx_status', description: 'Codex: status' },
          { command: 'cx_model', description: 'Codex: room model' },
          { command: 'cx_goal', description: 'Codex: replace goal' },
          { command: 'cx_mcp', description: 'Codex: MCP servers' },
          { command: 'cx_compact', description: 'Codex: compact context' },
          { command: 'cx_stop', description: 'Codex: interrupt turn' },
          { command: 'cx_cancel', description: 'Codex: interrupt turn' },
        ],
      })
      process.stderr.write('telegram: bot commands registered\n')
    } catch (err) {
      process.stderr.write(`telegram: bot commands registration failed: ${errorMessage(err)}\n`)
    }

    this.polling = true
    this.poll()
    process.stderr.write('telegram: polling started\n')
  }

  async stop(): Promise<void> {
    this.polling = false
  }

  private dispatchMessage(msg: InboundMessage): void {
    void Promise.resolve(this.messageCb?.(msg)).catch(err => {
      process.stderr.write(`telegram: message handler failed: ${errorMessage(err)}\n`)
    })
  }

  private dispatchInteraction(interaction: InteractionCallback): void {
    void Promise.resolve(this.interactionCb?.(interaction)).catch(err => {
      process.stderr.write(`telegram: interaction handler failed: ${errorMessage(err)}\n`)
    })
  }

  private dispatchSearch(channelId: string, query: string, context?: SearchContext): void {
    void Promise.resolve(this.searchCb?.(channelId, query, context)).catch(err => {
      process.stderr.write(`telegram: search handler failed: ${errorMessage(err)}\n`)
    })
  }

  private prunePendingSearchContexts(now = Date.now()): void {
    for (const [key, pending] of this.pendingSearchContexts) {
      if (now - pending.createdAt > SEARCH_CONTEXT_TTL_MS) this.pendingSearchContexts.delete(key)
    }
  }

  private pruneReactionCache(now = Date.now()): void {
    for (const [key, cached] of this.reactionCache) {
      if (now - cached.updatedAt > REACTION_CACHE_TTL_MS) this.reactionCache.delete(key)
    }
  }

  private pruneCallbackDataMap(now = Date.now()): void {
    for (const [key, pending] of this.callbackDataMap) {
      if (now - pending.createdAt > CALLBACK_DATA_TTL_MS) this.callbackDataMap.delete(key)
    }
  }

  private compactCallbackData(data: string): string {
    if (Buffer.byteLength(data, 'utf8') <= CALLBACK_DATA_LIMIT) return data
    this.pruneCallbackDataMap()
    const token = `tgcb:${(++this.callbackDataSeq).toString(36)}`
    this.callbackDataMap.set(token, { data, createdAt: Date.now() })
    return token
  }

  private resolveCallbackData(data: string): string | undefined {
    const pending = this.callbackDataMap.get(data)
    if (!pending) return data.startsWith('tgcb:') ? undefined : data
    this.callbackDataMap.delete(data)
    return pending.data
  }

  private async poll(): Promise<void> {
    while (this.polling) {
      try {
        const updates = telegramUpdates(await this.api<unknown>('getUpdates', { offset: this.offset, timeout: 30 }))
        for (const u of updates) {
          if (typeof u.update_id !== 'number') continue
          this.offset = u.update_id + 1

          // Callback query (inline keyboard)
          if (u.callback_query) {
            const cb = u.callback_query
            const interaction = telegramCallbackInteraction(cb)
            if (interaction) {
              const data = this.resolveCallbackData(interaction.data)
              if (data) {
                this.dispatchInteraction({ ...interaction, data })
              } else if (cb.id) {
                await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: 'This button expired. Please rerun the command to refresh it.', show_alert: true }).catch(err => {
                  process.stderr.write(`telegram: answerCallbackQuery expired alert failed: ${telegramErrorMessage(err)}\n`)
                })
                continue
              }
            }
            if (cb.id) await this.api('answerCallbackQuery', { callback_query_id: cb.id }).catch(err => {
              process.stderr.write(`telegram: answerCallbackQuery ack failed: ${telegramErrorMessage(err)}\n`)
            })
            continue
          }

          // Message
          const msg = u.message
          if (!msg) continue

          // Check if this is a reply to a search prompt → search callback
          if (this.handleSearchReply(msg)) continue

          const inbound = telegramInboundMessage(msg, this.botId, process.env.CHANNEL_DAEMON_SELF_TEST_PREFIX ?? '')
          if (inbound) this.dispatchMessage(inbound)
        }
      } catch (err) {
        if (this.polling) {
          process.stderr.write(`telegram: poll error: ${errorMessage(err)}\n`)
          await new Promise(r => setTimeout(r, 5000))
        }
      }
    }
  }

  handleSearchReply(msg: TelegramMessage): boolean {
    if (!msg.reply_to_message?.text?.startsWith(TelegramAdapter.SEARCH_PROMPT) || !this.searchCb) return false
    const channelId = telegramChatId(msg.chat)
    const query = typeof msg.text === 'string' ? msg.text.trim() : ''
    if (!channelId || !query) return false
    this.prunePendingSearchContexts()
    const key = searchContextKey(channelId, telegramStringId(msg.reply_to_message?.message_id))
    const pending = key ? this.pendingSearchContexts.get(key) : undefined
    if (key) this.pendingSearchContexts.delete(key)
    this.dispatchSearch(channelId, query, pending?.context)
    return true
  }

  async sendMessage(channelId: string, text: string, opts?: SendOptions): Promise<string | undefined> {
    // Convert CC's GFM markdown to Telegram MarkdownV2 (handles the ugly
    // `_*[]()~>#+-=|{}.!` escape rules). Auto-fence ASCII art before
    // conversion so the remark AST doesn't mangle it as a table.
    const rendered = renderForTelegram(text)
    // Chunk at ~3800 chars so a single long CC reply becomes multiple
    // Telegram messages instead of being truncated. Only the first chunk
    // carries reply_to (threading anchor); only the last carries the
    // inline keyboard so buttons attach to the final visible message.
    const chunks = splitForLimit(rendered, MESSAGE_LIMIT)
    const plainChunks = splitForLimit(text, MESSAGE_LIMIT)
    const hasKeyboard = !!telegramInlineKeyboard(opts?.inlineKeyboard)
    let firstId: string | undefined
    let lastId: string | undefined
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0
      const isLast = i === chunks.length - 1
      const body: Record<string, unknown> = {
        chat_id: channelId,
        text: chunks[i],
        parse_mode: 'MarkdownV2',
      }
      const replyToMessageId = telegramMessageIdNumber(opts?.replyTo)
      if (isFirst && replyToMessageId) body.reply_to_message_id = replyToMessageId
      const keyboard = telegramInlineKeyboard(opts?.inlineKeyboard)
      if (isLast && keyboard) body.reply_markup = { inline_keyboard: keyboard }
      let r: TelegramMessageResult
      try {
        r = await this.api<TelegramMessageResult>('sendMessage', body)
      } catch (err) {
        if (!isTelegramMarkdownError(err)) throw err
        const fallbackBody: Record<string, unknown> = { ...body, text: plainFallbackChunk(plainChunks, i, text) }
        delete fallbackBody.parse_mode
        process.stderr.write(`telegram: MarkdownV2 send failed, retrying plain text: ${telegramErrorMessage(err)}\n`)
        r = await this.api<TelegramMessageResult>('sendMessage', fallbackBody)
      }
      const preview = redactSensitiveText(text).replace(/\s+/g, ' ').slice(0, 160)
      const messageId = r.message_id == null ? undefined : String(r.message_id)
      process.stderr.write(`telegram: sent ${channelId}/${messageId ?? 'unknown'} ${preview}\n`)
      if (isFirst) firstId = messageId
      if (isLast) lastId = messageId
    }
    return hasKeyboard ? lastId ?? firstId : firstId
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Telegram supports a fixed reaction set. Normalize common CCM status
    // emojis to supported reactions and no-op unsupported ones so lightweight
    // acks never fail the underlying user task.
    const normalized = normalizeTelegramReaction(emoji)
    if (!normalized) {
      process.stderr.write(`telegram: addReaction(${emoji}) on ${channelId}/${messageId} skipped: unsupported reaction\n`)
      return
    }
    // Telegram setMessageReaction REPLACES the whole reaction set. To give
    // callers add-semantics, track what we've added per message and resend
    // the union. Cap at 3 (Bot API max for non-premium bots); oldest drops.
    this.pruneReactionCache()
    const key = `${channelId}:${messageId}`
    const current = this.reactionCache.get(key)?.emojis ?? []
    if (current.includes(normalized)) return  // already there
    const next = [...current, normalized].slice(-3)
    try {
      const messageIdNumber = telegramMessageIdNumber(messageId)
      if (!messageIdNumber) {
        process.stderr.write(`telegram: addReaction(${emoji}→${normalized}) on ${channelId}/${messageId} skipped: malformed message id\n`)
        return
      }
      await this.api('setMessageReaction', {
        chat_id: channelId,
        message_id: messageIdNumber,
        reaction: next.map(e => ({ type: 'emoji', emoji: e })),
      })
      this.reactionCache.set(key, { emojis: next, updatedAt: Date.now() })
    } catch (err) {
      process.stderr.write(`telegram: addReaction(${emoji}→${normalized}) on ${channelId}/${messageId} failed: ${errorMessage(err)}\n`)
    }
  }

  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Drop `emoji` from our tracked set, resend the union. If `emoji` is
    // empty or we have no state, clear all (matches old behavior).
    this.pruneReactionCache()
    const key = `${channelId}:${messageId}`
    const current = this.reactionCache.get(key)?.emojis ?? []
    const normalized = emoji ? normalizeTelegramReaction(emoji) : undefined
    const next = normalized ? current.filter(e => e !== normalized) : []
    const messageIdNumber = telegramMessageIdNumber(messageId)
    if (!messageIdNumber) {
      process.stderr.write(`telegram: removeReaction(${emoji}) on ${channelId}/${messageId} skipped: malformed message id\n`)
      return
    }
    try {
      await this.api('setMessageReaction', {
        chat_id: channelId,
        message_id: messageIdNumber,
        reaction: next.map(e => ({ type: 'emoji', emoji: e })),
      })
      if (next.length === 0) this.reactionCache.delete(key)
      else this.reactionCache.set(key, { emojis: next, updatedAt: Date.now() })
    } catch (err) {
      process.stderr.write(`telegram: removeReaction(${emoji}) on ${channelId}/${messageId} failed: ${errorMessage(err)}\n`)
    }
  }

  async showTyping(channelId: string): Promise<void> {
    await this.api('sendChatAction', { chat_id: channelId, action: 'typing' }).catch(err => {
      process.stderr.write(`telegram: sendChatAction typing failed on ${channelId}: ${telegramErrorMessage(err)}\n`)
      throw err
    })
  }

  async editMessage(channelId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
    // editMessageText has the same 4096 char cap but can't be split (it
    // edits one message). If the rendered text exceeds the limit, truncate
    // so the edit actually goes through rather than Slack-style rejecting.
    // Telegram preserves the existing inline_keyboard unless we pass one.
    const rendered = renderForTelegram(text)
    const messageIdNumber = telegramMessageIdNumber(messageId)
    if (!messageIdNumber) {
      process.stderr.write(`telegram: editMessage on ${channelId}/${messageId} skipped: malformed message id\n`)
      return
    }
    const body: Record<string, unknown> = {
      chat_id: channelId,
      message_id: messageIdNumber,
      text: truncateTelegramText(rendered),
      parse_mode: 'MarkdownV2',
    }
    const keyboard = telegramInlineKeyboard(opts?.inlineKeyboard)
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard }
    try {
      await this.api('editMessageText', body)
    } catch (err) {
      if (!isTelegramMarkdownError(err)) throw err
      const fallbackBody: Record<string, unknown> = { ...body, text: truncateTelegramText(text) }
      delete fallbackBody.parse_mode
      process.stderr.write(`telegram: MarkdownV2 edit failed, retrying plain text: ${telegramErrorMessage(err)}\n`)
      await this.api('editMessageText', fallbackBody)
    }
  }

  async downloadFile(fileId: string): Promise<string> {
    const fi = await this.api<TelegramFileResult>('getFile', { file_id: fileId })
    if (!fi.file_path) throw new Error(`Telegram download ${fileId}: missing file path`)
    const id = safeDownloadName(fileId)
    const name = safeDownloadName(basename(fi.file_path))
    const dest = `${this.inboxDir}/${id}-${name}`
    const resp = await fetch(`https://api.telegram.org/file/bot${this.token}/${fi.file_path}`)
    if (!resp.ok) throw await telegramDownloadHttpError(fileId, resp)
    const ws = createWriteStream(dest)
    await pipeline(responseBodyStream(resp), ws)
    return dest
  }

  async uploadFile(channelId: string, filePath: string, filename: string): Promise<void> {
    const { readFileSync } = await import('fs')
    const data = readFileSync(filePath)
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)
    const field = isImage ? 'photo' : 'document'
    const form = new FormData()
    form.append('chat_id', channelId)
    form.append(field, new Blob([data]), filename)
    await this.multipartApi(isImage ? 'sendPhoto' : 'sendDocument', form)
  }

  onMessage(cb: (msg: InboundMessage) => void | Promise<void>): void {
    this.messageCb = cb
  }

  formatButtonText(text: string): string {
    const home = homedir()
    let t = text.replace(home, '~')
    if (t.length <= this.buttonTextLimit) return t

    // Find path and suffix (e.g. " (3)")
    const pathMatch = t.match(/^(.*?)(\/[^\s]+|~)(\s.*)?$/)
    if (pathMatch) {
      const prefix = pathMatch[1]
      const path = pathMatch[2]
      const suffix = pathMatch[3] ?? ''
      const parts = path.split('/')

      if (parts.length > 2) {
        const last = parts[parts.length - 1]
        const shortened = parts.slice(0, -1).map(s => s[0] ?? s).join('/') + '/' + last
        t = prefix + shortened + suffix
      }

      // Still too long? Truncate the last dir name, preserving suffix
      if (t.length > this.buttonTextLimit && suffix) {
        const budget = this.buttonTextLimit - prefix.length - suffix.length - 4 // "…/" overhead
        if (budget > 5) {
          const parts2 = (t.replace(suffix, '')).replace(prefix, '').split('/')
          const lastDir = parts2[parts2.length - 1]
          if (lastDir.length > budget) {
            const half = Math.floor((budget - 1) / 2)
            parts2[parts2.length - 1] = lastDir.slice(0, half) + '…' + lastDir.slice(-(budget - half - 1))
            t = prefix + parts2.join('/') + suffix
          }
        }
      }
    }

    if (t.length <= this.buttonTextLimit) return t
    return t.slice(0, this.buttonTextLimit - 1) + '…'
  }

  async promptSearch(channelId: string, prompt: string, context?: SearchContext): Promise<void> {
    const result = await this.api<TelegramMessageResult>('sendMessage', {
      chat_id: channelId,
      text: `${TelegramAdapter.SEARCH_PROMPT} ${prompt}`,
      reply_markup: { force_reply: true, input_field_placeholder: 'e.g. proj' },
    })
    const key = searchContextKey(channelId, telegramStringId(telegramMessageResult(result).message_id))
    if (context && key) {
      this.prunePendingSearchContexts()
      this.pendingSearchContexts.set(key, { context, createdAt: Date.now() })
    }
  }

  onSearch(cb: (channelId: string, query: string, context?: SearchContext) => void): void {
    this.searchCb = cb
  }

  onInteraction(cb: (i: InteractionCallback) => void | Promise<void>): void {
    this.interactionCb = cb
  }

  private btn(text: string, data: string): TelegramInlineButton {
    return { text: this.formatButtonText(text), callback_data: this.compactCallbackData(data) }
  }

  renderListPicker(items: PickerItem[], page: number, totalPages: number, callbackPrefix: string): SendOptions {
    const kb = items.map(item => [this.btn(item.label, `${callbackPrefix}${item.value}`)])
    if (totalPages > 1) {
      const nav: TelegramInlineButton[] = []
      if (page > 0) nav.push({ text: '⬅️', callback_data: `ccp:${page - 1}` })
      nav.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' })
      if (page < totalPages - 1) nav.push({ text: '➡️', callback_data: `ccp:${page + 1}` })
      kb.push(nav)
    }
    return { inlineKeyboard: kb }
  }

  renderGrid(opts: {
    topButtons?: ButtonItem[]
    gridItems?: ButtonItem[]
    filterButtons?: ButtonItem[]
    bottomButtons?: ButtonItem[]
  }): SendOptions {
    const kb: TelegramInlineKeyboard = []
    if (opts.topButtons?.length) {
      kb.push(opts.topButtons.map(b => (this.btn(b.text, b.data))))
    }
    if (opts.filterButtons?.length) {
      kb.push(opts.filterButtons.map(b => (this.btn(b.text, b.data))))
    }
    if (opts.gridItems?.length) {
      for (let i = 0; i < opts.gridItems.length; i += 2) {
        const row: TelegramInlineButton[] = [this.btn(opts.gridItems[i].text, opts.gridItems[i].data)]
        if (opts.gridItems[i + 1]) row.push(this.btn(opts.gridItems[i + 1].text, opts.gridItems[i + 1].data))
        kb.push(row)
      }
    }
    if (opts.bottomButtons?.length) {
      kb.push(opts.bottomButtons.map(b => (this.btn(b.text, b.data))))
    }
    return { inlineKeyboard: kb }
  }

  renderButtons(buttons: ButtonItem[]): SendOptions {
    const kb: TelegramInlineKeyboard = []
    for (let i = 0; i < buttons.length; i += 2) {
      kb.push(buttons.slice(i, i + 2).map(b => this.btn(b.text, b.data)))
    }
    return { inlineKeyboard: kb }
  }

  async createRoomWithBotInvited(_request: CreateRoomWithBotInvitedRequest): Promise<CreateRoomWithBotInvitedResult> {
    return { ok: false, code: 'unsupported_capability', platform: this.platform, operation: 'create_room_with_bot_invited' }
  }

  async archiveRoom(_request: ArchiveRoomRequest): Promise<ArchiveRoomResult> {
    return { ok: false, code: 'unsupported_capability', platform: this.platform, operation: 'archive_room' }
  }
}
