import { createWriteStream } from 'fs'
import { basename } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { ChannelAdapter, InboundMessage, InteractionCallback, SendOptions } from './types.js'
import { renderForTelegram, splitForLimit } from './markdown.js'

// Telegram Bot API caps messages at 4096 chars. Leave headroom for MV2
// escape expansion (each `_*[]()~>#+-=|{}.!` gets a backslash added).
const MESSAGE_LIMIT = 3800

export class TelegramAdapter implements ChannelAdapter {
  readonly platform = 'telegram'
  readonly configured: boolean
  readonly buttonTextLimit = 30  // visual display width on phone
  readonly pageSize = 20

  private token: string
  private inboxDir: string
  private offset = 0
  private polling = false
  private messageCb: ((msg: InboundMessage) => void | Promise<void>) | null = null
  private interactionCb: ((i: InteractionCallback) => void | Promise<void>) | null = null
  private searchCb: ((channelId: string, query: string) => void) | null = null
  // Telegram's setMessageReaction is REPLACE-ALL — to implement add-semantics
  // we track reactions we've set per message and resend the union. Key is
  // `${chat_id}:${message_id}`. Bot API caps at 3 reactions; oldest drops.
  private reactionCache = new Map<string, string[]>()
  private static SEARCH_PROMPT = '🔍 Search:'

  constructor(opts: { token?: string; inboxDir: string }) {
    this.token = opts.token ?? ''
    this.inboxDir = opts.inboxDir
    this.configured = !!this.token
  }

  private async api(method: string, body?: Record<string, unknown>): Promise<any> {
    const res = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {},
    )
    const json = await res.json() as any
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`)
    return json.result
  }

  async start(): Promise<void> {
    if (!this.configured) return

    try {
      const me = await this.api('getMe')
      process.stderr.write(`telegram: bot @${me.username}\n`)
    } catch (err) {
      process.stderr.write(`telegram: getMe failed: ${err}\n`)
    }

    // Register bot commands for autocomplete
    try {
      await this.api('setMyCommands', {
        commands: [
          { command: 'ccm', description: 'New CC session' },
          { command: 'ccm_resume', description: 'Browse & resume sessions' },
          { command: 'ccm_stop', description: 'Disconnect / stop session' },
          { command: 'ccm_help', description: 'Status & commands' },
          { command: 'ccm_find', description: 'Search directories' },
          { command: 'cc_compact', description: 'CC: compact context' },
          { command: 'cc_model', description: 'CC: switch model' },
          { command: 'cc_cost', description: 'CC: show cost' },
          { command: 'cc_exit', description: 'CC: exit session' },
          { command: 'cc_resume', description: 'CC: resume session picker' },
          { command: 'cc_status', description: 'CC: session status' },
        ],
      })
      process.stderr.write('telegram: bot commands registered\n')
    } catch {}

    this.polling = true
    this.poll()
    process.stderr.write('telegram: polling started\n')
  }

  async stop(): Promise<void> {
    this.polling = false
  }

  private async poll(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.api('getUpdates', { offset: this.offset, timeout: 30 })
        for (const u of updates) {
          this.offset = u.update_id + 1

          // Callback query (inline keyboard)
          if (u.callback_query) {
            const cb = u.callback_query
            this.interactionCb?.({
              channelId: String(cb.message?.chat?.id),
              data: cb.data,
              ackId: cb.id,
            })
            await this.api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {})
            continue
          }

          // Message
          const msg = u.message
          if (!msg?.text && !msg?.caption && !msg?.document && !msg?.photo) continue

          const meta: Record<string, string> = {
            ts: new Date(msg.date * 1000).toISOString(),
          }
          if (msg.document) {
            meta.attachment_file_id = msg.document.file_id
            meta.attachment_name = msg.document.file_name ?? ''
            if (msg.document.mime_type) meta.attachment_mime = msg.document.mime_type
            if (msg.document.file_size) meta.attachment_size = String(msg.document.file_size)
          }
          if (msg.photo) {
            const largest = msg.photo[msg.photo.length - 1]
            meta.attachment_file_id = largest.file_id
            meta.attachment_mime = 'image/jpeg'
            meta.attachment_name = 'photo.jpg'
          }

          // Check if this is a reply to a search prompt → search callback
          if (
            msg.reply_to_message?.text?.startsWith(TelegramAdapter.SEARCH_PROMPT) &&
            msg.text &&
            this.searchCb
          ) {
            this.searchCb(String(msg.chat.id), msg.text.trim())
            continue
          }

          // reply_to_message = message being quoted/replied to
          const replyToId = msg.reply_to_message
            ? String(msg.reply_to_message.message_id)
            : undefined

          this.messageCb?.({
            channelId: String(msg.chat.id),
            userId: String(msg.from?.id),
            userName: msg.from?.username ?? msg.from?.first_name ?? String(msg.from?.id),
            text: msg.text ?? msg.caption ?? '',
            messageId: String(msg.message_id),
            replyToId,
            meta,
          })
        }
      } catch (err) {
        if (this.polling) {
          process.stderr.write(`telegram: poll error: ${err}\n`)
          await new Promise(r => setTimeout(r, 5000))
        }
      }
    }
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
    let firstId: string | undefined
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0
      const isLast = i === chunks.length - 1
      const body: Record<string, unknown> = {
        chat_id: channelId,
        text: chunks[i],
        parse_mode: 'MarkdownV2',
      }
      if (isFirst && opts?.replyTo) body.reply_to_message_id = parseInt(opts.replyTo)
      if (isLast && opts?.inlineKeyboard) body.reply_markup = { inline_keyboard: opts.inlineKeyboard }
      const r = await this.api('sendMessage', body)
      if (isFirst) firstId = String(r.message_id)
    }
    return firstId
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Telegram setMessageReaction REPLACES the whole reaction set. To give
    // callers add-semantics, track what we've added per message and resend
    // the union. Cap at 3 (Bot API max for non-premium bots); oldest drops.
    const key = `${channelId}:${messageId}`
    const current = this.reactionCache.get(key) ?? []
    if (current.includes(emoji)) return  // already there
    const next = [...current, emoji].slice(-3)
    try {
      await this.api('setMessageReaction', {
        chat_id: channelId,
        message_id: parseInt(messageId),
        reaction: next.map(e => ({ type: 'emoji', emoji: e })),
      })
      this.reactionCache.set(key, next)
    } catch (err) {
      process.stderr.write(`telegram: addReaction(${emoji}) on ${channelId}/${messageId} failed: ${err}\n`)
      throw err
    }
  }

  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Drop `emoji` from our tracked set, resend the union. If `emoji` is
    // empty or we have no state, clear all (matches old behavior).
    const key = `${channelId}:${messageId}`
    const current = this.reactionCache.get(key) ?? []
    const next = emoji ? current.filter(e => e !== emoji) : []
    await this.api('setMessageReaction', {
      chat_id: channelId,
      message_id: parseInt(messageId),
      reaction: next.map(e => ({ type: 'emoji', emoji: e })),
    }).catch(() => {})
    if (next.length === 0) this.reactionCache.delete(key)
    else this.reactionCache.set(key, next)
  }

  async showTyping(channelId: string): Promise<void> {
    await this.api('sendChatAction', { chat_id: channelId, action: 'typing' }).catch(() => {})
  }

  async editMessage(channelId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
    // editMessageText has the same 4096 char cap but can't be split (it
    // edits one message). If the rendered text exceeds the limit, truncate
    // so the edit actually goes through rather than Slack-style rejecting.
    // Telegram preserves the existing inline_keyboard unless we pass one.
    const rendered = renderForTelegram(text)
    const body: Record<string, unknown> = {
      chat_id: channelId,
      message_id: parseInt(messageId),
      text: rendered.length > MESSAGE_LIMIT ? rendered.slice(0, MESSAGE_LIMIT - 3) + '...' : rendered,
      parse_mode: 'MarkdownV2',
    }
    if (opts?.inlineKeyboard) body.reply_markup = { inline_keyboard: opts.inlineKeyboard }
    await this.api('editMessageText', body)
  }

  async downloadFile(fileId: string): Promise<string> {
    const fi = await this.api('getFile', { file_id: fileId })
    const name = basename(fi.file_path).replace(/[<>[\]{}|\\^`\x00-\x1f]/g, '_')
    const dest = `${this.inboxDir}/${fileId}-${name}`
    const resp = await fetch(`https://api.telegram.org/file/bot${this.token}/${fi.file_path}`)
    if (!resp.ok) throw new Error(`Download ${resp.status}`)
    const ws = createWriteStream(dest)
    await pipeline(Readable.fromWeb(resp.body as any), ws)
    return dest
  }

  async uploadFile(channelId: string, filePath: string, filename: string): Promise<void> {
    const { readFileSync } = await import('fs')
    const data = readFileSync(filePath)
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)

    const form = new FormData()
    form.append('chat_id', channelId)
    if (isImage) {
      form.append('photo', new Blob([data]), filename)
      await fetch(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
        method: 'POST', body: form,
      })
    } else {
      form.append('document', new Blob([data]), filename)
      await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
        method: 'POST', body: form,
      })
    }
  }

  onMessage(cb: (msg: InboundMessage) => void | Promise<void>): void {
    this.messageCb = cb
  }

  formatButtonText(text: string): string {
    const home = require('os').homedir()
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

  async promptSearch(channelId: string, prompt: string): Promise<void> {
    await this.api('sendMessage', {
      chat_id: channelId,
      text: `${TelegramAdapter.SEARCH_PROMPT} ${prompt}`,
      reply_markup: { force_reply: true, input_field_placeholder: 'e.g. proj' },
    })
  }

  onSearch(cb: (channelId: string, query: string) => void): void {
    this.searchCb = cb
  }

  onInteraction(cb: (i: InteractionCallback) => void | Promise<void>): void {
    this.interactionCb = cb
  }

  private btn(text: string, data: string) {
    return { text: this.formatButtonText(text), callback_data: data }
  }

  renderListPicker(items: import('./types.js').PickerItem[], page: number, totalPages: number, callbackPrefix: string): any {
    const kb = items.map(item => [this.btn(item.label, `${callbackPrefix}${item.value}`)])
    if (totalPages > 1) {
      const nav: any[] = []
      if (page > 0) nav.push({ text: '⬅️', callback_data: `ccp:${page - 1}` })
      nav.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' })
      if (page < totalPages - 1) nav.push({ text: '➡️', callback_data: `ccp:${page + 1}` })
      kb.push(nav)
    }
    return { inlineKeyboard: kb }
  }

  renderGrid(opts: {
    topButtons?: import('./types.js').ButtonItem[]
    gridItems?: import('./types.js').ButtonItem[]
    filterButtons?: import('./types.js').ButtonItem[]
    bottomButtons?: import('./types.js').ButtonItem[]
  }): any {
    const kb: any[][] = []
    if (opts.topButtons?.length) {
      kb.push(opts.topButtons.map(b => (this.btn(b.text, b.data))))
    }
    if (opts.filterButtons?.length) {
      kb.push(opts.filterButtons.map(b => (this.btn(b.text, b.data))))
    }
    if (opts.gridItems?.length) {
      for (let i = 0; i < opts.gridItems.length; i += 2) {
        const row: any[] = [this.btn(opts.gridItems[i].text, opts.gridItems[i].data)]
        if (opts.gridItems[i + 1]) row.push(this.btn(opts.gridItems[i + 1].text, opts.gridItems[i + 1].data))
        kb.push(row)
      }
    }
    if (opts.bottomButtons?.length) {
      kb.push(opts.bottomButtons.map(b => (this.btn(b.text, b.data))))
    }
    return { inlineKeyboard: kb }
  }

  renderButtons(buttons: import('./types.js').ButtonItem[]): any {
    return { inlineKeyboard: [buttons.map(b => (this.btn(b.text, b.data)))] }
  }
}
