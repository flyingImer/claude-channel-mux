import { WebClient } from '@slack/web-api'
import { SocketModeClient } from '@slack/socket-mode'
import { readFileSync } from 'fs'
import { basename } from 'path'
import type { ChannelAdapter, InboundMessage, InteractionCallback, SendOptions } from './types.js'
import { renderForSlack, splitForLimit } from './markdown.js'

// Slack section block text hard limit per the API. Each section holds up
// to 3000 chars; a single chat.postMessage can carry up to 50 blocks.
const SECTION_LIMIT = 2900

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
  private searchCb: ((channelId: string, query: string) => void) | null = null
  private pendingSearchChannels = new Map<string, string>()  // view_id → channel_id
  private nameCache = new Map<string, string>()

  constructor(opts: { botToken?: string; appToken?: string; inboxDir: string }) {
    this.botToken = opts.botToken ?? ''
    this.appToken = opts.appToken ?? ''
    this.inboxDir = opts.inboxDir
    this.configured = !!(this.botToken && this.appToken)
  }

  async start(): Promise<void> {
    if (!this.configured) return

    this.web = new WebClient(this.botToken)
    this.socket = new SocketModeClient({ appToken: this.appToken })

    try {
      const auth = await this.web.auth.test()
      this.botUserId = (auth.user_id as string) ?? ''
      this.botId = (auth.bot_id as string) ?? ''
      process.stderr.write(`slack: bot user ${this.botUserId} bot_id ${this.botId}\n`)
    } catch (err) {
      process.stderr.write(`slack: auth.test failed: ${err}\n`)
    }

    this.socket.on('message', async ({ event, ack }) => {
      await ack()
      if (event.user === this.botUserId || event.bot_id === this.botId) return
      if (event.subtype && event.subtype !== 'file_share') return

      const userName = await this.resolveUserName(event.user)
      const meta: Record<string, string> = {
        ts: new Date(parseFloat(event.ts) * 1000).toISOString(),
      }
      // thread_ts present = message is in a thread. Pass as replyToId
      // so CC knows the context. CC will reply with reply_broadcast=true
      // so the response appears in both channel and thread.
      const replyToId = event.thread_ts as string | undefined

      const files = (event.files as any[]) ?? []
      if (files.length > 0) {
        // First file in dedicated fields (backwards compatible)
        meta.attachment_file_id = files[0].id
        if (files[0].name) meta.attachment_name = files[0].name
        if (files[0].mimetype) meta.attachment_mime = files[0].mimetype
        if (files[0].size != null) meta.attachment_size = String(files[0].size)
        // All files as JSON array for multi-file support
        if (files.length > 1) {
          meta.attachment_files = JSON.stringify(files.map((f: any) => ({
            file_id: f.id, name: f.name, mime: f.mimetype, size: f.size,
          })))
        }
      }

      this.messageCb?.({
        channelId: event.channel,
        userId: event.user,
        userName,
        text: event.text ?? '',
        messageId: event.ts,
        replyToId,
        meta,
      })
    })

    this.socket.on('interactive', async ({ body, ack }: any) => {
      await ack()

      // Handle view_submission (modal submit — e.g. search)
      if (body.type === 'view_submission') {
        const viewId = body.view?.id
        const channelId = this.pendingSearchChannels.get(viewId)
        if (channelId && this.searchCb) {
          const values = body.view?.state?.values
          const query = values?.search_block?.search_input?.value
          if (query) this.searchCb(channelId, query.trim())
          this.pendingSearchChannels.delete(viewId)
        }
        return
      }

      const action = body.actions?.[0]
      if (!action) return

      // Intercept search button → open modal directly (no daemon round-trip)
      if (action.action_id === 'cmd:search' && body.trigger_id) {
        const channelId = body.channel?.id
        if (channelId) {
          const res = await this.web!.views.open({
            trigger_id: body.trigger_id,
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
            this.pendingSearchChannels.set(res.view.id, channelId)
          }
        }
        return
      }

      this.interactionCb?.({
        channelId: body.channel?.id,
        data: action.value ?? action.action_id,
      })
    })

    // Handle Slack slash commands (/ccm, /cc)
    this.socket.on('slash_commands', async ({ body, ack }: any) => {
      await ack()
      const command = body.command as string    // "/ccm" or "/cc"
      const text = body.text as string          // args after the command
      const channelId = body.channel_id as string

      // Reconstruct as a message that parseCmd can handle
      // /ccm resume → "ccm resume", /cc compact → "/cc compact"
      const fullText = command === '/ccm'
        ? `ccm ${text}`.trim()
        : command === '/cc'
          ? `/cc ${text}`.trim()
          : text

      this.messageCb?.({
        channelId,
        userId: body.user_id ?? '',
        userName: body.user_name ?? '',
        text: fullText,
        messageId: '',
        meta: { ts: new Date().toISOString() },
      })
    })

    await this.socket.start()
    process.stderr.write('slack: Socket Mode connected\n')
  }

  async stop(): Promise<void> {
    await this.socket?.disconnect().catch(() => {})
  }

  async sendMessage(channelId: string, text: string, opts?: SendOptions): Promise<string | undefined> {
    // Convert CC's GFM markdown into Slack's mrkdwn (bold/italic/links/etc).
    // ASCII-art-ish lines get auto-fenced so remark doesn't mangle them.
    const rendered = renderForSlack(text)
    // Split long text into multiple section blocks rather than truncating.
    // Each section caps at 3000 chars; one message can carry up to 50
    // sections, plus whatever inline keyboard buttons we're attaching.
    const sections = splitForLimit(rendered, SECTION_LIMIT).slice(0, 45)
    const textBlocks = sections.map(s => ({
      type: 'section',
      text: { type: 'mrkdwn', text: s },
    }))
    const keyboard = opts?.inlineKeyboard as any[] | undefined
    const blocks = keyboard ? [...textBlocks, ...keyboard] : textBlocks
    const res = await this.web!.chat.postMessage({
      channel: channelId,
      text,  // notification fallback; Slack accepts up to 40k here
      ...(opts?.replyTo ? { thread_ts: opts.replyTo, reply_broadcast: opts.broadcast ?? true } : {}),
      ...(blocks.length > 0 ? { blocks } : {}),
    })
    return res.ts as string | undefined
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
      await this.web!.reactions.add({ channel: channelId, timestamp: messageId, name })
    } catch (err: any) {
      // `already_reacted` is expected when the same bot reacts twice with the
      // same emoji — not a bug, stay quiet. Everything else (missing scope,
      // invalid channel, rate limit) is worth surfacing so we can tell why
      // the 👀 ack didn't appear.
      const code = err?.data?.error ?? err?.code ?? 'unknown'
      if (code !== 'already_reacted') {
        process.stderr.write(`slack: addReaction(${emoji}→${name}) on ${channelId}/${messageId} failed: ${code}\n`)
      }
      throw err
    }
  }

  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.web!.reactions.remove({
      channel: channelId,
      timestamp: messageId,
      name: emoji.replace(/:/g, ''),
    }).catch(() => {})  // ignore if not found
  }

  async showTyping(channelId: string, threadTs?: string): Promise<void> {
    if (!threadTs) return
    try {
      await this.web!.assistant.threads.setStatus({
        channel_id: channelId,
        thread_ts: threadTs,
        status: 'is thinking...',
      })
    } catch (err: any) {
      const code = err?.data?.error ?? err?.code ?? 'unknown'
      process.stderr.write(`slack: assistant.threads.setStatus failed: ${code}\n`)
    }
  }

  async editMessage(channelId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
    // Slack chat.update REPLACES the message: if blocks are omitted, any
    // existing blocks (including button rows) are dropped. Mirror sendMessage:
    // mrkdwn conversion + multi-section split, and forward the inline keyboard
    // explicitly when the caller passes it.
    const rendered = renderForSlack(text)
    const sections = splitForLimit(rendered, SECTION_LIMIT).slice(0, 45)
    const textBlocks = sections.map(s => ({
      type: 'section',
      text: { type: 'mrkdwn', text: s },
    }))
    const keyboard = opts?.inlineKeyboard as any[] | undefined
    const blocks = keyboard ? [...textBlocks, ...keyboard] : textBlocks
    await this.web!.chat.update({
      channel: channelId,
      ts: messageId,
      text,
      ...(blocks.length > 0 ? { blocks } : {}),
    })
  }

  async downloadFile(fileId: string): Promise<string> {
    const info = await this.web!.files.info({ file: fileId })
    const file = info.file
    if (!file?.url_private_download) throw new Error('No download URL')
    const name = (file.name ?? fileId).replace(/[<>[\]{}|\\^`\x00-\x1f]/g, '_')
    const dest = `${this.inboxDir}/${fileId}-${name}`
    const { createWriteStream } = await import('fs')
    const { pipeline } = await import('stream/promises')
    const { Readable } = await import('stream')
    const resp = await fetch(file.url_private_download, {
      headers: { Authorization: `Bearer ${this.botToken}` },
    })
    if (!resp.ok) throw new Error(`Download ${resp.status}`)
    const ws = createWriteStream(dest)
    await pipeline(Readable.fromWeb(resp.body as any), ws)
    return dest
  }

  async uploadFile(channelId: string, filePath: string, filename: string): Promise<void> {
    const content = readFileSync(filePath)
    await this.web!.files.uploadV2({ channel_id: channelId, file: content, filename })
  }

  onMessage(cb: (msg: InboundMessage) => void | Promise<void>): void {
    this.messageCb = cb
  }

  formatButtonText(text: string): string {
    const home = require('os').homedir()
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

  async promptSearch(channelId: string, prompt: string): Promise<void> {
    // For Slack, the search button (action_id=cmd:search) directly opens a modal
    // via the interactive handler above. This method is a fallback for programmatic use.
    await this.web!.chat.postMessage({
      channel: channelId,
      text: `🔍 ${prompt} — use the Search button above`,
    })
  }

  onSearch(cb: (channelId: string, query: string) => void): void {
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
      const r = await this.web!.users.info({ user: userId })
      const n = r.user?.profile?.display_name || r.user?.real_name || r.user?.name || userId
      this.nameCache.set(userId, n)
      return n
    } catch { return userId }
  }

  async fetchThread(channelId: string, threadId: string): Promise<import('./types.js').ThreadMessage[]> {
    const res = await this.web!.conversations.replies({
      channel: channelId,
      ts: threadId,
      limit: 200,
    })
    const messages: import('./types.js').ThreadMessage[] = []
    for (const m of res.messages ?? []) {
      const userName = m.user ? await this.resolveUserName(m.user) : 'unknown'
      messages.push({
        messageId: m.ts ?? '',
        userId: m.user ?? '',
        userName,
        text: m.text ?? '',
        ts: new Date(parseFloat(m.ts ?? '0') * 1000).toISOString(),
      })
    }
    return messages
  }

  renderListPicker(items: import('./types.js').PickerItem[], page: number, totalPages: number, callbackPrefix: string): any {
    const blocks: any[] = []
    // Collect consecutive nav items into a single actions block
    let navBatch: any[] = []

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
          action_id: `${callbackPrefix}${item.value}`,
          value: `${callbackPrefix}${item.value}`,
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
            action_id: `${callbackPrefix}${item.value}`,
            value: `${callbackPrefix}${item.value}`,
          },
        })
      }
    }
    flushNav()

    // Built-in pagination (from adapter)
    if (totalPages > 1) {
      const elements: any[] = []
      if (page > 0) elements.push({ type: 'button', text: { type: 'plain_text', text: '⬅️ Prev' }, action_id: `ccp:${page - 1}`, value: `ccp:${page - 1}` })
      elements.push({ type: 'button', text: { type: 'plain_text', text: `${page + 1}/${totalPages}` }, action_id: 'noop', value: 'noop' })
      if (page < totalPages - 1) elements.push({ type: 'button', text: { type: 'plain_text', text: '➡️ Next' }, action_id: `ccp:${page + 1}`, value: `ccp:${page + 1}` })
      blocks.push({ type: 'actions', elements })
    }
    return { inlineKeyboard: blocks }
  }

  renderGrid(opts: {
    topButtons?: import('./types.js').ButtonItem[]
    gridItems?: import('./types.js').ButtonItem[]
    filterButtons?: import('./types.js').ButtonItem[]
    bottomButtons?: import('./types.js').ButtonItem[]
  }): any {
    const blocks: any[] = []
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
          action_id: b.data,
          value: b.data,
        })),
      })
    }
    return { inlineKeyboard: blocks }
  }

  renderButtons(buttons: import('./types.js').ButtonItem[]): any {
    return {
      inlineKeyboard: [{
        type: 'actions',
        elements: buttons.map(b => ({
          type: 'button',
          text: { type: 'plain_text', text: this.formatButtonText(b.text) },
          action_id: b.data,
          value: b.data,
        })),
      }],
    }
  }
}
