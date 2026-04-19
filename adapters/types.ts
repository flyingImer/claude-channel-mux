/**
 * Unified channel adapter interface. Each messaging platform implements this.
 * The daemon only interacts with adapters through this contract.
 */

export type InboundMessage = {
  channelId: string         // platform-local ID (e.g. Slack channel ID, Telegram chat ID)
  userId: string
  userName: string
  text: string
  messageId: string
  replyToId?: string        // message ID being replied to / quoted
  meta: Record<string, string>
}

export type ThreadMessage = {
  messageId: string
  userId: string
  userName: string
  text: string
  ts: string
}

export type InteractionCallback = {
  channelId: string
  data: string              // callback_data from inline keyboard
  ackId?: string            // for platforms that need explicit ack (Telegram callback_query_id)
}

export type SendOptions = {
  replyTo?: string          // message ID to reply to / thread under
  broadcast?: boolean       // Slack: also send to channel when replying in thread
  inlineKeyboard?: any      // platform-native keyboard structure
}

export interface ChannelAdapter {
  /** Platform name used as channel key prefix (e.g. "slack", "telegram") */
  readonly platform: string

  /** Whether this adapter is configured (has tokens) */
  readonly configured: boolean

  /** Max characters for inline button text */
  readonly buttonTextLimit: number

  /** Max items per page in list pickers */
  readonly pageSize: number

  /** Shorten text to fit button limit, preserving key info */
  formatButtonText(text: string): string

  /** Connect to the platform. Called once at daemon startup. */
  start(): Promise<void>

  /** Graceful disconnect. */
  stop(): Promise<void>

  /** Send a text message. Returns the message ID. */
  sendMessage(channelId: string, text: string, opts?: SendOptions): Promise<string | undefined>

  /**
   * Add an emoji reaction to a message.
   * Slack: reactions.add (emoji name without colons)
   * Telegram: setMessageReaction (emoji character)
   */
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>

  /**
   * Remove an emoji reaction from a message.
   * Used to clear ack/typing indicators after CC responds.
   */
  removeReaction?(channelId: string, messageId: string, emoji: string): Promise<void>

  /**
   * Edit a previously sent message.
   * If `opts.inlineKeyboard` is provided, the edit preserves/replaces buttons.
   * Without it, callers risk buttons being stripped (Slack chat.update drops
   * blocks when blocks omitted). Always pass opts when editing a message that
   * originally had inline buttons.
   */
  editMessage(channelId: string, messageId: string, text: string, opts?: SendOptions): Promise<void>

  /**
   * Show typing/processing indicator.
   * Telegram: sendChatAction('typing') — auto-expires after 5s
   * Slack: no native typing for bots — this is a no-op
   */
  showTyping?(channelId: string): Promise<void>

  /** Download a file to the inbox dir. Returns local file path. */
  downloadFile(fileId: string): Promise<string>

  /** Upload a file to a channel. */
  uploadFile(channelId: string, filePath: string, filename: string): Promise<void>

  /** Register inbound message handler. */
  onMessage(cb: (msg: InboundMessage) => void | Promise<void>): void

  /** Register interaction handler (inline keyboard clicks, button presses). */
  onInteraction(cb: (interaction: InteractionCallback) => void | Promise<void>): void

  /**
   * Fetch thread/conversation history. Optional — platforms that don't
   * support history return undefined. CC calls this on-demand when it
   * needs context from older messages.
   */
  fetchThread?(channelId: string, threadId: string): Promise<ThreadMessage[]>

  // ---------------------------------------------------------------------------
  // UI rendering — each platform renders pickers/grids in its native format
  // ---------------------------------------------------------------------------

  /**
   * Render a list picker (session list, stop list). Returns SendOptions
   * with platform-native inline keyboard/blocks.
   */
  renderListPicker(items: PickerItem[], page: number, totalPages: number, callbackPrefix: string): any

  /**
   * Render a button grid (directory browser, action buttons).
   * topButtons appear first, gridItems in 2-col layout, bottomButtons last.
   */
  renderGrid(opts: {
    topButtons?: ButtonItem[]
    gridItems?: ButtonItem[]
    filterButtons?: ButtonItem[]
    bottomButtons?: ButtonItem[]
  }): any

  /**
   * Render a row of action buttons (for sendWithButtons).
   */
  renderButtons(buttons: ButtonItem[]): any

  /**
   * Prompt user for text input using platform-native UX.
   * Telegram: force_reply message. Slack: modal.
   * Result delivered via onSearch callback.
   */
  promptSearch(channelId: string, prompt: string): Promise<void>

  /**
   * Register search result callback. Fired when user submits text
   * from a promptSearch interaction.
   */
  onSearch(cb: (channelId: string, query: string) => void): void
}

export type PickerItem = {
  label: string
  value: string   // callback_data value
  type?: 'item' | 'nav'  // 'item' = content row (default), 'nav' = navigation button
}

export type ButtonItem = {
  text: string
  data: string    // callback_data
}
