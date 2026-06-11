import { WebClient } from '@slack/web-api'
import { SocketModeClient } from '@slack/socket-mode'
import type { KnownBlock } from '@slack/types'
import { createHash } from 'crypto'
import { createWriteStream, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename } from 'path'
import { pipeline } from 'stream/promises'
import type { ArchiveRoomRequest, ArchiveRoomResult, ButtonItem, ChannelAdapter, CreateRoomWithBotInvitedRequest, CreateRoomWithBotInvitedResult, InboundMessage, InteractionCallback, PickerItem, RoomCreateInviteFact, SearchContext, SendOptions } from './types.js'
import { renderForSlack, splitForLimit } from './markdown.js'
import { responseBodyStream } from './stream.js'
import { errorMessage, redactSensitiveText } from '../redact.js'

// Slack section block text hard limit per the API. Each section holds up
// to 3000 chars; a single chat.postMessage can carry up to 50 blocks.
const SECTION_LIMIT = 2900
const BLOCK_LIMIT = 50
const SEARCH_CONTEXT_TTL_MS = 10 * 60 * 1000
const CALLBACK_VALUE_LIMIT = 1900
const CALLBACK_VALUE_TTL_MS = 10 * 60 * 1000

type SlackButtonElement = { type: 'button'; text: { type: 'plain_text'; text: string }; action_id: string; value: string }
type SlackBlock = KnownBlock

function slackInlineKeyboard(value: unknown): SlackBlock[] {
  return Array.isArray(value) ? value.filter((block): block is SlackBlock => typeof block === 'object' && block !== null) : []
}

function slackActionId(data: string): string {
  if (data.length <= 64) return data
  return `ccm:${createHash('sha256').update(data).digest('base64url').slice(0, 16)}`
}

function slackMessageBlocks(rendered: string, inlineKeyboard: unknown): SlackBlock[] {
  const keyboard = slackInlineKeyboard(inlineKeyboard).slice(0, BLOCK_LIMIT - 1)
  const sectionBudget = Math.max(1, BLOCK_LIMIT - keyboard.length)
  const sections = splitForLimit(rendered, SECTION_LIMIT).slice(0, sectionBudget)
  const textBlocks: SlackBlock[] = sections.map(text => ({
    type: 'section',
    text: { type: 'mrkdwn', text },
  }))
  return [...textBlocks, ...keyboard]
}

type SlackApiError = { data?: { error?: unknown }; code?: unknown }
type SlackAck = () => void | Promise<void>
type SlackInteractiveEnvelope = { body?: unknown; ack?: SlackAck }
type SlackSlashEnvelope = { body?: unknown; ack?: SlackAck }

async function slackAck(ack: SlackAck | undefined, label: string): Promise<void> {
  try {
    await ack?.()
  } catch (err) {
    process.stderr.write(`slack: ${label} ack failed: ${errorMessage(err)}\n`)
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function slackApiErrorMessage(err: unknown): string {
  const data = recordValue((err as SlackApiError | undefined)?.data)
  return stringValue(data?.error) || errorMessage(err)
}

function slackChannelFacts(value: unknown): { id?: string; name?: string; archived?: boolean } {
  const channel = recordValue(value)
  if (!channel) return {}
  return {
    id: fallbackStringValue(channel.id),
    name: fallbackStringValue(channel.name),
    archived: typeof channel.is_archived === 'boolean' ? channel.is_archived : undefined,
  }
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function fallbackStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function safeDownloadName(value: string): string {
  return value.replace(/[<>[\]{}|\\^`/\x00-\x1f]/g, '_') || 'file'
}

export async function slackDownloadHttpError(fileId: string, resp: Response): Promise<Error> {
  const contentType = resp.headers.get('content-type') ?? 'unknown content-type'
  const raw = await resp.text().catch(() => '')
  const preview = redactSensitiveText(raw).replace(/\s+/g, ' ').trim().slice(0, 200)
  return new Error(`Slack download ${fileId}: HTTP ${resp.status}, ${contentType}${preview ? `, body: ${preview}` : ''}`)
}

function slackPostTs(value: unknown): string | undefined {
  return optionalStringValue(recordValue(value)?.ts)
}

function slackTimestampIso(value: unknown): string {
  const text = fallbackStringValue(value)
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return new Date(0).toISOString()
  const timestamp = Number(text)
  return new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : 0).toISOString()
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? recordValue(value[0]) : undefined
}

export function slackSearchRuntimeFromAction(data: string): SearchContext | undefined | null {
  if (data === 'cmd:search') return undefined
  const match = data.match(/^cmd:search:(claude|codex)$/)
  return match ? { runtime: match[1] as SearchContext['runtime'] } : null
}

export function isSlackSearchAction(data: string): boolean {
  return slackSearchRuntimeFromAction(data) !== null
}

export function slackModalViewId(body: unknown): string | undefined {
  const payload = recordValue(body)
  if (payload?.type !== 'view_submission') return undefined
  const viewId = stringValue(recordValue(payload.view)?.id)
  return viewId || undefined
}

export function slackModalSubmission(body: unknown): { viewId: string; query: string } | undefined {
  const payload = recordValue(body)
  const viewId = slackModalViewId(payload)
  if (!viewId) return undefined
  const view = recordValue(payload?.view)
  const state = recordValue(view?.state)
  const values = recordValue(state?.values)
  const searchBlock = recordValue(values?.search_block)
  const searchInput = recordValue(searchBlock?.search_input)
  const query = stringValue(searchInput?.value).trim()
  return query ? { viewId, query } : undefined
}

export function slackInteractionCallback(body: unknown): InteractionCallback | undefined {
  const payload = recordValue(body)
  const action = firstRecord(payload?.actions)
  if (!payload || !action) return undefined
  const data = stringValue(action.value) || stringValue(action.action_id)
  const channelId = stringValue(recordValue(payload.channel)?.id)
  if (!data || !channelId) return undefined
  return {
    channelId,
    data,
    messageId: stringValue(recordValue(payload.message)?.ts) || undefined,
  }
}

export function slackSlashInboundMessage(body: unknown): InboundMessage | undefined {
  const payload = recordValue(body)
  if (!payload) return undefined
  const command = stringValue(payload.command)
  const text = stringValue(payload.text)
  const channelId = stringValue(payload.channel_id)
  const userId = stringValue(payload.user_id)
  if (!command || !channelId || !userId) return undefined
  return {
    channelId,
    userId,
    userName: stringValue(payload.user_name) || userId,
    text: normalizeSlackSlashCommandText(command, text),
    messageId: '',
    meta: { ts: new Date().toISOString() },
  }
}

function slackErrorCode(err: unknown): string {
  const record = typeof err === 'object' && err !== null ? err as SlackApiError & { message?: unknown } : undefined
  const dataError = record?.data?.error
  if (typeof dataError === 'string') return dataError
  if (typeof record?.code === 'string') return record.code
  const message = typeof record?.message === 'string' ? record.message : undefined
  if (message) return redactSensitiveText(message).replace(/\s+/g, ' ').trim().slice(0, 160) || 'unknown'
  if (typeof err === 'string') return redactSensitiveText(err).replace(/\s+/g, ' ').trim().slice(0, 160) || 'unknown'
  return 'unknown'
}

function isSlackBlockPayloadError(err: unknown): boolean {
  return ['invalid_blocks', 'msg_blocks_too_long', 'invalid_arguments'].includes(slackErrorCode(err))
}


export type SlackInboundIdentityInput = {
  user?: string
  bot_id?: string
  username?: string
  bot_profile?: { name?: string }
}

export type SlackInboundEventInput = SlackInboundIdentityInput & {
  channel?: string
  ts?: string
  text?: string
  thread_ts?: string
}

export function slackInboundIdentity(
  event: SlackInboundIdentityInput,
  botUserId = '',
  botId = '',
): { userId: string; fallbackName?: string } {
  const userId = [event.user, event.bot_id, botUserId, botId]
    .flatMap(value => fallbackStringValue(value) ?? [])
    .at(0) ?? ''
  const fallbackName = fallbackStringValue(event.user)
    ? undefined
    : fallbackStringValue(event.username) ?? fallbackStringValue(event.bot_profile?.name) ?? userId
  return { userId, fallbackName }
}

export function slackInboundEventFields(event: SlackInboundEventInput): { channelId: string; messageId: string; text: string; timestampIso: string; replyToId?: string } | undefined {
  const channelId = stringValue(event.channel)
  const messageId = stringValue(event.ts)
  const timestamp = Number(messageId)
  if (!channelId || !messageId || !Number.isFinite(timestamp) || timestamp <= 0) return undefined
  return {
    channelId,
    messageId,
    text: stripSlackAppAttributionFooter(stringValue(event.text)),
    timestampIso: new Date(timestamp * 1000).toISOString(),
    replyToId: optionalStringValue(event.thread_ts),
  }
}

function stripSlackAppAttributionFooter(text: string): string {
  return text.replace(/(?:\s+|(?:\n\s*){1,2})[*_]?Sent using[*_]?(?:\s+<[^>]+>|\s+[^\n*_]+)[*_]?\s*$/i, '').trimEnd()
}

export function normalizeSlackSlashCommandText(command: string, text = ''): string {
  if (command === '/ccm') return `ccm ${text}`.trim()
  if (command === '/cc') return `/cc ${text}`.trim()
  if (command === '/cx') return `/cx ${text}`.trim()
  return text.trim()
}

export type SlackFileInfo = {
  id?: string
  name?: string
  mimetype?: string
  size?: number | string
}

function slackFileString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function slackFileSize(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function slackFileInfos(value: unknown): SlackFileInfo[] {
  return Array.isArray(value) ? value.filter((file): file is SlackFileInfo => typeof file === 'object' && file !== null) : []
}

export function slackFileMetadata(files: unknown): Record<string, string> {
  const safeFiles = slackFileInfos(files)
  if (safeFiles.length === 0) return {}
  const first = safeFiles[0]
  const meta: Record<string, string> = {}
  const firstId = slackFileString(first.id)
  const firstName = slackFileString(first.name)
  const firstMime = slackFileString(first.mimetype)
  const firstSize = slackFileSize(first.size)
  if (firstId) meta.attachment_file_id = firstId
  if (firstName) meta.attachment_name = firstName
  if (firstMime) meta.attachment_mime = firstMime
  if (firstSize != null) meta.attachment_size = String(firstSize)
  if (safeFiles.length > 1) {
    meta.attachment_files = JSON.stringify(safeFiles.map(f => ({
      file_id: slackFileString(f.id),
      name: slackFileString(f.name),
      mime: slackFileString(f.mimetype),
      size: slackFileSize(f.size),
    })))
  }
  return meta
}

export class SlackAdapter implements ChannelAdapter {
  readonly platform = 'slack'
  readonly configured: boolean
  readonly buttonTextLimit = 50  // Slack buttons have more display width
  readonly pageSize = 20

  private web: WebClient | null = null
  private socket: SocketModeClient | null = null
  private botUserId = ''
  private botId = ''
  private botToken: string
  private appToken: string
  private inboxDir: string
  private messageCb: ((msg: InboundMessage) => void | Promise<void>) | null = null
  private interactionCb: ((i: InteractionCallback) => void | Promise<void>) | null = null
  private searchCb: ((channelId: string, query: string, context?: SearchContext) => void) | null = null
  private pendingSearchChannels = new Map<string, { channelId: string; context?: SearchContext; createdAt: number }>()  // view_id → search context
  private nameCache = new Map<string, string>()
  private callbackValueMap = new Map<string, { data: string; createdAt: number }>()
  private callbackValueSeq = 0

  constructor(opts: { botToken?: string; appToken?: string; inboxDir: string }) {
    this.botToken = opts.botToken ?? ''
    this.appToken = opts.appToken ?? ''
    this.inboxDir = opts.inboxDir
    this.configured = !!(this.botToken && this.appToken)
  }

  private get webClient(): WebClient {
    if (!this.web) throw new Error('Slack adapter is not started')
    return this.web
  }

  injectWebClientForTest(web: WebClient): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('injectWebClientForTest is test-only')
    this.web = web
  }

  injectBotUserIdForTest(botUserId: string): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('injectBotUserIdForTest is test-only')
    this.botUserId = botUserId
  }

  private prunePendingSearchChannels(now = Date.now()): void {
    for (const [viewId, pending] of this.pendingSearchChannels) {
      if (now - pending.createdAt > SEARCH_CONTEXT_TTL_MS) this.pendingSearchChannels.delete(viewId)
    }
  }

  private pruneCallbackValueMap(now = Date.now()): void {
    for (const [key, pending] of this.callbackValueMap) {
      if (now - pending.createdAt > CALLBACK_VALUE_TTL_MS) this.callbackValueMap.delete(key)
    }
  }

  private compactCallbackValue(data: string): string {
    if (Buffer.byteLength(data, 'utf8') <= CALLBACK_VALUE_LIMIT) return data
    this.pruneCallbackValueMap()
    const token = `slcb:${(++this.callbackValueSeq).toString(36)}`
    this.callbackValueMap.set(token, { data, createdAt: Date.now() })
    return token
  }

  private resolveCallbackValue(data: string, opts: { consume?: boolean } = {}): string | undefined {
    const pending = this.callbackValueMap.get(data)
    if (!pending) return data.startsWith('slcb:') ? undefined : data
    if (opts.consume ?? true) this.callbackValueMap.delete(data)
    return pending.data
  }

  async start(): Promise<void> {
    if (!this.configured) return

    this.web = new WebClient(this.botToken)
    this.socket = new SocketModeClient({ appToken: this.appToken })

    try {
      const auth = await this.web.auth.test()
      this.botUserId = stringValue(recordValue(auth)?.user_id)
      this.botId = stringValue(recordValue(auth)?.bot_id)
      process.stderr.write(`slack: bot user ${this.botUserId} bot_id ${this.botId}\n`)
    } catch (err) {
      process.stderr.write(`slack: auth.test failed: ${errorMessage(err)}\n`)
    }

    this.socket.on('message', async ({ event, ack }) => {
      await slackAck(ack, 'message')
      if (event.user === this.botUserId || event.bot_id === this.botId) {
        const prefix = process.env.CHANNEL_DAEMON_SELF_TEST_PREFIX
        if (!prefix || !String(event.text ?? '').startsWith(prefix)) return
        event.text = String(event.text ?? '').slice(prefix.length).trimStart()
      }
      if (event.subtype && event.subtype !== 'file_share' && event.subtype !== 'bot_message') return

      const fields = slackInboundEventFields(event)
      if (!fields) return
      const identity = slackInboundIdentity(event, this.botUserId, this.botId)
      const userId = identity.userId
      if (!userId) return
      const userName = event.user
        ? await this.resolveUserName(userId)
        : identity.fallbackName ?? userId
      const meta: Record<string, string> = { ts: fields.timestampIso }
      // thread_ts present = message is in a thread. Pass as replyToId
      // so CC knows the context. CC will reply with reply_broadcast=true
      // so the response appears in both channel and thread.
      const replyToId = fields.replyToId

      Object.assign(meta, slackFileMetadata(event.files))

      this.dispatchMessage({
        channelId: fields.channelId,
        userId,
        userName,
        text: fields.text,
        messageId: fields.messageId,
        replyToId,
        meta,
      })
    })

    this.socket.on('interactive', async ({ body, ack }: SlackInteractiveEnvelope) => {
      await slackAck(ack, 'interactive')
      const payload = recordValue(body)
      if (!payload) return

      this.prunePendingSearchChannels()

      // Handle view_submission (modal submit — e.g. search)
      const modalViewId = slackModalViewId(payload)
      if (modalViewId) {
        const pending = this.pendingSearchChannels.get(modalViewId)
        const modal = slackModalSubmission(payload)
        this.pendingSearchChannels.delete(modalViewId)
        if (pending && modal) this.dispatchSearch(pending.channelId, modal.query, pending.context)
        return
      }
      if (payload.type === 'view_submission') return

      const action = firstRecord(payload.actions)
      if (!action) return

      // Intercept search button → open modal directly (no daemon round-trip)
      const rawActionData = stringValue(action.value) || stringValue(action.action_id)
      const actionData = this.resolveCallbackValue(rawActionData, { consume: false })
      if (!actionData) {
        const channelId = stringValue(recordValue(payload.channel)?.id)
        if (channelId) {
          void this.sendMessage(channelId, '⚠️ This button expired after a CCM restart or timeout. Please rerun the command to refresh it.').catch(err => {
            process.stderr.write(`slack: expired button warning send failed for ${channelId}: ${errorMessage(err)}\n`)
          })
        }
        return
      }
      const searchContext = slackSearchRuntimeFromAction(actionData)
      if (searchContext !== null) {
        const triggerId = stringValue(payload.trigger_id)
        const channelId = stringValue(recordValue(payload.channel)?.id)
        if (triggerId && channelId) {
          try {
            const res = await this.webClient.views.open({
              trigger_id: triggerId,
              view: {
                type: 'modal',
                title: { type: 'plain_text', text: 'Search directories' },
                submit: { type: 'plain_text', text: 'Search' },
                blocks: [{
                  type: 'input',
                  block_id: 'search_block',
                  label: { type: 'plain_text', text: 'Directory name' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'search_input',
                    placeholder: { type: 'plain_text', text: 'e.g. proj' },
                  },
                }],
              },
            })
            if (res.view?.id) {
              this.prunePendingSearchChannels()
              this.pendingSearchChannels.set(res.view.id, { channelId, context: searchContext ?? undefined, createdAt: Date.now() })
            }
          } catch (err) {
            process.stderr.write(`slack: search modal open failed: ${errorMessage(err)}\n`)
            await this.sendMessage(channelId, '❌ Failed to open directory search modal. Try `ccm find <query>` instead.').catch(sendErr => {
              process.stderr.write(`slack: search modal failure notice failed for ${channelId}: ${errorMessage(sendErr)}\n`)
            })
          }
        }
        return
      }

      const interaction = slackInteractionCallback(payload)
      if (interaction) {
        const data = this.resolveCallbackValue(interaction.data)
        if (data) this.dispatchInteraction({ ...interaction, data })
      }
    })

    // Handle Slack slash commands (/ccm, /cc, /cx)
    this.socket.on('slash_commands', async ({ body, ack }: SlackSlashEnvelope) => {
      await slackAck(ack, 'slash_commands')
      const payload = recordValue(body)
      if (!payload) return
      const msg = slackSlashInboundMessage(payload)
      if (msg) this.dispatchMessage(msg)
    })

    await this.socket.start()
    process.stderr.write('slack: Socket Mode connected\n')
  }

  async stop(): Promise<void> {
    try {
      await this.socket?.disconnect()
    } catch (err) {
      process.stderr.write(`slack: Socket Mode disconnect failed: ${errorMessage(err)}\n`)
    }
  }

  private dispatchMessage(msg: InboundMessage): void {
    void Promise.resolve(this.messageCb?.(msg)).catch(err => {
      process.stderr.write(`slack: message handler failed: ${errorMessage(err)}\n`)
    })
  }

  private dispatchInteraction(interaction: InteractionCallback): void {
    void Promise.resolve(this.interactionCb?.(interaction)).catch(err => {
      process.stderr.write(`slack: interaction handler failed: ${errorMessage(err)}\n`)
    })
  }

  private dispatchSearch(channelId: string, query: string, context?: SearchContext): void {
    void Promise.resolve(this.searchCb?.(channelId, query, context)).catch(err => {
      process.stderr.write(`slack: search handler failed: ${errorMessage(err)}\n`)
    })
  }

  async sendMessage(channelId: string, text: string, opts?: SendOptions): Promise<string | undefined> {
    // Convert CC's GFM markdown into Slack's mrkdwn (bold/italic/links/etc).
    // ASCII-art-ish lines get auto-fenced so remark doesn't mangle them.
    const rendered = renderForSlack(text)
    // Split long text into multiple section blocks rather than truncating.
    // Each section caps at 3000 chars; one message can carry up to 50
    // sections, plus whatever inline keyboard buttons we're attaching.
    const blocks = slackMessageBlocks(rendered, opts?.inlineKeyboard)
    const payload = { channel: channelId, text, blocks }
    const basePayload = opts?.replyTo
      ? { ...payload, thread_ts: opts.replyTo, reply_broadcast: opts.broadcast ?? true }
      : payload
    let res: unknown
    try {
      res = await this.webClient.chat.postMessage(basePayload)
    } catch (err) {
      if (!isSlackBlockPayloadError(err)) throw err
      process.stderr.write(`slack: rich message blocks rejected, retrying plain text: ${slackErrorCode(err)}\n`)
      const { blocks: _blocks, ...plainPayload } = basePayload
      res = await this.webClient.chat.postMessage({ ...plainPayload, text: rendered })
    }
    return slackPostTs(res)
  }

  // Unicode → Slack name mapping for common emoji
  private static EMOJI_MAP: Record<string, string> = {
    '👀': 'eyes', '👍': 'thumbsup', '👎': 'thumbsdown', '❤️': 'heart',
    '🔥': 'fire', '🎉': 'tada', '✅': 'white_check_mark', '❌': 'x',
    '⏳': 'hourglass_flowing_sand', '🚀': 'rocket', '💯': '100',
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const name = SlackAdapter.EMOJI_MAP[emoji] ?? emoji.replace(/:/g, '')
    try {
      await this.webClient.reactions.add({ channel: channelId, timestamp: messageId, name })
    } catch (err) {
      // `already_reacted` is expected when the same bot reacts twice with the
      // same emoji — not a bug, stay quiet. Everything else (missing scope,
      // invalid channel, rate limit) is worth surfacing so we can tell why
      // the 👀 ack didn't appear.
      const code = slackErrorCode(err)
      if (code !== 'already_reacted') {
        process.stderr.write(`slack: addReaction(${emoji}→${name}) on ${channelId}/${messageId} failed: ${code}\n`)
      }
      throw err
    }
  }

  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const name = SlackAdapter.EMOJI_MAP[emoji] ?? emoji.replace(/:/g, '')
    await this.webClient.reactions.remove({
      channel: channelId,
      timestamp: messageId,
      name,
    }).catch(err => {
      const code = slackErrorCode(err)
      if (!['no_reaction', 'not_reacted', 'message_not_found'].includes(code)) {
        process.stderr.write(`slack: removeReaction(${emoji}→${name}) on ${channelId}/${messageId} failed: ${code}\n`)
      }
    })
  }

  async showTyping(channelId: string, threadTs?: string): Promise<void> {
    if (!threadTs) return
    try {
      await this.webClient.assistant.threads.setStatus({
        channel_id: channelId,
        thread_ts: threadTs,
        status: 'is thinking...',
      })
    } catch (err) {
      const code = slackErrorCode(err)
      process.stderr.write(`slack: assistant.threads.setStatus failed: ${code}\n`)
    }
  }

  async clearTyping(channelId: string, threadTs?: string): Promise<void> {
    if (!threadTs) return
    try {
      await this.webClient.assistant.threads.setStatus({
        channel_id: channelId,
        thread_ts: threadTs,
        status: '',
      })
    } catch (err) {
      const code = slackErrorCode(err)
      process.stderr.write(`slack: assistant.threads.setStatus(clear) failed: ${code}\n`)
    }
  }

  async editMessage(channelId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
    // Slack chat.update REPLACES the message: if blocks are omitted, any
    // existing blocks (including button rows) are dropped. Mirror sendMessage:
    // mrkdwn conversion + multi-section split, and forward the inline keyboard
    // explicitly when the caller passes it.
    const rendered = renderForSlack(text)
    const blocks = slackMessageBlocks(rendered, opts?.inlineKeyboard)
    const payload = {
      channel: channelId,
      ts: messageId,
      text,
      ...(blocks.length > 0 ? { blocks } : {}),
    }
    try {
      await this.webClient.chat.update(payload)
    } catch (err) {
      if (!isSlackBlockPayloadError(err)) throw err
      process.stderr.write(`slack: rich message edit rejected, retrying plain text: ${slackErrorCode(err)}\n`)
      const { blocks: _blocks, ...plainPayload } = payload
      await this.webClient.chat.update({ ...plainPayload, text: rendered })
    }
  }

  async downloadFile(fileId: string): Promise<string> {
    const info = await this.webClient.files.info({ file: fileId })
    const file = info.file
    if (!file?.url_private_download) throw new Error(`Slack download ${fileId}: missing download URL`)
    const id = safeDownloadName(fileId)
    const name = safeDownloadName(file.name ?? fileId)
    const dest = `${this.inboxDir}/${id}-${name}`
    const resp = await fetch(file.url_private_download, {
      headers: { Authorization: `Bearer ${this.botToken}` },
    })
    if (!resp.ok) throw await slackDownloadHttpError(fileId, resp)
    const ws = createWriteStream(dest)
    await pipeline(responseBodyStream(resp), ws)
    return dest
  }

  async uploadFile(channelId: string, filePath: string, filename: string): Promise<void> {
    const content = readFileSync(filePath)
    await this.webClient.files.uploadV2({ channel_id: channelId, file: content, filename })
  }

  onMessage(cb: (msg: InboundMessage) => void | Promise<void>): void {
    this.messageCb = cb
  }

  formatButtonText(text: string): string {
    const home = homedir()
    let t = text.replace(home, '~')
    if (t.length <= this.buttonTextLimit) return t
    const pathMatch = t.match(/^(.*?)(\/[^\s]+)(\s.*)?$/)
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
    }
    if (t.length <= this.buttonTextLimit) return t
    return t.slice(0, this.buttonTextLimit - 1) + '…'
  }

  async promptSearch(channelId: string, prompt: string, _context?: SearchContext): Promise<void> {
    // For Slack, the search button (action_id=cmd:search) directly opens a modal
    // via the interactive handler above. This method is a fallback for programmatic use.
    await this.webClient.chat.postMessage({
      channel: channelId,
      text: `🔍 ${prompt} — use the Search button above`,
    })
  }

  onSearch(cb: (channelId: string, query: string, context?: SearchContext) => void): void {
    this.searchCb = cb
  }

  onInteraction(cb: (i: InteractionCallback) => void | Promise<void>): void {
    this.interactionCb = cb
  }

  // --- Slack-specific helpers ---

  private async resolveUserName(userId: string): Promise<string> {
    const cached = this.nameCache.get(userId)
    if (cached) return cached
    try {
      const r = await this.webClient.users.info({ user: userId })
      const user = recordValue(r.user)
      const profile = recordValue(user?.profile)
      const name = fallbackStringValue(profile?.display_name) ?? fallbackStringValue(user?.real_name) ?? fallbackStringValue(user?.name) ?? userId
      this.nameCache.set(userId, name)
      return name
    } catch (err) {
      process.stderr.write(`slack: users.info failed for ${userId}: ${errorMessage(err)}\n`)
      return userId
    }
  }

  async fetchThread(channelId: string, threadId: string): Promise<import('./types.js').ThreadMessage[]> {
    const res = await this.webClient.conversations.replies({
      channel: channelId,
      ts: threadId,
      limit: 200,
    })
    const messages: import('./types.js').ThreadMessage[] = []
    const items = Array.isArray(res.messages) ? res.messages : []
    for (const item of items) {
      const m = recordValue(item)
      if (!m) continue
      const userId = fallbackStringValue(m.user) ?? ''
      const messageId = fallbackStringValue(m.ts) ?? ''
      const userName = userId ? await this.resolveUserName(userId) : 'unknown'
      messages.push({
        messageId,
        userId,
        userName,
        text: fallbackStringValue(m.text) ?? '',
        ts: slackTimestampIso(messageId),
      })
    }
    return messages
  }

  async createRoomWithBotInvited(request: CreateRoomWithBotInvitedRequest): Promise<CreateRoomWithBotInvitedResult> {
    let roomId = ''
    let roomName = request.desiredRoomName
    try {
      const created = await this.webClient.conversations.create({ name: request.desiredRoomName, is_private: true })
      const facts = slackChannelFacts(recordValue(created)?.channel)
      roomId = facts.id ?? ''
      roomName = facts.name ?? request.desiredRoomName
    } catch (err) {
      const data = recordValue((err as SlackApiError | undefined)?.data)
      const facts = slackChannelFacts(data?.channel)
      const code = facts.archived ? 'room_archived' : facts.id ? 'room_exists' : 'api_error'
      return { ok: false, operation: 'create_room_with_bot_invited', platform: this.platform, code, ...(facts.id ? { roomId: facts.id } : {}), ...(facts.name ? { roomName: facts.name } : {}), error: slackApiErrorMessage(err) }
    }

    if (!roomId) {
      return { ok: false, operation: 'create_room_with_bot_invited', platform: this.platform, code: 'api_error', error: 'missing_channel_id' }
    }

    const botUserId = this.botUserId
    let botInvite: 'invited' | 'already_in_room' | 'failed' | 'unknown' = botUserId ? 'already_in_room' : 'unknown'
    const invitedUsers: RoomCreateInviteFact[] = []

    if (botUserId) {
      try {
        const info = await this.webClient.conversations.info({ channel: roomId })
        const channel = recordValue(info.channel)
        botInvite = channel?.is_member === false ? 'unknown' : 'already_in_room'
      } catch {
        botInvite = 'unknown'
      }
    }

    if (botUserId && botInvite !== 'already_in_room') {
      try {
        await this.webClient.conversations.invite({ channel: roomId, users: botUserId })
        botInvite = 'invited'
      } catch (err) {
        botInvite = slackApiErrorMessage(err) === 'already_in_channel' ? 'already_in_room' : 'failed'
      }
    }

    let members: string[] = []
    try {
      const response = await this.webClient.conversations.members({ channel: request.parentRoomId })
      members = Array.isArray(response.members) ? response.members.filter((member): member is string => typeof member === 'string' && !!member) : []
    } catch {
      members = []
    }

    for (const userId of members) {
      if (userId === botUserId) {
        invitedUsers.push({ userId, status: 'skipped_bot' })
        continue
      }
      let user = recordValue(undefined)
      try {
        user = recordValue((await this.webClient.users.info({ user: userId })).user)
      } catch (err) {
        invitedUsers.push({ userId, status: 'profile_unavailable', error: slackApiErrorMessage(err) })
        continue
      }
      if (user?.is_bot === true) {
        invitedUsers.push({ userId, status: 'skipped_bot' })
        continue
      }
      if (user?.is_stranger === true) {
        invitedUsers.push({ userId, status: 'skipped_external' })
        continue
      }
      if (user?.deleted === true) {
        invitedUsers.push({ userId, status: 'skipped_deactivated' })
        continue
      }
      try {
        await this.webClient.conversations.invite({ channel: roomId, users: userId })
        invitedUsers.push({ userId, status: 'invited' })
      } catch (err) {
        const message = slackApiErrorMessage(err)
        invitedUsers.push({ userId, status: message === 'already_in_channel' ? 'already_in_room' : 'invite_failed', ...(message === 'already_in_channel' ? {} : { error: message }) })
      }
    }

    return { ok: true, operation: 'create_room_with_bot_invited', platform: this.platform, roomId, roomName, created: true, botUserId, botInvite, invitedUsers }
  }

  async archiveRoom(request: ArchiveRoomRequest): Promise<ArchiveRoomResult> {
    try {
      await this.webClient.conversations.archive({ channel: request.roomId })
      return { ok: true, operation: 'archive_room', platform: this.platform, roomId: request.roomId, archived: true }
    } catch (err) {
      return { ok: false, operation: 'archive_room', platform: this.platform, code: 'api_error', roomId: request.roomId, error: slackApiErrorMessage(err) }
    }
  }

  renderListPicker(items: PickerItem[], page: number, totalPages: number, callbackPrefix: string): SendOptions {
    const blocks: SlackBlock[] = []
    // Collect consecutive nav items into a single actions block
    let navBatch: SlackButtonElement[] = []

    const flushNav = () => {
      if (navBatch.length > 0) {
        blocks.push({ type: 'actions', elements: navBatch })
        navBatch = []
      }
    }

    for (const item of items) {
      if (item.type === 'nav') {
        // Nav buttons: collect into actions block
        navBatch.push({
          type: 'button',
          text: { type: 'plain_text', text: this.formatButtonText(item.label) },
          action_id: slackActionId(`${callbackPrefix}${item.value}`),
          value: this.compactCallbackValue(`${callbackPrefix}${item.value}`),
        })
      } else {
        // Content items: section + accessory button
        flushNav()
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: item.label },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Select' },
            action_id: slackActionId(`${callbackPrefix}${item.value}`),
            value: this.compactCallbackValue(`${callbackPrefix}${item.value}`),
          },
        })
      }
    }
    flushNav()

    // Built-in pagination (from adapter)
    if (totalPages > 1) {
      const elements: SlackButtonElement[] = []
      if (page > 0) elements.push({ type: 'button', text: { type: 'plain_text', text: '⬅️ Prev' }, action_id: `ccp:${page - 1}`, value: `ccp:${page - 1}` })
      elements.push({ type: 'button', text: { type: 'plain_text', text: `${page + 1}/${totalPages}` }, action_id: 'noop', value: 'noop' })
      if (page < totalPages - 1) elements.push({ type: 'button', text: { type: 'plain_text', text: '➡️ Next' }, action_id: `ccp:${page + 1}`, value: `ccp:${page + 1}` })
      blocks.push({ type: 'actions', elements })
    }
    return { inlineKeyboard: blocks }
  }

  renderGrid(opts: {
    topButtons?: ButtonItem[]
    gridItems?: ButtonItem[]
    filterButtons?: ButtonItem[]
    bottomButtons?: ButtonItem[]
  }): SendOptions {
    const blocks: SlackBlock[] = []
    const allButtons = [
      ...(opts.topButtons ?? []),
      ...(opts.filterButtons ?? []),
      ...(opts.gridItems ?? []),
      ...(opts.bottomButtons ?? []),
    ]
    // Slack limits 5 buttons per actions block
    for (let i = 0; i < allButtons.length; i += 5) {
      const chunk = allButtons.slice(i, i + 5)
      blocks.push({
        type: 'actions',
        elements: chunk.map(b => ({
          type: 'button',
          text: { type: 'plain_text', text: this.formatButtonText(b.text) },
          action_id: slackActionId(b.data),
          value: this.compactCallbackValue(b.data),
        })),
      })
    }
    return { inlineKeyboard: blocks }
  }

  renderButtons(buttons: ButtonItem[]): SendOptions {
    const blocks: SlackBlock[] = []
    for (let i = 0; i < buttons.length; i += 5) {
      const chunk = buttons.slice(i, i + 5)
      blocks.push({
        type: 'actions',
        elements: chunk.map(b => ({
          type: 'button',
          text: { type: 'plain_text', text: this.formatButtonText(b.text) },
          action_id: slackActionId(b.data),
          value: this.compactCallbackValue(b.data),
        })),
      })
    }
    return { inlineKeyboard: blocks }
  }
}
