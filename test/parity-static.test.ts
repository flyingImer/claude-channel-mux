import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { test, expect } from 'bun:test'


test('legacy parity audit lists every pre-Codex commit', () => {
  const audit = readFileSync('docs/legacy-parity-audit.md', 'utf8')
  const commits = execSync('git log --reverse --pretty=format:%h 547033c', { encoding: 'utf8' }).trim().split(/\s+/)
  for (const commit of commits) {
    expect(audit).toContain(`\`${commit}\``)
  }
})


test('plugin and package metadata advertise both agent runtimes', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const claudePlugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'))
  const codexPlugin = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'))
  for (const meta of [pkg, claudePlugin, codexPlugin]) {
    expect(meta.keywords).toContain('claude-code')
    expect(meta.keywords).toContain('codex')
    expect(meta.description).toContain('Claude')
    expect(meta.description).toContain('Codex')
  }
})

test('plugin ships CCM orchestration role skills', () => {
  const codexPlugin = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'))
  expect(codexPlugin.skills).toBe('./skills/')

  const expectedSkills = [
    'operate-orchestrator-room',
    'bootstrap-git-orchestration',
    'guide-orchestration',
    'orchestrate-workers',
    'manage-worker-protocol',
    'work-in-worker-room',
    'process-orchestration-inbox',
    'audit-worker-output',
    'integrate-worker-output',
    'recover-orchestration',
  ]
  for (const skill of expectedSkills) {
    const body = readFileSync(`skills/${skill}/SKILL.md`, 'utf8')
    expect(body).toContain(`name: ${skill}`)
    expect(body).toContain('description: Use when')
    const ui = readFileSync(`skills/${skill}/agents/openai.yaml`, 'utf8')
    expect(ui).toContain('display_name:')
    expect(ui).toContain('short_description:')
    expect(ui).toContain('default_prompt:')
    expect(ui).toContain(`$${skill}`)
  }
  expect(readFileSync('skills/orchestrate-workers/SKILL.md', 'utf8')).toContain('isOrchestrator: true')
  expect(readFileSync('skills/orchestrate-workers/SKILL.md', 'utf8')).toContain('unsupported_capability')
  expect(readFileSync('skills/work-in-worker-room/SKILL.md', 'utf8')).toContain('Worker Report')
  expect(readFileSync('skills/guide-orchestration/SKILL.md', 'utf8')).toContain('Stage Contract')
  expect(readFileSync('skills/operate-orchestrator-room/SKILL.md', 'utf8')).toContain('/ccm orch status')
  expect(readFileSync('skills/bootstrap-git-orchestration/SKILL.md', 'utf8')).toContain('docs/orchestration/<initiative-id>/')
  expect(readFileSync('skills/manage-worker-protocol/SKILL.md', 'utf8')).toContain('Completion Reportback')
  expect(readFileSync('skills/recover-orchestration/SKILL.md', 'utf8')).toContain('Create/Adopt/Repair')
  expect(readFileSync('skills/integrate-worker-output/SKILL.md', 'utf8')).toContain('merge_failed')
  expect(readFileSync('skills/process-orchestration-inbox/SKILL.md', 'utf8')).toContain('inbox/*.md.done')
  expect(readFileSync('skills/audit-worker-output/SKILL.md', 'utf8')).toContain('Self-audit')
  expect(readFileSync('skills/bootstrap-git-orchestration/SKILL.md', 'utf8')).toContain('docs/orchestration/_templates/')
  expect(readFileSync('skills/bootstrap-git-orchestration/SKILL.md', 'utf8')).toContain('bun run orchestration:new')
  expect(readFileSync('skills/bootstrap-git-orchestration/SKILL.md', 'utf8')).toContain('bun run orchestration:adopt')
  expect(readFileSync('skills/bootstrap-git-orchestration/SKILL.md', 'utf8')).toContain('docs/checklists/git-orchestration-bootstrap.md')
  expect(readFileSync('skills/orchestrate-workers/SKILL.md', 'utf8')).toContain('prompts/ccm/')
  expect(readFileSync('skills/work-in-worker-room/SKILL.md', 'utf8')).toContain('docs/orchestration/_templates/worker-report.md')
  expect(readFileSync('skills/guide-orchestration/SKILL.md', 'utf8')).toContain('docs/orchestration/_templates/guiding-principal-response.md')
  expect(readFileSync('skills/guide-orchestration/SKILL.md', 'utf8')).toContain('not a routine approval gate')
  expect(readFileSync('skills/audit-worker-output/SKILL.md', 'utf8')).toContain('docs/orchestration/_templates/audit-report.md')
  expect(readFileSync('skills/recover-orchestration/SKILL.md', 'utf8')).toContain('docs/orchestration/_templates/recovery-note.md')
})

test('Codex slash commands fail closed unless raw is explicit', () => {
  const source = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('async function deliverAgentCommand'), daemon.indexOf('async function onMessage'))
  expect(source).toContain("if (name === 'raw')")
  expect(source).toContain('Unsupported Codex command')
  expect(source).toContain('/cx raw /command ...')
  expect(source).not.toContain('return await this.sendSlashCommandAsTurn(runtime, input.command)')
  expect(block).toContain('const commandAllowed = driver.commandSpec?.().capabilities.some')
  expect(block).toContain("runtime === 'codex' && !commandAllowed")
  expect(block).toContain("'codex unsupported command notice'")
  expect(block.indexOf("runtime === 'codex' && !commandAllowed")).toBeLessThan(block.indexOf('const uuid = await ensureRoomAgentReady'))
  expect(block).not.toContain('startNew(ck, roomCwd(ck), runtime')
})

test('Codex model override is room scoped and not global config write', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(driver).toContain('modelOverride')
  expect(driver).toContain('...(effectiveModel ? { model: effectiveModel } : {})')
  expect(daemon).toContain('setAgentMeta(ck, runtime, { model })')
  expect(daemon).toContain('keepAgentModelMeta')
  expect(daemon).toContain('clearAgentMetaField')
  expect(daemon).toContain('/cx model reset')
  expect(daemon).toContain('codexDriver.setModelOverride')
  expect(driver).not.toContain('config/value/write')
  expect(driver).not.toContain('config/batch/write')
})

test('Codex plan updates are forwarded as task-forward parity', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(client).not.toContain("'turn/plan/updated'")
  expect(driver).toContain("msg.method === 'turn/plan/updated'")
  expect(driver).toContain("type: 'plan_updated'")
  expect(daemon).toContain('function formatCodexPlanSnapshot')
  expect(daemon).toContain("import { compareTaskSnapshotItems, taskSnapshotItemFromJson, type TaskSnapshotItem, type TaskStatus } from './tasks.js'")
  expect(daemon).toContain('const item = taskSnapshotItemFromJson(readJsonValueFile(path), file)')
  expect(daemon).not.toContain("const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>")
  expect(daemon).toContain('📋 Codex plan')
  expect(daemon).toContain('publishCodexPlanUpdate')
})

test('shared help uses capability specs for both agents', () => {
  const types = readFileSync('agents/types.ts', 'utf8')
  const claude = readFileSync('agents/claude/channel-driver.ts', 'utf8')
  const codex = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(types).toContain('AgentCommandSpec')
  expect(claude).toContain('commandSpec(): AgentCommandSpec')
  expect(codex).toContain('commandSpec(): AgentCommandSpec')
  expect(daemon).toContain('renderAgentCommandHelp')
  expect(daemon).toContain("renderAgentCommandHelp('claude')")
  expect(daemon).toContain("renderAgentCommandHelp('codex')")
})



test('command parsing helpers are shared and behavior-tested', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("import { agentCommandBodyAfterPrefix, formatParsedAgentCommand, parseAgentCommandArgs, parseAgentCommandName } from './commands.js'")
  expect(daemon).toContain('const commandVerb = parseAgentCommandName(normalizedCommand)')
  expect(daemon).toContain("const cxSub = agentCommandBodyAfterPrefix(c, 'cx')")
  expect(daemon).not.toContain('function parseAgentCommandName(rawCommand: string): string')
})

test('Codex worktree warnings redact spawn errors before channel send', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('failed to create Codex worktree; running in room directory (${errorMessage(err)})')
  expect(daemon).not.toContain('failed to create Codex worktree; running in room directory (${err instanceof Error ? err.message : String(err)})')
})

test('daemon agent-facing tool errors use shared redaction helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("sendToLive(route.responseUuid, { type: 'tool_error', callId: msg.callId, error: errorMessage(err) })")
  expect(daemon).toContain('const message = redactSensitiveText(event.error)')
  expect(daemon).toContain('formatAgentReply(event.session.kind, `❌ ${message}`)')
  expect(daemon).toContain('const opts = event.channelKey === ck && event.threadId ? { replyTo: event.threadId, broadcast: true } : undefined')
  expect(daemon).not.toContain("sendToLive(uuid, { type: 'tool_error', callId: msg.callId, error: (err as Error).message })")
})

test('daemon user-visible raw errors use shared redaction helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("import { errorMessage, redactSensitiveText } from './redact.js'")
  expect(readFileSync('redact.ts', 'utf8')).toContain('export function errorMessage(err: unknown): string')
  expect(daemon).toContain('❌ Failed to send turn: ${errorMessage(err)}')
  expect(daemon).toContain('❌ Command failed: ${errorMessage(err)}')
  expect(daemon).toContain('⚠️ Failed to send input to Codex: ${errorMessage(err)}')
  expect(daemon).toContain('⚠️ Failed to resolve Codex request: ${errorMessage(err)}')
  expect(daemon).toContain('error: errorMessage(err)')
  expect(daemon).not.toContain('❌ Command failed: ${(err as Error).message}')
  expect(daemon).not.toContain('⚠️ Failed to resolve Codex request: ${(err as Error).message}')
})

test('Codex app-server exit failures include recent stderr tail', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  const redact = readFileSync('redact.ts', 'utf8')
  expect(redact).toContain('export function redactSensitiveText')
  expect(redact).toContain('x(?:ox[baprs]|app)-')
  expect(redact).toContain('github_pat_')
  expect(redact).toContain('gh[pousr]_')
  expect(redact).toContain('authorization\\s*:\\s*bearer')
  expect(client).toContain('export function appServerExitErrorMessage')
  expect(client).toContain('private stderrLines: string[] = []')
  expect(client).toContain('this.stderrLines.push(trimmed)')
  expect(client).toContain('if (this.stderrLines.length > 10)')
  expect(client).toContain('new Error(appServerExitErrorMessage(code, signal, this.stderrLines))')
  expect(client).toContain('redactSensitiveText(line.trim())')
})

test('Codex startup failures are surfaced with actionable room-visible detail', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('type SpawnResult = { ok: boolean; uuid: string; error?: string }')
  expect(daemon).toContain('function summarizeAgentStartError')
  expect(daemon).toContain('OPENAI_API_KEY|api key|auth|login')
  expect(daemon).toContain('return spawnCodexAppServer(uuid, cwd, nativeSessionId, options)')
  expect(daemon).toContain('return { ok: false, uuid, error: errorMessage(err) }')
  expect(daemon).toContain("formatAgentStartFailure(runtime, 'start', result.error)")
  expect(daemon).toContain("formatAgentStartFailure(runtime, 'resume', error)")
  expect(daemon).not.toContain('formatAgentReply(runtime, `❌ Failed to start ${agentName(runtime)} session.`)')
  expect(daemon).not.toContain('formatAgentReply(runtime, `❌ Failed to resume ${agentName(runtime)} session.`)')
})

test('Codex help and model preference do not require starting a slot', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const modelFastPath = daemon.indexOf("runtime === 'codex' && commandVerb === 'model'")
  const startPath = daemon.indexOf('const uuid = await ensureRoomAgentReady', daemon.indexOf('async function deliverAgentCommand'))
  expect(modelFastPath).toBeGreaterThan(-1)
  expect(startPath).toBeGreaterThan(-1)
  expect(modelFastPath).toBeLessThan(startPath)
  expect(daemon).toContain('configuredCodexModel')
})






test('binding helpers are shared and behavior-tested', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const bindings = readFileSync('bindings.ts', 'utf8')
  const state = readFileSync('state.ts', 'utf8')
  expect(daemon).toContain("import { AGENT_RUNTIMES, bindingAuthorizedRoomsForSession, bindingSessionEntries, bindingsFromJson, isAgentRuntimeKind, keepAgentModelMeta, normalizeBinding as normalizeBindingValue")
  expect(daemon).toContain("import { codexPendingRequestsFromJson, persistedCodexPendingRequests, readJsonValueFile, stringRecord, transcriptDeliveriesFromJson")
  expect(daemon).toContain('return normalizeBindingValue(value, DEFAULT_AGENT_RUNTIME)')
  expect(daemon).toContain('return serializeBindingValue(binding, DEFAULT_AGENT_RUNTIME)')
  expect(daemon).toContain('return bindingsFromJson(readJsonValueFile(BINDINGS_FILE))')
  expect(bindings).toContain('export function bindingsFromJson(value: unknown): Record<string, ChannelBinding>')
  expect(bindings).toContain('export function normalizeBinding')
  expect(bindings).toContain('export function serializeBinding')
  expect(bindings).toContain('export function keepAgentModelMeta')
  expect(bindings).toContain('export function bindingSessionEntries')
  expect(bindings).toContain('const sessions: Partial<Record<AgentRuntimeKind, string>> = {}')
  expect(bindings).toContain('const agentMeta: Partial<Record<AgentRuntimeKind, AgentSlotMeta>> = {}')
  expect(bindings).not.toContain('Object.fromEntries(Object.entries(binding.sessions)')
  expect(bindings).not.toContain('Object.fromEntries(Object.entries(binding.agentMeta)')
  expect(bindings).toContain("export const AGENT_RUNTIMES = ['claude', 'codex'] as const satisfies readonly AgentRuntimeKind[]")
  expect(bindings).toContain('export function isAgentRuntimeKind(value: unknown): value is AgentRuntimeKind')
  expect(bindings).toContain('return isAgentRuntimeKind(value) ? value : undefined')
  expect(bindings).not.toContain('AGENT_RUNTIMES.includes(value as AgentRuntimeKind)')
  expect(daemon).toContain('AGENT_RUNTIMES.map')
  expect(daemon).toContain('const fallbackRuntime = AGENT_RUNTIMES.find(r => !!binding.sessions[r])')
  expect(daemon).toContain('if (fallbackRuntime) binding.active = fallbackRuntime')
  expect(daemon).toContain('for (const runtime of AGENT_RUNTIMES)')
  expect(daemon).toContain('isAgentRuntimeKind')
  expect(daemon).toContain('const DEFAULT_AGENT_RUNTIME: AgentRuntimeKind = (() => {')
  expect(daemon).not.toContain('})() as AgentRuntimeKind')
  expect(daemon).toContain('function splitRuntimePayload(value: string, fallback?: AgentRuntimeKind)')
  expect(daemon).toContain('function parseRuntimePayload(value: string, fallback?: AgentRuntimeKind)')
  expect(daemon).toContain('const { runtime: parsedRuntime, payload } = splitRuntimePayload(value)')
  expect(daemon).toContain('const parsed = parseRuntimePayload(rest, DEFAULT_AGENT_RUNTIME)')
  expect(daemon).toContain('function parseOptionalRuntimeSuffix(action: string, prefix: string): AgentRuntimeKind | undefined | null')
  expect(daemon).toContain("const runtimeSuffix = parseOptionalRuntimeSuffix(action, 'search')")
  expect(daemon).toContain("const runtimeSuffix = parseOptionalRuntimeSuffix(action, 'recentdirs')")
  expect(daemon).toContain("const runtimeSuffix = parseOptionalRuntimeSuffix(action, 'resume')")
  expect(daemon).toContain('await sendPicker(ck, 0, runtimeSuffix)')
  expect(daemon).toContain('if (runtimeSuffix === null) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain('} else {\n        await sendInvalidButtonMessage(ck)\n      }\n    } else {\n      await sendInvalidButtonMessage(ck)\n    }')
  expect(daemon).not.toContain("['claude', 'codex'] as AgentRuntimeKind[]")
  expect(daemon).not.toContain('action.slice(7) as AgentRuntimeKind')
  expect(daemon).not.toContain('action.slice(11) as AgentRuntimeKind')
  expect(daemon).not.toContain("const runtimeToken = action.startsWith('search:') ? action.slice(7) : undefined")
  expect(daemon).not.toContain("const runtimeToken = action.startsWith('recentdirs:') ? action.slice(11) : undefined")
  expect(daemon).not.toContain('m?.[1] as AgentRuntimeKind')
  expect(daemon).not.toContain('runtimeMatch?.[1] as AgentRuntimeKind')
  expect(daemon).toContain('for (const entry of bindingSessionEntries(binding))')
  expect(daemon).not.toContain('Object.entries(binding.sessions) as Array<[AgentRuntimeKind, string | undefined]>')
  expect(daemon).toContain('const findNewest = (): TranscriptInfo | null => {')
  expect(daemon).toContain('const found = findNewest()')
  expect(daemon).not.toContain('const found = newest as TranscriptInfo | null')
  expect(state).toContain('export function readJsonValueFile(path: string): unknown')
  expect(state).toContain('export function stringRecord(value: unknown): Record<string, string>')
  expect(state).toContain('const strings = [...new Set(value.filter')
  expect(state).toContain('function finiteNumber(value: unknown): number | undefined')
  expect(state).toContain('export function codexPendingRequestsFromJson(value: unknown): Map<string, StoredCodexPendingRequest>')
  expect(state).toContain('function jsonRecord(value: unknown): Record<string, unknown> | undefined')
  expect(state).toContain('const params = jsonRecord(item?.params)')
  expect(state).toContain('const createdAt = finiteNumber(item?.createdAt)')
  expect(state).toContain('const messageId = stringValue(item?.messageId)')
  expect(state).toContain('const messageIds = stringList(item?.messageIds)')
  expect(state).toContain('const threadId = stringValue(item?.threadId)')
  expect(state).not.toContain('stringValue(item.messageId) ? { messageId: stringValue(item.messageId) }')
  expect(state).not.toContain('stringList(item.messageIds) ? { messageIds: stringList(item.messageIds) }')
  expect(state).toContain('export function transcriptDeliveriesFromJson(value: unknown): StoredTranscriptDeliveries')
  expect(state).toContain('const ts = finiteNumber(entry?.ts)')
  expect(daemon).toContain('return transcriptDeliveriesFromJson(readJsonValueFile(TRANSCRIPT_DELIVERY_FILE))')
  expect(daemon).toContain('type StoredCodexSession = { transcriptPath?: string; nativeSessionId?: string; cwd?: string; mtime: number }')
  expect(daemon).toContain('const legacy = stringRecord(raw)')
  expect(daemon).toContain('return Object.fromEntries(Object.entries(legacy).map')
  expect(daemon).toContain('return codexPendingRequestsFromJson(readJsonValueFile(CODEX_PENDING_REQUESTS_FILE))')
  expect(daemon).not.toContain('as Record<string, PendingCodexRequest>')
  expect(daemon).not.toContain("try { return JSON.parse(readFileSync(TRANSCRIPT_DELIVERY_FILE, 'utf8')) }")
  expect(daemon).not.toContain("try { return JSON.parse(readFileSync(BINDINGS_FILE, 'utf8')) }")
})
test('README uses room and agent slot terminology for spawned sessions', () => {
  const readme = readFileSync('README.md', 'utf8')
  expect(readme).toContain('Claude agent slot sessions get these tools')
  expect(readme).toContain('Codex agent slot sessions receive the same MCP server')
  expect(readme).toContain('Daemon-spawned Claude agent slot sessions load the plugin')
  for (const stale of ['CC sub-sessions', 'sub-sessions the daemon spawns', 'Claude Code sessions get these tools']) {
    expect(readme).not.toContain(stale)
  }
})

test('room and slash status messages use agent slot terminology and identity', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('`⏳ ${agentName(runtime)} agent slot session starting up.`')
  expect(daemon).toContain('exitedPaneSummary(uuid, paneStatus)')
  expect(daemon).toContain("formatAgentReply('codex', '⏳ Codex app-server session starting up.')")
  expect(daemon).toContain("formatAgentReply('claude', '⏳ Claude session starting up.')")
  expect(daemon).toContain('agent slot session in this room')
  expect(daemon).toContain('agent slot already has active session')
  expect(daemon).toContain("formatAgentReply('claude', `Claude agent slot session")
  expect(daemon).toContain("formatAgentReply('claude', `⚡ Sent")
  const summaryBlock = daemon.slice(daemon.indexOf('function roomSummary'), daemon.indexOf('function runtimeForUuid'))
  expect(summaryBlock).toContain('const alive = liveEntryNeedsRespawn(uuid) ?')
  expect(summaryBlock).not.toContain("const alive = live.has(uuid) ? 'active' : 'suspended'")
  for (const stale of ['session on this channel', 'Channel bound to active session', 'No Claude session on this channel']) {
    expect(daemon).not.toContain(stale)
  }
})

test('successful agent lifecycle starts announce ready-to-use status', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function formatAgentReadyNotice(runtime: AgentRuntimeKind, uuid: string): string')
  expect(daemon).toContain('started and ready to use.')
  expect(daemon).toContain('await sendChannelNotice(ck, formatAgentReadyNotice(runtime, sessionId), undefined, `${runtime} ready notice`)')
  expect(daemon).toContain('await sendChannelNotice(ck, formatAgentReadyNotice(runtime, uuid), undefined, `${runtime} resume ready notice`)')
  expect(daemon).toContain('void sendChannelNotice(ch, formatAgentReadyNotice(runtimeForUuid(uuid), uuid), undefined, \'session ready\')')
  expect(daemon).toContain('announcedReady')
})


test('CCM room command docs, help, and Telegram hints stay aligned', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  for (const command of ['ccm default claude|codex', 'ccm agents', 'ccm route', 'ccm new [agent]', 'ccm start [agent]', 'ccm find <query>', 'ccm help']) {
    expect(readme).toContain(command)
    expect(daemon).toContain(command)
  }
  expect(readme).toContain('ccm resume [agent\\|id]')
  expect(readme).toContain('ccm stop [agent\\|id]')
  expect(daemon).toContain('ccm resume [agent\\\\|id]')
  expect(daemon).toContain('ccm stop [agent\\\\|id]')
  for (const command of ['ccm', 'ccm_new', 'ccm_agents', 'ccm_route', 'ccm_resume', 'ccm_stop', 'ccm_help', 'ccm_find']) {
    expect(telegram).toContain(`command: '${command}'`)
  }
  expect(daemon).toContain('Browse or resume agent sessions into this room')
  expect(daemon).not.toContain('Browse & rebind a native session')
})

test('new-session buttons and explicit commands start sessions instead of reopening the picker', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("const newRuntimeM = args.match(/^(?:new|start)\\s+(claude|cc|codex|cx)$/i)")
  expect(daemon).toContain("if (/^(?:new|start)$/i.test(args)) return { t: 'new', cwd: DEFAULT_CWD, runtime, explicitStart: true }")
  expect(daemon).toContain("if (cmd.explicitStart) {")
  expect(daemon).toContain('await startNew(ck, roomCwd(ck), runtime)')
  expect(daemon).toContain("text: 'ccm start'")
  expect(daemon).toContain('text: `ccm start ${action.slice(4)}`')
  expect(daemon).toContain('text: `ccm start ${runtime}`')
  expect(daemon).not.toContain("text: 'ccm', messageId: '', meta: {} })")
  expect(daemon).not.toContain('text: `ccm ${action.slice(4)}`')
})

test('Telegram command registration failures are logged', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain('setMyCommands')
  expect(telegram).toContain('telegram: bot commands registered')
  expect(telegram).toContain('telegram: bot commands registration failed: ${errorMessage(err)}')
  expect(telegram).not.toContain("} catch {}\n\n    this.polling = true")
})

test('Telegram CCM autocomplete uses multi-agent room terminology', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  for (const command of ['ccm', 'ccm_new', 'ccm_agents', 'ccm_route', 'ccm_resume', 'ccm_stop', 'ccm_help', 'ccm_find']) {
    expect(telegram).toContain(`command: '${command}'`)
  }
  expect(telegram).toContain('Start a fresh agent session')
  expect(telegram).toContain('Bind room directory')
  expect(telegram).toContain('Show room agent slots')
  expect(telegram).toContain('Explain default routing')
  expect(telegram).toContain('agent sessions')
  expect(telegram).toContain('agent slot')
  expect(telegram).not.toContain('New CC session')
  expect(telegram).not.toContain('Disconnect / stop session')
})

test('Claude command docs and Telegram hints match supported command spec', () => {
  const claude = readFileSync('agents/claude/channel-driver.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  for (const name of ['ss', 'nav', 'transcript', 'status', 'compact', 'cancel', 'model']) {
    expect(claude).toContain(`name: '${name}'`)
    expect(readme).toContain(`/cc ${name}`)
  }
  expect(daemon).toContain("if (/^status$/i.test(sub)) return { t: 'agent_command', runtime: 'claude', command: '/status' }")
  for (const command of ['cc_help', 'cc_ss', 'cc_nav', 'cc_transcript', 'cc_status', 'cc_model', 'cc_compact', 'cc_cancel', 'cc_stop']) {
    expect(telegram).toContain(`command: '${command}'`)
  }
  for (const stale of ["command: 'cc_cost'", "command: 'cc_exit'", "command: 'cc_resume'", '/cc exit']) {
    expect(telegram + readme).not.toContain(stale)
  }
})



test('Agent running turns expose manual interrupt controls', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('async function interruptAgentTurn')
  expect(daemon).toContain("data: `cmd:interrupt:${runtime}`")
  expect(daemon).toContain("action === 'interrupt' || action.startsWith('interrupt:')")
  expect(daemon).toContain("await interruptAgentTurn(ck, runtimeSuffix ?? bindingRuntime(ck), interaction.messageId)")
  expect(daemon).toContain("if (/^(cancel|stop|interrupt)$/i.test(sub)) return { t: 'agent_command', runtime: 'claude', command: '/cancel' }")
  expect(daemon).toContain("return interruptAgentTurn(ck, runtime, msg.replyToId ?? msg.messageId)")
})

test('Codex command docs, Telegram hints, and driver spec stay aligned', () => {
  const codex = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  for (const name of ['ss', 'nav', 'transcript', 'status', 'compact', 'cancel', 'mcp', 'model', 'goal', 'raw']) {
    expect(codex).toContain(`name: '${name}'`)
    expect(readme).toContain(`/cx ${name}`)
  }
  for (const command of ['cx_help', 'cx_ss', 'cx_nav', 'cx_transcript', 'cx_status', 'cx_model', 'cx_goal', 'cx_mcp', 'cx_compact', 'cx_stop', 'cx_cancel']) {
    expect(telegram).toContain(`command: '${command}'`)
  }
  expect(readme).toContain('/cx stop` / `/cx cancel')
  expect(codex).toContain("aliases: ['stop', 'interrupt']")
  expect(readme).toContain('/cx raw /command ...')
  expect(codex).toContain('rawPassthroughWarning')
})

test('Telegram autocomplete only advertises supported Codex commands', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  for (const command of ['cx_help', 'cx_ss', 'cx_nav', 'cx_transcript', 'cx_status', 'cx_model', 'cx_goal', 'cx_mcp', 'cx_compact', 'cx_stop', 'cx_cancel']) {
    expect(telegram).toContain(`command: '${command}'`)
  }
  expect(telegram).toContain('Codex: snapshot + pending buttons')
  expect(telegram).toContain('Codex: pending N action/answer')
  expect(telegram).not.toContain("command: 'cx_memory'")
})


test('Agent turns include recent peer context pointers without daemon memory logs', () => {
  const types = readFileSync('agents/types.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  const server = readFileSync('server.ts', 'utf8')
  expect(types).toContain("kind?: 'midturn' | 'final' | 'reply_tool' | 'poll'")
  expect(server).toContain('previews only')
  expect(server).toContain('referenceHint')
  expect(server).toContain('逐字')
  expect(daemon).toContain('RECENT_AGENT_REPLIES_FILE')
  expect(daemon).toContain('function loadRecentAgentReplies')
  expect(daemon).toContain('function recentPeerReplyPointers')
  const peerPointers = readFileSync('agents/peer-pointers.ts', 'utf8')
  expect(peerPointers).toContain('const sameThreadDelta')
  expect(peerPointers).toContain('likelyReference: true')
  expect(peerPointers).toContain('referenceHintForPeerPointer')
  expect(peerPointers).toContain('kind: item.kind')
  expect(peerPointers).toContain('source: item.source')
  expect(daemon).not.toContain('text.length <= 4000')
  expect(daemon).not.toContain('text?: string; createdAt')
  expect(daemon).toContain("rememberAgentReplyPointer(event.session.kind, ck, event.threadId ?? messageId, messageId, text, 'midturn', 'event')")
  expect(daemon).toContain("rememberAgentReplyPointer(event.session.kind, ck, event.threadId ?? messageId, messageId, text, 'final', 'event')")
  expect(daemon).toContain("rememberAgentReplyPointer(runtimeForUuid(uuid), ck, replyTo ?? ts, ts, text, 'reply_tool', 'reply_tool')")
  expect(daemon).toContain('PEER_REPLY_INJECTION_MAX_CHARS')
  expect(daemon).toContain('AGENT_CONTEXT_TURN_MAX_CHARS')
  const formatter = readFileSync('agents/turn-format.ts', 'utf8')
  expect(daemon).toContain('function truncateAgentContextTurnText')
  expect(daemon).toContain('truncateAgentContextTurnTextToMax')
  expect(formatter).toContain('function escapedCurrentMessageBytes')
  expect(formatter).toContain('escaped current-message bytes')
  expect(formatter).toContain('fallbackSuffix')
  expect(daemon).toContain('COLLAB_MAX_HANDOFFS')
  expect(daemon).toContain('function markStaleCollabs')
})

test('Codex app-server approval and sandbox are configurable for trusted rooms', () => {
  const codex = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const config = readFileSync('agents/codex/config.ts', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  const env = readFileSync('.env.example', 'utf8')
  expect(config).toContain('export function codexApprovalPolicyFromEnv')
  expect(config).toContain("raw === 'yolo' || raw === 'never'")
  expect(codex).toContain('function codexTurnSandboxPolicy')
  expect(config).toContain('export function codexSandboxFromEnv')
  expect(codex).toContain("return { type: 'dangerFullAccess' }")
  expect(codex).toContain('approvalPolicy: runtime.config.approvalPolicy')
  expect(readme).toContain('CCM_CODEX_APPROVAL_POLICY')
  expect(readme).toContain('CCM_CODEX_SANDBOX')
  expect(env).toContain('CCM_CODEX_APPROVAL_POLICY=never')
  expect(env).toContain('CCM_CODEX_SANDBOX=danger-full-access')
  expect(codex).not.toContain('CODEX_' + 'YOLO')
})

test('Codex interactive request coverage includes approval, input, and MCP elicitation', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const codexResponse = readFileSync('codex-response.ts', 'utf8')
  for (const method of [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/permissions/requestApproval',
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
    'execCommandApproval',
    'applyPatchApproval',
  ]) expect(codexResponse).toContain(method)
  expect(daemon).toContain('codexApprovalResult')
  expect(daemon).toContain("import { codexApprovalResult, codexOptionInputResult, codexPendingRequestButtons, codexRequestActionAllowed, codexTextResponseResult, summarizeCodexRequest } from './codex-response.js'")
  expect(daemon).toContain('codexTextResponseResult')
  expect(daemon).toContain("Codex option is invalid or expired. Refreshing current Codex pending actions.")
  expect(daemon).toContain("Codex request action is invalid or expired. Refreshing current Codex pending actions.")
  expect(daemon).toContain("Codex request action is malformed. Refreshing current Codex pending actions.")
  expect(daemon).toContain('function codexRequestCallbackCandidates(data: string): CodexRequestCallback[]')
  expect(daemon).toContain('function parseCodexRequestCallbackData(data: string, pending: PendingCodexRequest[])')
  expect(daemon).toContain('const matches = candidates.filter(candidate => pending.some(req => req.requestId === candidate.requestId))')
  expect(daemon).toContain('return matches.length === 1 ? matches[0] : undefined')
  expect(daemon).toContain('const entries = [...pendingCodexRequests.entries()].filter(([, req]) => req.channelKey === ck)')
  expect(daemon).toContain('const parsed = parseCodexRequestCallbackData(data, entries.map(([, req]) => req))')
  expect(daemon).toContain('if (!parsed) {')
  expect(daemon).toContain('parseCodexOptionIndex(parsed.argument)')
  expect(codexResponse).toContain('export function summarizeCodexRequest')
  expect(codexResponse).toContain('export function codexPendingRequestButtons')
  expect(codexResponse).toContain('export function codexApprovalResult(method: string, decision: string, params: Record<string, unknown> = {}): Record<string, unknown> | null')
  expect(codexResponse).toContain("if (!['approve', 'approve_session', 'approve_exec_policy', 'approve_network_policy', 'deny', 'abort'].includes(decision)) return null")
  expect(codexResponse).toContain('function codexAmendmentPayload')
  expect(codexResponse).toContain("recordValue(payload[payloadKey])")
  expect(codexResponse).toContain('Allow Policy')
  expect(codexResponse).toContain('Allow Network')
  expect(codexResponse).toContain("request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval' || request.method === 'execCommandApproval' || request.method === 'applyPatchApproval'")
  expect(codexResponse).toContain('export function codexOptionInputResult(params: Record<string, unknown>, optionIndex: number): Record<string, unknown> | null')
  expect(codexResponse).toContain('if (!Number.isSafeInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) return null')
  expect(codexResponse).toContain("const label = typeof option?.label === 'string' ? option.label : ''")
  expect(codexResponse).toContain("const label = typeof record?.label === 'string' ? record.label : ''")
  expect(codexResponse).not.toContain('String(record?.label')
  expect(codexResponse).not.toContain('String(options[optionIndex]?.label')
  expect(codexResponse).not.toContain('String(option.label')
  expect(codexResponse).toContain('const options = codexQuestionOptions({ questions: [question] })')
  expect(codexResponse).toContain('function questionId(question: Record<string, unknown> | undefined, fallback: string): string')
  expect(codexResponse).toContain("function questionText(value: unknown, fallback = ''): string")
  expect(codexResponse).toContain('function fallbackText(value: unknown, fallback: string): string')
  expect(codexResponse).not.toContain('String(question.header')
  expect(codexResponse).not.toContain('String(question.question')
  expect(codexResponse).not.toContain('String(question.id')
  expect(codexResponse).not.toContain('String(question?.id')
  expect(codexResponse).not.toContain('String(params.serverName')
  expect(codexResponse).not.toContain('const mode = String(params.mode')
  expect(codexResponse).not.toContain('const mode = String(pending.params.mode')
  expect(codexResponse).toContain('function answerString(value: unknown): string')
  expect(codexResponse).toContain('value.map(answerString)')
  expect(codexResponse).not.toContain('value.map(String)')
  expect(codexResponse).not.toContain('[String(value)]')
  expect(codexResponse).toContain("return new Set(values.filter((value): value is string => typeof value === 'string' && !!value))")
  expect(codexResponse).not.toContain('values.map(value => String(value))')
  expect(daemon).not.toContain('function parseJsonObject(text: string)')
  expect(daemon).toContain('pendingCodexRequestForReply')
  expect(daemon).toContain('savePendingCodexRequests')
  expect(daemon).toContain("event.type === 'server_request'")
  expect(daemon).toContain('await handleCodexServerRequest(event.session, event.request)')
  expect(codexResponse).toContain("codex_approval_kind === 'mcp_tool_call'")
  expect(codexResponse).toContain('requests tool approval')
  expect(codexResponse).toContain("action: denied ? 'decline' : abort ? 'cancel' : 'accept'")
  expect(codexResponse).toContain('content: denied || abort ? null : {}')
  expect(codexResponse).toContain('Reply in plain English; JSON is optional if the request needs structured data')
  expect(codexResponse).toContain('function numericFormValue')
  expect(codexResponse).toContain('if (!trimmed) return trimmed')
  expect(codexResponse).toContain('if (integer && !Number.isInteger(value)) return trimmed')
  expect(codexResponse).not.toContain("return { [key]: Number(text.trim()) }")
  expect(codexResponse).not.toContain('const numberValue = Number(text.trim())')
  expect(codexResponse).toContain("return { action: 'accept', content: { response: text.trim() }, value: text.trim() }")
  expect(codexResponse).toContain('export function parseJsonObject(text: string): Record<string, unknown> | null')
  expect(codexResponse).toContain('let parsed: unknown')
  expect(daemon).not.toContain('needs unsupported interactive input')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(driver).toContain('isMcpToolApproval')
  expect(driver).toContain('MCP tool approval')
})


test('Codex pending request persistence omits sensitive params', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const state = readFileSync('state.ts', 'utf8')
  expect(daemon).toContain("import { codexPendingRequestsFromJson, persistedCodexPendingRequests, readJsonValueFile")
  expect(daemon).toContain('JSON.stringify(persistedCodexPendingRequests(pendingCodexRequests), null, 2)')
  expect(readFileSync('state.ts', 'utf8')).toContain('const { params: _params, ...persisted } = request')
  expect(daemon).not.toContain('JSON.stringify(Object.fromEntries(pendingCodexRequests), null, 2)')
  expect(state).toContain('const params = jsonRecord(item?.params) ?? {}')
})

test('Codex pending requests are channel-scoped but resolve globally per request', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const codexResponse = readFileSync('codex-response.ts', 'utf8')
  expect(daemon).toContain('function codexRequestKey(sessionId: string, requestId: string, channelKey: string)')
  expect(daemon).toContain('return `${sessionId}:${requestId}:${channelKey}`')
  expect(daemon).toContain("const channels = routableChannelsForUuid(session.sessionId, 'codex').filter(ck => !!adapterFor(ck))")
  expect(daemon).toContain('daemon: Codex request ${request.requestId}')
  expect(daemon).toContain('CCM could not deliver this Codex request to any channel.')
  expect(daemon).toContain('CCM failed to deliver this Codex request to the configured channels.')
  expect(daemon).toContain('failed to reject undeliverable Codex request')
  expect(daemon).toContain('sendChannelNotice(ck, text, opts, `permission request ${request_id}`)')
  expect(daemon).toContain("const opts = { ...(request.threadId ? { replyTo: request.threadId, broadcast: true } : {}), ...adapter.renderButtons(summary.buttons) }")
  expect(daemon).toContain('...(request.threadId ? { threadId: request.threadId } : {})')
  expect(daemon).toContain("const sentId = await sendChannelNotice(ck, formatAgentReply('codex', summary.text), opts, `Codex request ${request.requestId}`)")
  expect(daemon).toContain('send failed for ${ck}: ${errorMessage(err)}')
  expect(daemon).toContain('delivered no message id for channel=')
  expect(codexResponse).not.toContain('**🟢 Codex**')
  expect(codexResponse).not.toContain('**🟢 Codex MCP**')
  expect(daemon).toContain('delivered = true')
  expect(daemon).toContain('if (!sentId) {')
  expect(daemon).toContain('pending reply binding skipped')
  expect(daemon).toContain('setPendingCodexRequest(codexRequestKey(session.sessionId, request.requestId, ck)')
  expect(daemon).toContain('messageId: sentId')
  expect(daemon).toContain('messageIds: [sentId]')
  expect(daemon).toContain('const entries = [...pendingCodexRequests.entries()].filter(([, req]) => req.channelKey === ck)')
  expect(daemon).toContain('entries.find(([, req]) => req.requestId === requestId)')
  expect(daemon).not.toContain("const parts = data.split(':')")
  expect(daemon).not.toContain('const requestId = parts[1]')
  expect(daemon).not.toContain('const decision = parts[2]')
  expect(daemon).not.toContain("const lastSep = rest.lastIndexOf(':')")
  expect(daemon).not.toContain("const decisionSep = requestId.lastIndexOf(':')")
  expect(daemon).toContain('req.sessionId !== sessionId || req.requestId !== requestId')

  const pruneBody = daemon.slice(daemon.indexOf('function prunePendingCodexRequests(): void'), daemon.indexOf('function auditEvent'))
  expect(pruneBody).toContain('let changed = false')
  expect(pruneBody).toContain('pendingCodexRequests.delete(key)')
  expect(pruneBody).toContain('if (changed) savePendingCodexRequests()')
  expect(pruneBody).not.toContain('deletePendingCodexRequest(key)')
  expect(daemon).toContain('Failed to send input to Codex')
  expect(daemon).toContain('Failed to resolve Codex request')
  expect(daemon).toContain('deletePendingCodexRequestsForRequest(pending.sessionId, pending.requestId)')
  const requestHandler = daemon.slice(daemon.indexOf('async function handleCodexServerRequest'), daemon.indexOf('function pendingCodexRequestForReply'))
  expect(requestHandler).not.toContain('pending.messageId = sentId')
  expect(requestHandler).not.toContain('setPendingCodexRequest(pendingKey, pending)')
})

test('Codex driver fixtures avoid any escape hatches', () => {
  const fixtures = readFileSync('test/codex-driver-fixtures.test.ts', 'utf8')
  expect(fixtures).toContain('type CodexDriverHarness = {')
  expect(fixtures).toContain('type TestCodexRuntime = {')
  expect(fixtures).toContain('params: JsonObject')
  expect(fixtures).not.toMatch(/\bany\b/)
  expect(fixtures).not.toContain('as any')
})

test('Codex app-server smoke avoids any escape hatches', () => {
  const smoke = readFileSync('test/codex-app-server-smoke.ts', 'utf8')
  expect(smoke).toContain("import { CodexAppServerClient, jsonObject } from '../agents/codex/app-server-client.ts'")
  expect(smoke).toContain('const threadResult = jsonObject(thread.result)')
  expect(smoke).not.toContain('as any')
})

test('Codex app-server client drains pending requests on stop and exit', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  expect(client).toContain('private rejectPending(err: Error): void')
  expect(client).toContain('const pending = [...this.pending.values()]')
  expect(client).toContain('this.pending.clear()')
  expect(client).toContain('clearTimeout(item.timer)')
  expect(client).toContain('item.reject(err)')
  expect(client).toContain("this.rejectPending(new Error('codex app-server stopped'))")
  expect(client).toContain('this.rejectPending(new Error(appServerExitErrorMessage(code, signal, this.stderrLines)))')
  expect(client).not.toContain('for (const [, pending] of this.pending)')
})

test('Codex app-server stop logs SIGKILL failures through redacted stderr callback', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  const block = client.slice(client.indexOf('async stop(): Promise<void>'), client.indexOf('request(method: string'))
  expect(block).toContain("proc.kill('SIGTERM')")
  expect(block).toContain("proc.kill('SIGKILL')")
  expect(block).toContain('codex app-server SIGKILL failed: ${redactSensitiveText')
  expect(block).toContain('err instanceof Error ? err.message : String(err)')
  expect(block).not.toContain("try { proc.kill('SIGKILL') } catch {}; resolve()")
})

test('Codex app-server startup cleans up shared client if startup fails', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const ensureSharedClient = driver.slice(driver.indexOf('private async ensureSharedClient'), driver.indexOf('private async materializeThread'))
  expect(ensureSharedClient).toContain('if (this.client) return this.client')
  expect(ensureSharedClient).toContain('if (this.clientStart) return await this.clientStart')
  expect(ensureSharedClient).toContain('await client.start()')
  expect(ensureSharedClient).toContain('this.client = client')
  expect(ensureSharedClient).toContain('this.clientStart = undefined')
  expect(ensureSharedClient).toContain('await client.stop().catch(stopErr => this.opts.log?.(`')
  expect(ensureSharedClient).toContain('codex app-server cleanup failed after startup error')
  expect(ensureSharedClient).toContain('throw err')
})

test('Codex app-server config args are passed before the app-server subcommand', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  expect(client).toContain("const args = [...(this.opts.configArgs ?? []), 'app-server', '--listen'")
  expect(client).not.toContain("'app-server', '--listen', listen === 'websocket' ? 'ws://127.0.0.1:0' : 'stdio://', ...(this.opts.configArgs ?? [])")
})

test('Codex app-server writes fail visibly instead of leaving requests pending', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  const requestBlock = client.slice(client.indexOf('request(method: string'), client.indexOf('notify(method: string'))
  const writeBlock = client.slice(client.indexOf('private write(payload'), client.indexOf('private handleLine'))
  expect(requestBlock).toContain('const writeErr = this.write(payload, method)')
  expect(requestBlock).toContain('if (writeErr)')
  expect(requestBlock).toContain('this.pending.delete(id)')
  expect(requestBlock).toContain('clearTimeout(timer)')
  expect(requestBlock).toContain('reject(writeErr)')
  expect(writeBlock).toContain('private write(payload: JsonObject, context: string): Error | undefined')
  expect(writeBlock).toContain('codex app-server write skipped for ${context}: process is not running')
  expect(writeBlock).toContain('codex app-server write failed for ${context}: ${redactSensitiveText')
  expect(writeBlock).toContain('proc.stdin.write(JSON.stringify(payload)')
  expect(writeBlock).toContain('return undefined')
  expect(writeBlock).not.toContain('this.proc?.stdin.write(JSON.stringify(payload)')
  expect(writeBlock).not.toContain('return proc.stdin.write')
})

test('Codex app-server response parsing uses typed helpers', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  expect(driver).toContain('function jsonObjectArray(value: unknown): JsonObject[]')
  expect(driver).toContain('return value.flatMap(item =>')
  expect(driver).toContain('function jsonObjectOrEmpty(value: unknown): JsonObject')
  expect(driver).toContain('export function codexResponseObject(value: unknown, key: string): JsonObject | undefined')
  expect(driver).toContain('export function codexResponseArray(value: unknown, key: string): JsonObject[]')
  expect(driver).toContain('export function codexNativeTurnId(value: unknown, fallback: string): string')
  expect(driver).toContain('const nativeTurnId = codexNativeTurnId(response, input.turn.turnId)')
  expect(driver).toContain("const data = codexResponseArray(response, 'data')")
  expect(driver).toContain("if (typeof msg.method !== 'string' || typeof msg.id !== 'number' || !Number.isSafeInteger(msg.id)) return")
  expect(client).toContain('export function parseAppServerMessage(line: string): JsonObject | undefined')
  expect(client).toContain('let parsed: unknown')
  expect(client).toContain('const msg = parseAppServerMessage(line)')
  expect(client).toContain('export function appServerMalformedLineMessage(line: string): string')
  expect(client).toContain('codex app-server ignored malformed stdout line: ${redactSensitiveText(line).slice(0, 500)}')
  expect(client).toContain('this.opts.stderr?.(appServerMalformedLineMessage(line))')
  expect(client).toContain('const errorMessage = appServerErrorMessage(msg.error)')
  expect(client).toContain('export type JsonObject = { [key: string]: Json | undefined }')
  expect(client).toContain('return redactSensitiveText(raw)')
  expect(driver).toContain("import { CodexAppServerClient, jsonObject, parseAppServerMessage, type JsonObject } from './app-server-client.js'")
  expect(driver).toContain("import { errorMessage, redactSensitiveText } from '../../redact.js'")
  expect(driver).toContain('const params = jsonObject(msg.params)')
  expect(driver).toContain('const requestParams = params ?? {}')
  expect(driver).toContain('const item = jsonObject(params?.item)')
  expect(driver).toContain('const turn = jsonObject(params?.turn)')
  expect(driver).toContain('const error = jsonObject(turn?.error)')
  expect(driver).toContain('const meta = jsonObject(params._meta) ?? jsonObject(params.meta)')
  expect(driver).toContain('function codexJsonErrorMessage(value: unknown): string')
  expect(driver).toContain('if (value instanceof Error) return errorMessage(value)')
  expect(driver).toContain('return { error: codexJsonErrorMessage(error) }')
  expect(driver).toContain('return error === undefined ? undefined : codexJsonErrorMessage(error)')
  expect(driver).toContain('.catch(codexErrorResponse)')
  expect(driver).not.toContain('redactSensitiveText(String(error))')
  expect(driver).not.toContain('response.result as JsonObject')
  expect(driver).not.toContain('threadWithTurnsRes.result as JsonObject')
  expect(driver).not.toContain('as JsonObject[]')
  expect(driver).not.toContain('value.filter((item): item is JsonObject => !!jsonObject(item))')
  expect(driver).not.toContain('.result as JsonObject')
  expect(driver).not.toContain('msg.params as JsonObject')
  expect(driver).not.toContain('(params ?? {}) as Record<string, unknown>')
  expect(driver).not.toContain('params?.item as JsonObject')
  expect(driver).not.toContain('params?.turn as JsonObject')
  expect(driver).not.toContain('params?.error as JsonObject')
  expect(driver).not.toContain('params._meta && typeof params._meta')
  expect(driver).not.toContain('as JsonObject | undefined')
  expect(driver).not.toContain('threadWithTurnsRes as JsonObject')
  expect(driver).not.toContain('threadFallbackRes as JsonObject')
  expect(driver).not.toContain('configRes as JsonObject')
  expect(driver).not.toContain('{ error: String(err) } as JsonObject')
  expect(driver).not.toContain('JSON.parse(line)')
  expect(client).not.toContain('let msg: JsonObject')
  expect(client).not.toContain('msg.error as JsonObject')
  expect(client).not.toContain('as Json | undefined')
  expect(client).not.toContain('String(message)')
})




test('plan and task snapshot sends use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const planBlock = daemon.slice(daemon.indexOf('async function publishCodexPlanUpdate'), daemon.indexOf('async function clearAgentTyping'))
  expect(planBlock).toContain('`codex plan ${uuid.slice(0, 8)}`')
  expect(planBlock).toContain('state.messageIds.set(ck, msgId)')
  expect(planBlock).not.toContain('adapter.sendMessage(id, text)')
  expect(planBlock).not.toContain('codex plan send failed')
  const taskBlock = daemon.slice(daemon.indexOf('async function publishTaskSnapshot'), daemon.indexOf('async function pollTaskSnapshot'))
  expect(taskBlock).toContain('`task list ${uuid.slice(0, 8)}`')
  expect(taskBlock).toContain('state.taskMessageIds.set(ck, msgId)')
  expect(taskBlock).not.toContain('adapter.sendMessage(id, text)')
  expect(taskBlock).not.toContain('task list send failed')
})

test('compaction status notices use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const eventBlock = daemon.slice(daemon.indexOf("if (event.type === 'compaction')"), daemon.indexOf("if (event.type === 'server_request')"))
  expect(eventBlock).toContain('`${event.session.kind} compaction event`')
  expect(eventBlock).not.toContain('adapter.sendMessage')
  const completeBlock = daemon.slice(daemon.indexOf('async function sendCompactionComplete'), daemon.indexOf('// UUIDs with a permission request'))
  expect(completeBlock).toContain('`${runtimeForUuid(uuid)} compaction complete`')
  expect(completeBlock).not.toContain('adapter.sendMessage')
  expect(completeBlock).not.toContain('compaction-done msg FAILED')
  const watcherBlock = daemon.slice(daemon.indexOf('COMPACTING_SCREEN_RE.test(content)'), daemon.indexOf('if (entry.compactingActive && COMPACTED_SCREEN_RE.test(content))'))
  expect(watcherBlock).toContain('`${runtimeForUuid(uuid)} compacting screen`')
  expect(watcherBlock).not.toContain('adapter.sendMessage')
  expect(watcherBlock).not.toContain('compacting screen send FAILED')
  const hookBlock = daemon.slice(daemon.indexOf("if (msg.type === 'compact_starting')"), daemon.indexOf("if (msg.type === 'register')"))
  expect(hookBlock).toContain('`${runtimeForUuid(uuid)} compact starting hook`')
  expect(hookBlock).not.toContain('adapter.sendMessage')
  expect(hookBlock).not.toContain('compact_starting send to')
})

test('transcript delivery ledger errors use redacted error messages', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('async function flushTranscriptDelivery'), daemon.indexOf('function queueTranscriptDelivery'))
  expect(body).toContain('errorMessage(err)')
  expect(body).toContain('errorMessage(ledgerErr)')
  expect(body).not.toContain('${ledgerErr}')
})

test('transcript offset alignment logs file close cleanup failures', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('function alignTranscriptOffsetToNextLine'), daemon.indexOf('// ---------------------------------------------------------------------------', daemon.indexOf('function alignTranscriptOffsetToNextLine')))
  expect(body).toContain("logUnexpectedFsReadError('align transcript offset', path, err)")
  expect(body).toContain("logUnexpectedFsCleanupError('close transcript file', path, err)")
  expect(body).not.toContain('} catch {\n    return offset')
  expect(body).not.toContain('if (fh !== null) try { closeSync(fh) } catch {}')
})

test('transcript rendering caps per-entry text to avoid channel floods', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('const TRANSCRIPT_ENTRY_TEXT_LIMIT = 2000')
  expect(daemon).toContain('function truncateTranscriptEntryText(text: string): string')
  expect(daemon).toContain('truncated ${text.length - TRANSCRIPT_ENTRY_TEXT_LIMIT} chars')
  expect(daemon).toContain('truncateTranscriptEntryText(entry.text)')
  expect(daemon).not.toContain('`${entry.role}: ${entry.text}`')
})

test('Codex transcript fallback includes conversation, reasoning, plan, and tool entries', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  for (const role of ["role: 'user'", "role: 'codex'", "role: 'plan'", "role: 'reasoning'", "role: 'tool'"]) {
    expect(driver).toContain(role)
  }
  expect(driver).toContain('readTranscriptRecent')
  expect(driver).toContain('turnThreads')
  expect(driver).toContain('entriesFromTurns')
})



test('transcript fallback read failures are observable without changing fallback behavior', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(daemon).toContain("logUnexpectedFsReadError('read Claude snapshot transcript', path, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Codex transcript logical id', path, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('stat cached Codex transcript', cached, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('stat Codex transcript candidate', path, err)")
  expect(driver).toContain('Codex transcript fallback read failed for ${path}: ${errorMessage(err)}')
  const claudeBody = daemon.slice(daemon.indexOf('function readClaudeTranscriptEntries'), daemon.indexOf('function claudeSnapshot'))
  expect(claudeBody).not.toContain(`} catch {\n    return []`)
  const codexBody = driver.slice(driver.indexOf('private readTranscriptRecent'), driver.indexOf('private snapshotPendingItem'))
  expect(codexBody).not.toContain(`} catch {\n      return []`)
})

test('Codex turn completion clears active state before final or error events', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(driver).toContain('private clearTurnState(runtime: CodexRuntime, nativeTurnId: string): { channelThreadId?: string; channelKey?: string }')
  expect(driver).toContain('runtime.buffers.delete(nativeTurnId)')
  expect(driver).toContain('runtime.turnThreads.delete(nativeTurnId)')
  expect(driver).toContain('runtime.activeTurns.delete(nativeTurnId)')
  expect(driver).toContain('const { channelThreadId, channelKey } = this.clearTurnState(runtime, nativeTurnId)')
  expect(driver).toContain("if (error) {\n        this.emit({ type: 'error'")
  expect(driver).toContain('function codexEventErrorMessage(primary: unknown, fallback: unknown): string')
  expect(driver).toContain('if (primary instanceof Error) return errorMessage(primary)')
  expect(driver).toContain('return codexJsonErrorMessage(primary ?? fallback)')
  expect(driver).toContain('codexEventErrorMessage(error.message, error)')
  expect(driver).toContain('codexEventErrorMessage(error?.message, params ?? msg)')
  expect(driver).not.toContain('redactSensitiveText(String(error.message ?? JSON.stringify(error)))')
  expect(driver).not.toContain('redactSensitiveText(String(error?.message ?? JSON.stringify(params ?? msg)))')
  expect(driver).not.toContain("if (error) {\n        this.emit({ type: 'error', session: runtime.session, turnId, error: String(error.message ?? JSON.stringify(error)) })\n        return\n      }\n      const text = (runtime.buffers.get(nativeTurnId) ?? '').trim()")
})

test('daemon avoids non-null assertions in picker and peer pointer helpers', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function agentPeerPointers')
  expect(daemon).toContain('const sessionId = binding.sessions[kind]')
  expect(daemon).toContain('const group = groups.get(dir) ?? []')
  expect(daemon).toContain('if (!adapter) return')
  expect(daemon).not.toContain('groups.get(dir)!')
  expect(daemon).not.toContain('adapter!.')
  expect(daemon).not.toContain('binding.sessions[kind]!')
})

test('CCM runtime-prefixed screen and nav route to the requested agent', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("| { t: 'screen'; runtime?: AgentRuntimeKind }")
  expect(daemon).toContain("if (/^(screen|ss)$/i.test(args)) return { t: 'screen', runtime }")
  expect(daemon).toContain('sendAgentSnapshot(ck, cmd.runtime ?? bindingRuntime(ck))')
  expect(daemon).toContain('const runtime = cmd.runtime ?? bindingRuntime(ck)')
})

test('directory use callbacks validate readable directories before binding', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function isReadableDirectory(path: string): boolean')
  expect(daemon).toContain('function normalizeRoomCwd(cwd: string): string')
  expect(daemon).toContain('return normalizeRoomCwd(cwd)')
  expect(daemon).toContain('binding.cwd = normalizeRoomCwd(cwd)')
  expect(daemon).toContain('function parseRuntimePayload(value: string, fallback?: AgentRuntimeKind)')
  expect(daemon).toContain('if (!isAgentRuntimeKind(runtimeToken)) return fallback ? { runtime: fallback, payload: value } : undefined')
  expect(daemon).toContain('const parsed = parseRuntimePayload(rest, DEFAULT_AGENT_RUNTIME)')
  expect(daemon).toContain('if (!parsed) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain('if (!isReadableDirectory(dir)) {')
  expect(daemon).toContain('directory is no longer readable')
  expect(daemon).toContain('setRoom(ck, dir, runtime)')
})

test('Directory search preserves requested agent runtime across adapters', () => {
  const types = readFileSync('adapters/types.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(types).toContain('export type SearchContext')
  expect(types).toContain('context?: SearchContext')
  expect(slack).toContain('function slackSearchRuntimeFromAction')
  expect(slack).toContain('const SEARCH_CONTEXT_TTL_MS = 10 * 60 * 1000')
  expect(slack).toContain('private prunePendingSearchChannels(now = Date.now()): void')
  expect(slack).toContain('pendingSearchChannels.set(res.view.id, { channelId, context: searchContext ?? undefined, createdAt: Date.now() })')
  expect(telegram).toContain('const SEARCH_CONTEXT_TTL_MS = 10 * 60 * 1000')
  expect(telegram).toContain('private prunePendingSearchContexts(now = Date.now()): void')
  expect(telegram).toContain('function searchContextKey(channelId: string, messageId: string | undefined): string | undefined')
  expect(telegram).toContain('const key = searchContextKey(channelId, telegramStringId(telegramMessageResult(result).message_id))')
  expect(telegram).toContain('const key = searchContextKey(channelId, telegramStringId(msg.reply_to_message?.message_id))')
  expect(telegram).toContain('this.pendingSearchContexts.set(key, { context, createdAt: Date.now() })')
  expect(telegram).toContain('const pending = key ? this.pendingSearchContexts.get(key) : undefined')
  expect(telegram).toContain('this.dispatchSearch(channelId, query, pending?.context)')
  expect(telegram).not.toContain('pendingSearchContexts.set(channelId, context)')
  expect(telegram).not.toContain('pendingSearchContexts.get(channelId)')
  expect(daemon).toContain("context?.runtime === 'codex' ? 'codex'")
  expect(daemon).toContain('function parseOptionalRuntimeSuffix(action: string, prefix: string): AgentRuntimeKind | undefined | null')
  expect(daemon).toContain("const runtimeSuffix = parseOptionalRuntimeSuffix(action, 'search')")
  expect(daemon).toContain("const runtimeSuffix = parseOptionalRuntimeSuffix(action, 'recentdirs')")
  expect(daemon).toContain("const runtimeSuffix = parseOptionalRuntimeSuffix(action, 'resume')")
  expect(daemon).toContain('if (runtimeSuffix === null) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain("adapter?.promptSearch(localId(ck), 'Type directory name to search', { runtime: runtimeSuffix ?? bindingRuntime(ck) })")
  expect(daemon).toContain('daemon: search prompt failed for ${ck}: ${errorMessage(err)}')
  expect(daemon).toContain("'❌ Failed to open directory search prompt. Try `ccm find <query>` instead.'")
  expect(daemon).toContain("'directory search prompt failure'")
  expect(daemon).toContain('await sendPicker(ck, 0, runtimeSuffix)')
})





test('forwarded env names are validated before bash export', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const shell = readFileSync('shell.ts', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  expect(daemon).toContain("forwardedEnvExports, shellArg } from './shell.js'")
  expect(daemon).toContain('const forwardedExports = forwardedEnvExports(forwardList, process.env, name =>')
  expect(daemon).toContain('ignoring invalid forwarded env name')
  expect(shell).toContain('export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/')
  expect(shell).toContain('function validEnvName(name: string): boolean')
  expect(shell).toContain('Object.prototype.hasOwnProperty.call(env, name)')
  expect(shell).toContain("`${name}=${shellArg(env[name] ?? '')}`")
  expect(daemon).not.toContain('return process.env[k]')
  expect(readme).toContain('invalid shell env names are ignored')
})



test('daemon and adapters avoid unnecessary dynamic requires', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(daemon).toContain(`import {
  readFileSync, writeFileSync, renameSync`)
  expect(daemon).not.toContain("require('fs')")
  expect(slack).toContain("import { homedir } from 'os'")
  expect(telegram).toContain("import { homedir } from 'os'")
  expect(slack).not.toContain("require('os')")
  expect(telegram).not.toContain("require('os')")
})

test('zellij session detection uses exact session names', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("import { findZellijSessionLine } from './zellij.js'")
  expect(daemon).toContain('const ourLine = findZellijSessionLine(out, ZELLIJ_SESSION)')
  expect(daemon).toContain('const checkLine = findZellijSessionLine(check, ZELLIJ_SESSION)')
  expect(daemon).toContain('const line = findZellijSessionLine(out, ZELLIJ_SESSION)')
  expect(daemon).toContain('zellij unavailable, sessions will run as background processes: ${errorMessage(err)}')
  expect(daemon).toContain('zellij session health check failed: ${errorMessage(err)}')
  expect(daemon).toContain("return { kind: 'unknown', reason: errorMessage(err) }")
  expect(daemon).toContain('pane status unknown for ${uuid.slice(0, 8)}, preserving live entry: ${status.reason}')
  expect(daemon).toContain('async function ensureZellijSession(): Promise<void>')
  expect(daemon).not.toContain('function shutdownZellijSession(): void')
  expect(daemon).not.toContain('shutdownZellijSession()')
  expect(daemon).not.toContain("zellijSync(['delete-session', ZELLIJ_SESSION, '--force']")
  expect(daemon).not.toContain("return { kind: 'unknown', reason: String(err) }")
  expect(daemon).not.toContain("zellij not found, sessions will run as background processes")
  expect(daemon).not.toContain('includes(ZELLIJ_SESSION)')
})

test('daemon zellij and worktree helpers avoid shell interpolation', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("function zellijActionAsync(args: string[]")
  expect(daemon).toContain("await zellijActionAsync(['new-tab', '--name', tabName, '--', 'bash', '-c'")
  expect(daemon).toContain("await zellijPipeAsync(`watch:${paneId}`")
  expect(daemon).toContain("zellijPipeSync(`unwatch:${paneId}`")
  expect(daemon).toContain("execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']")
  expect(daemon).toContain("execFileSync('git', ['branch', '-D', branch]")
  expect(daemon).toContain('worktree removal failed for ${uuid.slice(0, 8)}: ${errorMessage(err)}')
  const removeWorktreeBody = daemon.slice(daemon.indexOf('function removeWorktree'), daemon.indexOf('async function spawnAgent'))
  expect(removeWorktreeBody).not.toContain('} catch {}')
  for (const unsafe of [
    'zellij --session ${ZELLIJ_SESSION}',
    'echo "watch:${paneId}" | zellij',
    'git worktree add -b "${branch}"',
    'git branch -D "${branch}"',
  ]) {
    expect(daemon).not.toContain(unsafe)
  }
})

test('escort zellij helpers avoid shell interpolation for pane inputs', () => {
  const escort = readFileSync('escort.ts', 'utf8')
  expect(escort).toContain("execFileSync('zellij', ['--session', ZELLIJ_SESSION, 'action', ...args]")
  expect(escort).toContain("execFileAsync('zellij', ['--session', ZELLIJ_SESSION, 'action', 'dump-screen', '--pane-id', String(paneId)]")
  expect(escort).toContain("zj('write-chars', '--pane-id', String(paneId), text)")
  expect(escort).toContain("import { parseZellijJson, zellijPanes, zellijTabs, type ZellijPane } from './zellij-json.js'")
  expect(escort).toContain('const tabs = zellijTabs(parseZellijJson')
  expect(escort).not.toContain('zellij --session ${ZELLIJ_SESSION}')
  expect(escort).not.toContain('write-chars --pane-id ${paneId}')
  expect(escort).not.toContain("text.replace(/'/g")
  expect(escort).not.toContain('export function listPanes(): any[]')
  expect(escort).not.toContain('(t: any)')
  expect(escort).not.toContain('(x: any)')
})


test('escort startup message edits fall back visibly instead of silent catch', () => {
  const escort = readFileSync('escort.ts', 'utf8')
  expect(escort).toContain("import { errorMessage } from './redact.js'")
  expect(escort).toContain('async function updateEscortMessage')
  expect(escort).toContain('edit failed, sending replacement')
  expect(escort).toContain('replacement send failed')
  expect(escort).toContain('edit failed, sending replacement: ${errorMessage(err)}\\n`)')
  expect(escort).toContain('replacement send failed: ${errorMessage(sendErr)}\\n`)')
  expect(escort).toContain("await updateEscortMessage(callbacks, lastMessageId, '✅ Session ready.', undefined, 'ready')")
  expect(escort).toContain("lastMessageId = await updateEscortMessage(callbacks, lastMessageId, text, kb, 'setup prompt')")
  expect(escort).not.toContain('callbacks.editMessage(lastMessageId')
  expect(escort).not.toContain('.catch(() => {})')
})

test('escort dump-screen failures are observable while preserving empty fallback', () => {
  const escort = readFileSync('escort.ts', 'utf8')
  const block = escort.slice(escort.indexOf('export function dumpScreen'), escort.indexOf('const ZELLIJ_KEY_ALIASES'))
  expect(block).toContain('escort: dump-screen failed for pane ${paneId}: ${errorMessage(err)}')
  expect(block).toContain('escort: async dump-screen failed for pane ${paneId}: ${errorMessage(err)}')
  expect(block).toContain("return ''")
  expect(block).not.toContain("} catch { return '' }")
})

test('escort zellij write helpers log failures instead of silently dropping UX actions', () => {
  const escort = readFileSync('escort.ts', 'utf8')
  const helperBlock = escort.slice(escort.indexOf('export function sendKeys'), escort.indexOf('export function isPaneAlive'))
  expect(helperBlock).toContain('export function sendKeys(paneId: number, ...keys: string[]): boolean')
  expect(helperBlock).toContain('export function writeChars(paneId: number, text: string): boolean')
  expect(helperBlock).toContain('escort: send-keys failed for pane ${paneId}: ${errorMessage(err)}')
  expect(helperBlock).toContain('escort: write raw failed for pane ${paneId}: ${errorMessage(err)}')
  expect(helperBlock).toContain('escort: write chars failed for pane ${paneId}: ${errorMessage(err)}')
  expect(helperBlock).toContain('escort: close tab ${JSON.stringify(tabName)} failed: ${errorMessage(err)}')
  expect(helperBlock).toContain('return false')
  expect(helperBlock).not.toContain('} catch {}')
})

test('escort callbacks fail closed before sending zellij keys', () => {
  const escort = readFileSync('escort.ts', 'utf8')
  expect(escort).toContain('export function parseEscortCallback')
  expect(escort).toContain('const action = parseEscortCallback(data)')
  expect(escort).toContain('ESCORT_ALLOWED_KEYS')
  expect(escort).not.toContain('const paneId = parseInt(parts[1])')
  expect(escort).not.toContain('const targetIdx = parseInt(action.slice(7))')
})
test('directory browser read failures are logged while preserving user-facing error', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('async function sendDirBrowser'), daemon.indexOf('// Apply alphabet filter'))
  expect(body).toContain('directory browser skipped ${skippedEntries.length} unreadable entries under ${dir}')
  expect(body).toContain('skippedEntries.slice(0, 5)')
  expect(body).toContain('directory browser failed to read ${dir}: ${errorMessage(err)}')
  expect(body).toContain('❌ ${agentName(runtime)} cannot read')
  expect(body).toContain("{ text: '🔙 Back'")
  expect(body).not.toContain('} catch {\n    await sendWithButtons')
})

test('directory search uses parameterized find execution and separates command failures from no results', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('async function sendFindResults'), daemon.indexOf('const buttons = results'))
  expect(body).toContain("execFileSync('find', [DEFAULT_CWD, '-maxdepth', '4', '-type', 'd', '-iname', `*${query}*`]")
  expect(body).toContain(".filter(Boolean).slice(0, 20)")
  expect(body).toContain('let searchFailed = false')
  expect(body).toContain('searchFailed = true')
  expect(body).toContain('directory search failed for ${JSON.stringify(query)} under ${DEFAULT_CWD}: ${errorMessage(err)}')
  expect(body).toContain('directory search failed for "${query}"')
  expect(body).toContain('No ${agentName(runtime)} directories matching')
  expect(body.indexOf('if (searchFailed)')).toBeLessThan(body.indexOf('if (results.length === 0)'))
  expect(body).not.toContain('} catch {}')
  expect(body).not.toContain('2>/dev/null | head -20')
  expect(body).not.toContain("query.replace(/'/g, '')")
})

test('daemon callback pagination never partially parses page numbers', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function parsePageNumber')
  expect(daemon).toContain('function splitPayloadPage')
  expect(daemon).toContain('function splitFilterPayloadPage')
  expect(daemon).toContain('function isDirFilterRange(value: string | undefined): value is string')
  expect(daemon).toContain('const paged = splitPayloadPage(payload)')
  expect(daemon).toContain('const suffix = `:${range.label}`')
  expect(daemon).toContain('if (!payload.endsWith(suffix)) continue')
  expect(daemon).toContain('const parsed = parseRuntimePayload(rest, DEFAULT_AGENT_RUNTIME)')
  expect(daemon).toContain('const paged = splitFilterPayloadPage(payload)')
  expect(daemon).toContain('const parsed = splitFilterPayload(payload)')
  expect(daemon).toContain('await sendDirBrowser(ck, parsed.dirPath, 0, parsed.filterRange, runtime)')
  expect(daemon).toContain('} else if (isReadableDirectory(payload)) {')
  expect(daemon).toContain('function splitFolderPagePayload(payload: string)')
  expect(daemon).toContain('if (runtimeSep <= 0) return undefined')
  expect(daemon).toContain('if (lastColon <= 0) return undefined')
  expect(daemon).toContain('const parsed = splitFolderPagePayload(data.slice(12))')
  expect(daemon).toContain('if (!parsed) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain('await sendFolderSessions(ck, parsed.dir, parsed.page, parsed.runtime)')
  expect(daemon).toContain("} else if (data.startsWith('ses:folder:')) {")
  expect(daemon).toContain('const dir = data.slice(11)')
  expect(daemon).toContain('if (!isReadableDirectory(dir)) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain('const page = parsePageNumber(data.slice(4))')
  expect(daemon).toContain('const page = parsePageNumber(data.slice(9))')
  expect(daemon).toContain('if (page == null) return')
  expect(daemon).toContain('await sendPicker(ck, page)')
  expect(daemon).not.toContain('parseInt(data.slice(4))')
  expect(daemon).not.toContain('parseInt(data.slice(9))')
  expect(daemon).not.toContain('pageNumberOrZero(data.slice(4))')
  expect(daemon).not.toContain('pageNumberOrZero(data.slice(9))')
  expect(daemon).not.toContain('parseInt(payload.slice')
  expect(daemon).not.toContain('parseInt(parts[parts.length - 1])')
  expect(daemon).not.toContain("const parts = payload.split(':')")
  expect(daemon).not.toContain('const { dirPath, filterRange } = splitFilterPayload(payload)')
  expect(daemon).not.toContain('const pg = pageNumberOrZero(payload.slice(lastColon + 1))')
})

test('daemon Claude nav output is bounded while preserving recent screen lines', () => {
  const helper = readFileSync('claude-nav.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(helper).toContain('const CLAUDE_NAV_SCREEN_LINE_LIMIT = 80')
  expect(helper).toContain('const CLAUDE_NAV_MESSAGE_CHAR_LIMIT = 3500')
  expect(helper).toContain('export function truncateClaudeNavScreen(text: string, maxChars = CLAUDE_NAV_MESSAGE_CHAR_LIMIT): string')
  expect(helper).toContain('kept = kept.slice(-CLAUDE_NAV_SCREEN_LINE_LIMIT)')
  expect(helper).toContain('export function claudeNavMessageText')
  expect(daemon).toContain("import { claudeNavMessageText, isClaudeDialogScreen } from './claude-nav.js'")
  expect(daemon).toContain("formatAgentReply('claude', claudeNavMessageText(u, screen))")
  expect(daemon).not.toContain('const clean = lines.filter(l => l.trim()).join')
})

test('daemon Claude nav callbacks validate select indexes and keys', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function parseClaudeNavAction')
  expect(daemon).toContain('function parseClaudeNavCallbackData(data: string)')
  expect(daemon).toContain('if (!/^[0-9a-f]{8}$/i.test(uuidShort)) return undefined')
  expect(daemon).toContain('const parsed = parseClaudeNavCallbackData(data)')
  expect(daemon).toContain("if (!parsed) { await sendInvalidButtonMessage(ck, 'claude'); return }")
  expect(daemon).toContain('const paneId = resolvePaneId(parsed.uuidShort)')
  expect(daemon).toContain('parsed.action.type ===')
  expect(daemon).toContain('async function navigateAndConfirm(paneId: number, targetIdx: number): Promise<boolean>')
  expect(daemon).toContain('const navOk = parsed.action.type ===')
  expect(daemon).toContain("undefined, 'claude nav failure notice'")
  expect(daemon).toContain('const CLAUDE_NAV_KEYS')
  expect(daemon).not.toContain('const action = parseClaudeNavAction(parts.slice(2).join')
  expect(daemon).not.toContain('navigateAndConfirm(paneId, parseInt(action.slice(7)))')
  expect(daemon).not.toContain('sendKeys(paneId, action)')
})

test('zellij pane disappearance preserves agent slot bindings for resumable peer handoff', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const liveBlock = daemon.slice(daemon.indexOf('function liveEntryNeedsRespawn'), daemon.indexOf('async function spawnResumeOnce'))
  expect(liveBlock).toContain('needs respawn because zellij pane is')
  expect(liveBlock).toContain('live.delete(uuid)')
  expect(liveBlock).toContain('socketToUuid.forEach')
  expect(liveBlock).not.toContain('clearRuntimeState(uuid, `pane ' + '${status.kind}' + '`)')
  const uiBlock = daemon.slice(daemon.indexOf('function clearPerSessionUiState'), daemon.indexOf('async function handleAgentEvent'))
  expect(uiBlock).toContain('opts: { clearPeerInflight?: boolean } = {}')
  expect(uiBlock).toContain('if (opts.clearPeerInflight) clearAskPeerInflightForSession(uuid)')
  expect(uiBlock).toContain('function clearSessionTerminalState(uuid: string): void')
})
test('daemon sendToLive write failures clear stale live IPC state', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('function clearBrokenLiveConn'), daemon.indexOf('function isLiveBridgeConnected'))
  expect(block).toContain('function clearBrokenLiveConn(uuid: string, conn: Socket, reason: string, err: unknown): void')
  expect(block).toContain('IPC write failed for ${uuid.slice(0, 8)} (${reason}): ${errorMessage(err)}')
  expect(block).toContain('if (l?.ipcConn === conn) l.ipcConn = null')
  expect(block).toContain('socketToUuid.delete(conn)')
  expect(daemon).toContain('function destroyIpcConn(conn: Socket, reason: string): void')
  expect(daemon).toContain('IPC destroy failed during ${reason}: ${errorMessage(err)}')
  expect(block).toContain('destroyIpcConn(conn, `clear broken live connection ${uuid.slice(0, 8)}`)')
  expect(block).toContain("clearBrokenLiveConn(uuid, l.ipcConn, 'sendToLive', err)")
  expect(block).not.toContain("try { l.ipcConn.write(JSON.stringify(msg) + '\n'); return true } catch { return false }")
})





test('Claude resume prefers transcript cwd and falls back when stale', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function claudeTranscriptCwd(transcriptPath: string): string | undefined')
  expect(daemon).toContain('function claudeResumeCwd(transcript: TranscriptInfo | null, fallbackCwd: string): string')
  expect(daemon).toContain('if (pathExists(projectCwd)) return projectCwd')
  expect(daemon).toContain('no longer exists; falling back to ${fallbackCwd}')
  const block = daemon.slice(daemon.indexOf('async function spawnResumeOnce'), daemon.indexOf('async function resumeAndBind'))
  expect(block).toContain('const fallbackCwd = meta?.cwd ?? sessionInfo?.cwd ?? (bound ? roomCwd(bound.channelKey) : undefined) ?? DEFAULT_CWD')
  expect(block).toContain('? claudeResumeCwd(t, fallbackCwd)')
})

test('Claude resume turn delivery synthesizes session after bridge connects', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function ensureClaudeSession(uuid: string, cwd: string): AgentSession | undefined')
  expect(daemon).toContain('if (!isLiveBridgeConnected(uuid)) return undefined')
  expect(daemon).toContain("transport: 'claude-channel'")
  const deliverBlock = daemon.slice(daemon.indexOf('async function deliverUserTurn'), daemon.indexOf('async function onMessage'))
  expect(deliverBlock).toContain("if (l?.ipcConn && runtime === 'claude') ensureClaudeSession(uuid, roomCwd(ck))")
  expect(deliverBlock).toContain('let session = ensureClaudeSession(uuid, roomCwd(ck))')
  expect(deliverBlock).not.toContain('let session = claudeSessions.get(uuid) ?? claudeDriver.get(uuid)')
})

test('permission callbacks preserve request ids containing colons', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const server = readFileSync('server.ts', 'utf8')
  expect(daemon).toContain('function parsePermissionCallbackData(data: string)')
  expect(daemon).toContain("typeof msg.request_id === 'string' && msg.request_id.length > 0")
  expect(daemon).toContain("typeof msg.tool_name === 'string' && msg.tool_name.length > 0")
  expect(daemon).toContain("typeof msg.description === 'string' && msg.description.length > 0")
  expect(daemon).toContain('const channels = msg.channels.filter(ck => channelAllowed(ck) && !!adapterFor(ck))')
  expect(daemon).not.toContain('msg.channels.length > 0 ? msg.channels : routableChannelsForUuid(uuid)')
  expect(daemon).toContain('has no deliverable channels; denying fail-closed')
  expect(daemon).toContain('failed to deliver to ${channels.length} channel(s); denying fail-closed')
  expect(daemon).toContain('function sendToLive(uuid: string, msg: Record<string, unknown>): boolean')
  expect(daemon).toContain("if (!sendToLive(uuid, { type: 'permission_response', request_id, behavior: 'deny' }))")
  expect(daemon).toContain('failed to send fail-closed deny for permission request ${request_id}')
  expect(daemon).toContain('let delivered = false')
  expect(daemon).toContain('const sentId = await sendChannelNotice(ck, text, opts, `permission request ${request_id}`)')
  expect(daemon).toContain('sendChannelNotice(ck, text, opts, `permission request ${request_id}`)')
  expect(daemon).toContain('const uuidSep = rest.indexOf')
  expect(daemon).toContain('const behaviorSep = rest.lastIndexOf')
  expect(daemon).toContain('const uuid = parseSessionCallbackUuid(rest.slice(0, uuidSep))')
  expect(daemon).toContain('const requestId = rest.slice(uuidSep + 1, behaviorSep)')
  expect(daemon).toContain('if (!parsed) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain('type PendingPermission = { requestId: string; setAt: number }')
  expect(daemon).toContain('if (delivered) pendingPermission.set(uuid, { requestId: request_id, setAt: Date.now() })')
  expect(daemon).toContain('function isPermissionInFlight(uuid: string, requestId?: string): boolean')
  expect(daemon).toContain('return requestId === undefined || pending.requestId === requestId')
  expect(daemon).toContain('if (!isPermissionInFlight(parsed.uuid, parsed.requestId) || !isLiveBridgeConnected(parsed.uuid)) {')
  expect(daemon).toContain("sendToLive(parsed.uuid, { type: 'permission_response', request_id: parsed.requestId, behavior: parsed.behavior })")
  expect(daemon).not.toContain('const requestId = parts[2]')
  expect(daemon).not.toContain('const behavior = permissionBehavior(parts[3])')
  expect(server).toContain('let lastInboundChannelKey =')
  expect(server).toContain('lastInboundChannelKey = inbound.meta.chat_id || inbound.meta.room_id || lastInboundChannelKey')
  expect(server).toContain('channels: lastInboundChannelKey ? [lastInboundChannelKey] : []')
  expect(server).not.toContain('channels: registeredChannels')
})


test('daemon text commands avoid parseInt partial parsing', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function firstNumberArg')
  expect(daemon).toContain('function clampCount')
  expect(daemon).toContain('const limit = clampCount(firstNumberArg(args))')
  expect(daemon).toContain('const index = Math.max(0, (parsePageNumber(m[1]) ?? 1) - 1)')
  expect(daemon).not.toContain('parseInt(args.match')
  expect(daemon).not.toContain('parseInt(m[1]')
})

test('daemon session command callbacks validate callback-safe session ids', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).not.toContain("action.startsWith('browse:')")
  expect(daemon).not.toContain('sendDirBrowser(ck, action.slice(7), 0)')
  expect(daemon).toContain('function parseSessionCallbackUuid(value: string): string | undefined')
  expect(daemon).toContain('return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : undefined')
  expect(daemon).toContain('const uuid = parseSessionCallbackUuid(action.slice(8))')
  expect(daemon).toContain('const uuid = parseSessionCallbackUuid(action.slice(6))')
  expect(daemon).toContain('const uuid = parseSessionCallbackUuid(action.slice(5))')
  expect(daemon).toContain('if (!uuid) return')
  expect(daemon).not.toContain('const uuid = action.slice(8)')
  expect(daemon).not.toContain('const uuid = action.slice(6)')
  expect(daemon).not.toContain('const uuid = action.slice(5)')
})

test('Codex option callbacks require explicit finite option indexes', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function parseCodexOptionIndex')
  expect(daemon).toContain("const optionIndex = decision === 'opt' ? parseCodexOptionIndex(parsed.argument) : undefined")
  expect(daemon).toContain('optionIndex == null ? null : codexOptionInputResult')
  expect(daemon).not.toContain('codexOptionInputResult(pending.params, Number(parts[3] ?? 0))')
})

test('Codex MCP form numeric coercion avoids empty and fractional integer surprises', () => {
  const source = readFileSync('codex-response.ts', 'utf8')
  expect(source).toContain('function numericFormValue')
  expect(source).toContain('if (!trimmed) return trimmed')
  expect(source).toContain('if (integer && !Number.isInteger(value)) return trimmed')
  expect(source).not.toContain('const numberValue = Number(text.trim())')
})

test('task snapshot directory read failures are logged without noisy missing-dir warnings', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('function readTaskSnapshot'), daemon.indexOf('function formatTaskSnapshot'))
  expect(body).toContain('if (!existsSync(dir)) return null')
  expect(body).toContain("logUnexpectedFsReadError('read task snapshot dir', dir, err)")
  expect(body).toContain('return null')
  expect(body).not.toContain('catch { return null }')
})

test('task snapshot sorting avoids loose numeric coercion', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const tasks = readFileSync('tasks.ts', 'utf8')
  expect(daemon).toContain('items.sort(compareTaskSnapshotItems)')
  expect(tasks).toContain('export function taskSnapshotSortNumber')
  expect(tasks).toContain('Number.isSafeInteger(value)')
  expect(daemon).not.toContain('const an = Number(a.id), bn = Number(b.id)')
})

test('Legacy callback payloads stay Claude-compatible unless runtime is explicit', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('const { runtime: parsedRuntime, payload } = splitRuntimePayload(value)')
  expect(daemon).toContain('const uuid = parseSessionCallbackUuid(payload)')
  expect(daemon).toContain('const runtime = parsedRuntime ?? resolveSessionRuntime(uuid, undefined)')
  expect(daemon).toContain('await resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')
  expect(daemon).toContain('function parseRuntimePayload(value: string, fallback?: AgentRuntimeKind)')
  expect(daemon).toContain('if (firstColon < 0) return fallback ? { runtime: fallback, payload: value } : undefined')
  expect(daemon).toContain('if (!isAgentRuntimeKind(runtimeToken)) return fallback ? { runtime: fallback, payload: value } : undefined')
  expect(daemon).toContain('const parsed = parseRuntimePayload(rest, DEFAULT_AGENT_RUNTIME)')
  expect(daemon).not.toContain('const { runtime: parsedRuntime, payload: uuid } = splitRuntimePayload(value)')
})

test('Codex turn envelope carries whitelisted untrusted message metadata', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(driver).toContain('<message_meta trust="untrusted">')
  for (const key of ['attachment_file_id', 'attachment_name', 'attachment_mime', 'attachment_size', 'reply_to_id', 'user_id']) {
    expect(driver).toContain(`'${key}'`)
  }
})

test('Claude turn envelope also carries reply/thread metadata for parity', () => {
  const driver = readFileSync('agents/claude/channel-driver.ts', 'utf8')
  expect(driver).toContain('<message_meta trust="untrusted">')
  for (const key of ['reply_to_id', 'message_id', 'thread_id', 'chat_id', 'room_id']) {
    expect(driver).toContain(`'${key}'`)
  }
})


test('daemon stale IPC socket cleanup fails fast with a visible error', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('if (existsSync(SOCK_PATH))'), daemon.indexOf('const ipc: NetServer'))
  expect(block).toContain('unlinkSync(SOCK_PATH)')
  expect(block).toContain('failed to remove stale IPC socket ${SOCK_PATH}: ${errorMessage(err)}')
  expect(block).toContain('process.exit(1)')
  expect(block).not.toContain('if (existsSync(SOCK_PATH)) try { unlinkSync(SOCK_PATH) } catch {}')
})

test('daemon IPC connection errors are logged with session context', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf("conn.on('close'"), daemon.indexOf("ipc.on('error'"))
  expect(block).toContain("conn.on('error', err => {")
  expect(block).toContain('const uuid = socketToUuid.get(conn)')
  expect(block).toContain("IPC connection error${uuid ? ` for ${uuid.slice(0, 8)}` : ''}: ${errorMessage(err)}")
  expect(block).not.toContain("conn.on('error', () => {})")
})

test('daemon IPC server errors are logged with redaction', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf("ipc.on('error'"), daemon.indexOf('ipc.listen(SOCK_PATH'))
  expect(block).toContain('IPC server error on ${SOCK_PATH}: ${errorMessage(err)}')
})

test('daemon pid file write failure logs and cleans up IPC socket', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('writeFileSync(PID_FILE'), daemon.indexOf('for (const adapter of activeAdapters)'))
  expect(block).toContain('writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 })')
  expect(block).toContain('failed to write pid file ${PID_FILE}: ${errorMessage(err)}')
  expect(block).toContain('IPC close after pid file failure failed: ${errorMessage(closeErr)}')
  expect(block).toContain("logUnexpectedFsCleanupError('unlink IPC socket after pid file failure', SOCK_PATH, unlinkErr)")
  expect(block).toContain('process.exit(1)')
})

test('daemon IPC socket chmod fails closed instead of serving with unknown permissions', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('ipc.listen(SOCK_PATH'), daemon.indexOf('writeFileSync(PID_FILE)'))
  expect(block).toContain('chmodSync(SOCK_PATH, 0o600)')
  expect(block).toContain('failed to chmod IPC socket ${SOCK_PATH}: ${errorMessage(err)}')
  expect(block).toContain('void shutdown()')
  expect(block).not.toContain('try { chmodSync(SOCK_PATH, 0o600) } catch {}')
})

test('Claude MCP bridge uses explicit daemon socket path without non-null assertion', () => {
  const server = readFileSync('server.ts', 'utf8')
  expect(server).toContain('const DAEMON_SOCK_PATH = process.env.CC_CHANNEL_DAEMON_SOCK')
  expect(server).toContain('createConnection(DAEMON_SOCK_PATH')
  expect(server).toContain('existsSync(DAEMON_SOCK_PATH)')
  expect(server).not.toContain('DAEMON_SOCK!')
})

test('Claude MCP bridge redacts tool errors before returning to agent', () => {
  const server = readFileSync('server.ts', 'utf8')
  expect(server).toContain("import { errorMessage, redactSensitiveText } from './redact.js'")
  expect(server).toContain('const msg = errorMessage(err)')
  expect(server).not.toContain('const msg = err instanceof Error ? err.message : String(err)')
})

test('daemon duplicate-register rejection logs notice and close failures', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('if (l.ipcConn && l.ipcConn !== conn && !l.ipcConn.destroyed)'), daemon.indexOf('const firstEver = !announcedReconnect.has(uuid)'))
  expect(block).toContain("type: 'duplicate'")
  expect(block).toContain('duplicate-register notice failed for ${uuid.slice(0, 8)}')
  expect(block).toContain('duplicate-register close failed for ${uuid.slice(0, 8)}')
  expect(block).toContain('destroyIpcConn(conn, `duplicate-register close ${uuid.slice(0, 8)}`)')
  expect(block).not.toContain('} catch {}\n            try { conn.end() } catch {}')
  expect(block).not.toContain('try { conn.end() } catch {}')
})

test('daemon IPC pong failures destroy half-open connections with context', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf("} else if (msg.type === 'ping')"), daemon.indexOf("conn.on('close'", daemon.indexOf("} else if (msg.type === 'ping')")))
  expect(block).toContain("conn.write('{\"type\":\"pong\"}\\n')")
  expect(block).toContain('daemon: IPC pong failed')
  expect(block).toContain('const uuid = socketToUuid.get(conn)')
  expect(block).toContain("destroyIpcConn(conn, uuid ? `pong failure ${uuid.slice(0, 8)}` : 'pong failure before register')")
  expect(block).not.toContain(`try { conn.write('{"type":"pong"}\n') } catch {}`)
})

test('Claude MCP bridge reconnect scheduling is de-duplicated', () => {
  const server = readFileSync('server.ts', 'utf8')
  const block = server.slice(server.indexOf('function scheduleReconnect'), server.indexOf('function handleDaemonMessage'))
  expect(server).toContain('let reconnectTimer: ReturnType<typeof setTimeout> | null = null')
  expect(server).toContain('reconnectTimer = null')
  expect(block).toContain('if (reconnectTimer) return')
  expect(block).toContain('reconnectTimer = setTimeout(async () => {')
  expect(block).toContain('reconnectTimer = null')
  expect(block).toContain('reconnect attempt ${reconnectAttempt} failed: ${errorMessage(err)}')
  expect(block).toContain('scheduleReconnect()')
  expect(block).not.toContain('} catch {\n      scheduleReconnect()')
  expect(block).not.toContain("// connectToDaemon's close handler will schedule next retry")
})

test('Claude MCP bridge drains pending daemon calls before rejecting on disconnect', () => {
  const server = readFileSync('server.ts', 'utf8')
  expect(server).toContain('function rejectPendingCalls(err: Error): void')
  expect(server).toContain('const pending = [...pendingCalls.values()]')
  expect(server).toContain('pendingCalls.clear()')
  expect(server).toContain('for (const call of pending) call.reject(err)')
  const closeBlock = server.slice(server.indexOf("conn.on('close'"), server.indexOf('function scheduleReconnect'))
  expect(closeBlock).toContain("rejectPendingCalls(new Error('daemon disconnected'))")
  expect(closeBlock).not.toContain("for (const [, p] of pendingCalls) p.reject(new Error('daemon disconnected'))")
})

test('Claude MCP bridge avoids duplicate reconnect scheduling before initial connect settles', () => {
  const server = readFileSync('server.ts', 'utf8')
  const block = server.slice(server.indexOf('function connectToDaemon'), server.indexOf('function scheduleReconnect'))
  expect(block).toContain('let settled = false')
  expect(block).toContain('if (firstConnect && !connected && !settled)')
  expect(block).toContain('settled = true')
  expect(block).toContain('if (!shuttingDown && settled) scheduleReconnect()')
  expect(block).not.toContain('if (!shuttingDown) scheduleReconnect()')
})

test('Claude MCP bridge only marks connected after register write succeeds', () => {
  const server = readFileSync('server.ts', 'utf8')
  const block = server.slice(server.indexOf('const conn = createConnection'), server.indexOf("conn.on('data'"))
  expect(block).toContain('daemon register write failed: ${errorMessage(err)}')
  expect(server).toContain('function destroyDaemonSocket(conn: { destroy(): void }, reason: string): void')
  expect(server).toContain('daemon socket destroy failed during ${reason}: ${errorMessage(err)}')
  expect(block).toContain("destroyDaemonSocket(conn, 'register write failure')")
  expect(block).toContain('reject(err)')
  const registerWrite = "conn.write(JSON.stringify({ type: 'register'"
  expect(block.indexOf(registerWrite)).toBeLessThan(block.indexOf('daemonConn = conn'))
  expect(block.indexOf(registerWrite)).toBeLessThan(block.indexOf('connected = true'))
})

test('Claude MCP bridge connection closes are logged instead of silently swallowed', () => {
  const server = readFileSync('server.ts', 'utf8')
  expect(server).toContain('function endDaemonConn(reason: string): void')
  expect(server).toContain('daemon connection close failed during ${reason}: ${errorMessage(err)}\\n`)')
  expect(server).toContain('destroyDaemonSocket(daemonConn, reason)')
  expect(server).toContain("endDaemonConn('duplicate rejection')")
  expect(server).toContain("endDaemonConn('shutdown')")
  expect(server).not.toContain('try { daemonConn?.end() } catch {}')
})

test('auto-recovered Claude sessions restart screen watching on register', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const registerBlock = daemon.slice(daemon.indexOf("if (msg.type === 'register')"), daemon.indexOf("} else if (msg.type === 'tool_call')"))
  expect(registerBlock).toContain('const bound = bindingEntries().find(e => e.uuid === uuid)')
  expect(registerBlock).toContain('daemon: auto-recovered session ${uuid.slice(0, 8)} from bindings')
  expect(registerBlock).toContain('for (const ch of uuid === SHARED_CODEX_BRIDGE_ID ? [] : routableChannelsForUuid(uuid))')
  expect(registerBlock).toContain('if (!screenWatchers.has(uuid)) void startScreenWatch(ch, uuid)')
  expect(registerBlock.indexOf('live.set(uuid, l)')).toBeLessThan(registerBlock.indexOf('if (!screenWatchers.has(uuid)) void startScreenWatch(ch, uuid)'))
})

test('startup stale-binding cleanup preserves Codex bindings recoverable by native transcript', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const cleanupBlock = daemon.slice(daemon.indexOf('function cleanStaleBindings'), daemon.indexOf('\ncleanStaleBindings()'))
  expect(cleanupBlock).toContain("if (entry.runtime === 'codex' && meta?.nativeSessionId)")
  expect(cleanupBlock).toContain('const nativeTranscript = findCodexTranscript(meta.nativeSessionId)')
  expect(cleanupBlock).toContain('rememberCodexTranscriptPath(entry.uuid, nativeTranscript.path)')
  expect(cleanupBlock.indexOf('rememberCodexTranscriptPath(entry.uuid, nativeTranscript.path)')).toBeLessThan(cleanupBlock.indexOf('delete binding.sessions[entry.runtime]'))
})

test('Claude MCP bridge keepalive failures reconnect instead of staying half-open', () => {
  const server = readFileSync('server.ts', 'utf8')
  expect(server).toContain('daemon keepalive failed: ${errorMessage(err)}')
  expect(server).toContain('daemonConn = null')
  expect(server).toContain('connected = false')
  expect(server).toContain('if (!shuttingDown) scheduleReconnect()')
  expect(server).toContain("destroyDaemonSocket(daemonConn, 'keepalive failure')")
  expect(server).not.toContain('try { daemonConn.destroy() } catch {}')
  expect(server).not.toContain(`if (daemonConn) try { daemonConn.write('{\"type\":\"ping\"}\\n') } catch {}`)
})

test('Claude MCP bridge parses daemon IPC messages with typed helpers', () => {
  const server = readFileSync('server.ts', 'utf8')
  const serverIpc = readFileSync('server-ipc.ts', 'utf8')
  expect(server).toContain("import { daemonFrameFromLine, daemonInboundMessage, daemonPermissionResponse, daemonToolError, daemonToolResult, stringList, toolArguments } from './server-ipc.js'")
  expect(server).toContain('const msg = daemonFrameFromLine(data)')
  expect(serverIpc).toContain('export function stringList(value: unknown): string[]')
  expect(serverIpc).toContain('export function daemonFrameFromLine(data: string): Record<string, unknown> | undefined')
  expect(serverIpc).toContain('value !== null && !Array.isArray(value)')
  expect(serverIpc).toContain('type DaemonPermissionResponse = { request_id: string; behavior:')
  expect(serverIpc).toContain('export function daemonPermissionResponse(msg: Record<string, unknown>): DaemonPermissionResponse | undefined')
  expect(serverIpc).toContain('export function daemonInboundMessage(msg: Record<string, unknown>): DaemonInboundMessage | undefined')
  expect(serverIpc).toContain('export function daemonToolResult(msg: Record<string, unknown>): DaemonToolResult | undefined')
  expect(serverIpc).toContain('export function daemonToolError(msg: Record<string, unknown>): DaemonToolError | undefined')
  expect(serverIpc).toContain('export function toolArguments(value: unknown): Record<string, unknown>')
  expect(server).toContain('registeredChannels = stringList(msg.channels)')
  expect(server).toContain('const response = daemonPermissionResponse(msg)')
  expect(server).toContain('function notifyPermission(requestId: string, behavior:')
  expect(server).toContain('permission notification failed for ${requestId}')
  expect(server).toContain('notifyPermission(response.request_id, response.behavior)')
  expect(server).toContain('const inbound = daemonInboundMessage(msg)')
  expect(server).not.toContain('msg.channels as string[]')
  expect(server).not.toContain("msg.behavior as 'allow' | 'deny'")
  expect(server).not.toContain('msg.meta as Record<string, string>')
  expect(server).toContain('permission request ${params.request_id} has no daemon connection; denying fail-closed')
  expect(server).toContain('failed to send permission request ${params.request_id} to daemon; denying fail-closed')
  expect(server).toContain("notifyPermission(params.request_id, 'deny')")
  expect(server).not.toContain('(req.params.arguments ?? {}) as Record<string, unknown>')
})

test('Codex MCP bridge receives shared daemon bridge environment', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(driver).toContain("const SHARED_CODEX_BRIDGE_ID = 'ccm-shared-codex-app-server'")
  expect(driver).toContain('private configArgs(): string')
  expect(driver).toContain('mcp_servers.claude-channel-mux.env.CC_CHANNEL_SESSION_UUID')
  expect(driver).toContain('mcp_servers.claude-channel-mux.env.CODEX_CHANNEL_SESSION_UUID')
  expect(driver).toContain('mcp_servers.claude-channel-mux.env.CC_CHANNEL_DAEMON_SOCK')
})

test('Codex app-server and remote TUI share environment-driven launch args', () => {
  const config = readFileSync('agents/codex/config.ts', 'utf8')
  const launchArgs = readFileSync('agents/codex/launch-args.ts', 'utf8')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  const lifecycle = readFileSync('agents/codex/session.ts', 'utf8')
  expect(config).toContain('export function codexResolvedConfigFromEnv')
  expect(config).toContain('command: commandPrefix(env.CODEX_BIN, \'codex\')')
  expect(config).toContain('launchArgs: codexLaunchArgs(model)')
  expect(config).toContain('appServerListen')
  expect(config).toContain('worktreeMode')
  expect(config).toContain('approvalPolicy: codexApprovalPolicyFromEnv(env)')
  expect(config).toContain('sandbox: codexSandboxFromEnv(env)')
  expect(launchArgs).not.toMatch(/openai-gpt-5\.[0-9]+/)
  expect(launchArgs).not.toMatch(/model_providers\.[^.]+\.base_url=/)
  expect(launchArgs).not.toMatch(/127\.0\.0\.1:[0-9]+/)
  expect(launchArgs).toContain('export function codexEffectiveModelFromEnv')
  expect(config).toContain("if (model) args.push('-m', model)")
  expect(launchArgs).not.toMatch(/--yo[a-z]+/)
  expect(launchArgs).not.toContain('CODEX_' + 'YOLO')
  expect(driver).toContain('const runtimeConfig = codexConfigWithModelOverride(this.baseConfig, modelOverride)')
  expect(driver).toContain('codexCommand: [...runtimeConfig.command, ...runtimeConfig.launchArgs]')
  expect(driver).toContain('CODEX_HOME: runtimeConfig.home')
  expect(driver).toContain("DISABLE_AUTOUPDATER: '1'")
  expect(driver).toContain('const effectiveModel = runtimeConfig.model')
  expect(driver).toContain('const response = nativeSessionId')
  expect(driver).not.toContain('const response = nativeSessionId && !effectiveModel')
  expect(driver).toContain('...(effectiveModel ? { model: effectiveModel } : {})')
  expect(driver).toContain('...(runtime.effectiveModel ? { model: runtime.effectiveModel } : {})')
  expect(daemon).toContain('const CODEX_CONFIG = codexResolvedConfigFromEnv(process.env)')
  expect(daemon).toContain('const codexSessionLifecycle = new CodexAppServerSession')
  expect(lifecycle).toContain("commandLine(config.command, [...config.launchArgs, '--remote', appServerUrl, 'resume', session.nativeSessionId, '-C', session.cwd])")
  const commandBody = lifecycle.slice(lifecycle.indexOf('function codexRemoteTuiCommand'), lifecycle.indexOf('export class CodexAppServerSession'))
  expect(commandBody).toContain("'resume', session.nativeSessionId")
})

test('ask_peer env numeric knobs fail closed to positive defaults', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function positiveFiniteEnv')
  expect(daemon).toContain('for (const value of [primary, fallback])')
  expect(daemon).toContain('if (Number.isFinite(parsed) && parsed > 0) return parsed')
  expect(daemon).toContain('return defaultValue')
  expect(daemon).toContain('const ASK_PEER_RATE_WINDOW_MS = positiveFiniteEnv')
  expect(daemon).toContain('const ASK_PEER_RATE_LIMIT = positiveFiniteEnv')
  expect(daemon).toContain('const ASK_PEER_MAX_INFLIGHT_PER_ROOM = positiveFiniteEnv')
  expect(daemon).toContain('const ASK_PEER_INFLIGHT_TTL_MS = positiveFiniteEnv')
  expect(daemon).toContain('const COLLAB_STALE_TTL_MS = positiveFiniteEnv')
  expect(daemon).toContain('const COLLAB_MAX_HANDOFFS = positiveFiniteEnv')
  expect(daemon).toContain('const COLLAB_INLINE_CONTEXT_MAX_CHARS = positiveFiniteEnv')
  expect(daemon).toContain('const PEER_REPLY_INJECTION_MAX_CHARS = positiveFiniteEnv')
  expect(daemon).toContain('const AGENT_CONTEXT_TURN_MAX_CHARS = positiveFiniteEnv')
  expect(daemon).not.toContain('const ASK_PEER_RATE_WINDOW_MS = Number(process.env')
  expect(daemon).not.toContain('const ASK_PEER_RATE_LIMIT = Number(process.env')
})

test('ask_peer in-flight state clears when either session is torn down', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function clearAskPeerInflightForSession(sessionId: string): void')
  expect(daemon).toContain('inflight.fromUuid === sessionId || inflight.peerUuid === sessionId')
  expect(daemon).toContain('clearSessionTerminalState(uuid)')
  const clearUiBody = daemon.slice(daemon.indexOf('function clearPerSessionUiState'), daemon.indexOf('async function handleAgentEvent'))
  expect(clearUiBody).toContain('if (opts.clearPeerInflight) clearAskPeerInflightForSession(uuid)')
  expect(clearUiBody).toContain('clearPerSessionUiState(uuid, { clearPeerInflight: true })')
})


test('ask_peer is an async same-room peer handoff tool, not daemon memory', () => {
  const server = readFileSync('server.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(server).toContain("name: 'ask_peer'")
  expect(server).toContain('Ask another agent in the same CCM room')
  expect(server).toContain('async visible handoff')
  expect(server).toContain('const timeoutMs = 60_000')
  expect(daemon).toContain('type AgentCue =')
  expect(daemon).toContain('async function routeCue(cue: AgentCue)')
  expect(daemon).toContain('async function askPeerAgent')
  expect(daemon).toContain('return routeCue(cue)')
  expect(daemon).toContain("reason: 'self_ask'")
  expect(daemon).toContain("throw new Error('ask_peer target must be a different agent')")
  expect(daemon).toContain('let peerUuid = await ensureRoomAgentReady(ck, peer, false)')
  expect(daemon).toContain('waitForLiveBridge(peerUuid)')
  expect(daemon).toContain('roomCwd(bound.channelKey)')
  expect(daemon).toContain('setAgentMeta(ck, runtime, { cwd, desiredRunning: true })')
  expect(daemon).toContain('channel_bridge_not_connected_after_resume')
  expect(daemon).toContain('let nativeTurnId = await agentRegistry.get(peer).sendTurn({ session, turn })')
  expect(daemon).toContain('waitForClaudeTranscriptReceipt(peerUuid, [handoffId, messageId])')
  expect(daemon).toContain("auditEvent({ event: 'cue_retry', reason: 'claude_inbound_receipt_missing'")
  expect(daemon).toContain('Claude channel did not acknowledge inbound handoff')
  expect(daemon).toContain('User-authorized peer handoff from')
  expect(daemon).toContain('Peer task:')
  expect(daemon).toContain('const handoffId =')
  expect(daemon).toContain('const messageId = cue.messageId || threadId')
  expect(daemon).toContain('rememberThreadAnchor(peerUuid, messageId)')
  expect(daemon).toContain('rememberThreadAnchor(peerUuid, threadId)')
  expect(daemon).not.toContain('const messageId = handoffId')
  expect(daemon).toContain("auditEvent({ event: 'ask_peer_sent'")
  const auditCalls: string[] = daemon.match(/auditEvent\(\{[^\n]+\}\)/g) ?? []
  const askPeerAuditCalls = auditCalls.filter(call => call.includes('ask_peer_'))
  expect(askPeerAuditCalls.length).toBeGreaterThan(0)
  for (const call of askPeerAuditCalls) {
    expect(call).not.toMatch(/\bquestion\b|\btext\b|\bcontent\b|\bprompt\b/)
  }
  expect(daemon).toContain("event: 'ask_peer_denied', reason: 'invalid_agent'")
  for (const reason of ['self_ask', 'missing_question', 'peer_not_started', 'peer_unavailable', 'peer_session_not_loaded', 'rate_limited', 'room_inflight_limit', 'send_failed']) {
    expect(daemon).toContain(`'${reason}'`)
  }
  expect(daemon).toContain('askPeerInflight.delete(handoffId)')
  expect(daemon).toContain('completeAskPeerInflightFromText')
  expect(daemon).toContain("correlation: 'explicit_handoff_id'")
  expect(daemon).toContain("correlation: 'single_inflight_same_thread_fallback'")
  expect(daemon).toContain('candidates.length !== 1')
  expect(daemon).toContain('ASK_PEER_MAX_INFLIGHT_PER_ROOM')
  expect(daemon).toContain('ASK_PEER_RATE_LIMIT')
  expect(daemon).toContain('recordAskPeerRate(ck, fromRuntime, peer)')
  expect(daemon).toContain('if (completed || matches.length > 0 || !text.trim() || !threadId) return')
  expect(daemon).toContain('const candidates = [...askPeerInflight.values()].filter(item => item.peerUuid === sessionId && item.threadId === threadId)')
  expect(daemon).toContain('const messageId = await adapter.sendMessage(localId(ck), formatAgentReply(event.session.kind, text))')
  expect(daemon).toContain('completeAskPeerInflightFromText(event.session.sessionId, text, messageId, event.threadId)')
  expect(daemon).toContain('retrying main channel')
  expect(daemon).toContain('fallback=main')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(driver).toContain('runtime.turnThreads.set(input.turn.turnId, input.turn.threadId)')
  expect(driver).toContain('this.moveTurnRoute(runtime, input.turn.turnId, nativeTurnId)')
  expect(driver).toContain('const channelThreadId = runtime.turnThreads.get(nativeTurnId)')
  expect(daemon.indexOf('const nativeTurnId = await agentRegistry.get(peer).sendTurn({ session, turn })')).toBeLessThan(daemon.indexOf('recordAskPeerRate(ck, fromRuntime, peer)'))
  expect(daemon).toContain('askPeerRoomStatusLines')
  expect(daemon).toContain('*ask_peer:*')
  expect(daemon).toContain('Sent visible async handoff')
  expect(daemon).toContain('__ask_peer')
  expect(daemon).toContain("auditEvent({ event: 'cue_created'")
  expect(daemon).toContain("auditEvent({ event: 'cue_routed'")
  expect(daemon).toContain("source: 'tool'")
  expect(daemon).toContain("mode: 'visible'")
  expect(daemon).toContain("expectation: 'must_reply'")
  expect(daemon).toContain('type AgentHandoffStatus =')
  expect(daemon).toContain('const recentAgentHandoffs = new Map<string, AgentHandoffStatus>()')
  expect(daemon).toContain('function agentHandoffStatusLines(roomId: string): string[]')
  expect(daemon).toContain("return [...lines, '*Agents:*', ...slots, ...askPeerRoomStatusLines(ck), ...agentHandoffStatusLines(ck), ...collabStatusLines(ck)]")
  expect(daemon).toContain('*Handoffs:*')
  expect(daemon).toContain("updateAgentHandoffStatus(handoffId, 'replied')")
  expect(daemon).toContain("updateAgentHandoffStatus(handoffId, 'failed', errorMessage(err))")
  expect(daemon).not.toContain('peerAnswerWaiters')
  expect(daemon).not.toContain('peerAnswerNextWaiters')
  expect(daemon).not.toContain('ASK_PEER_TIMEOUT_MS')
  expect(daemon).not.toContain('resolvePeerAnswerWaiter')
  expect(daemon).not.toContain('unreadPeer')
})

test('tool calls reject stale cross-room chat_id values', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const helper = daemon.slice(daemon.indexOf('function canonicalToolChannelKey'), daemon.indexOf('function roomCwd'))
  expect(daemon).toContain('bindingAuthorizedRoomsForSession')
  expect(helper).toContain('const boundRooms = bindingAuthorizedRoomsForSession(loadBindings(), uuid)')
  expect(helper).toContain('if (boundRooms.includes(requestedCk)) return requestedCk')
  expect(helper).toContain('if (!requestedCk && boundRooms.length === 1) return boundRooms[0]')
  expect(helper).toContain("event: 'tool_chat_id_mismatch'")
  expect(helper).toContain("reason: 'requested_room_not_bound_to_caller'")
  expect(helper).toContain("throw new Error(`Tool chat_id ${requestedCk || '(missing)'} is not bound to session")
  const handleTool = daemon.slice(daemon.indexOf('async function handleTool'), daemon.indexOf('// ---------------------------------------------------------------------------\n// Permission request'))
  expect(handleTool).toContain('route = resolveToolCallRoute(callerUuid, msg.args)')
  expect(handleTool).toContain("sendToLive(callerUuid, { type: 'tool_error', callId: msg.callId, error: errorMessage(err) })")
  expect(daemon).toContain('const requestedCk = stringValue(args.chat_id)')
  expect(daemon).toContain('canonicalToolChannelKey(callerUuid, requestedCk)')
  expect(handleTool.indexOf('route = resolveToolCallRoute(callerUuid, msg.args)')).toBeLessThan(handleTool.indexOf('const adapter = adapterFor(ck)'))
  expect(handleTool).not.toContain('const ck = stringValue(msg.args.chat_id)')
})

test('shared Codex app-server tool calls are routed by room capability token', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const server = readFileSync('server.ts', 'utf8')
  const resolver = daemon.slice(daemon.indexOf('function resolveSharedCodexToolCall'), daemon.indexOf('function roomCwd'))
  expect(driver).toContain("const SHARED_CODEX_BRIDGE_ID = 'ccm-shared-codex-app-server'")
  expect(driver).toContain('CC_CHANNEL_SESSION_UUID: SHARED_CODEX_BRIDGE_ID')
  expect(driver).toContain('if (this.runtimes.size === 0 && runtime.client === this.client)')
  expect(daemon).toContain("const SHARED_CODEX_BRIDGE_ID = 'ccm-shared-codex-app-server'")
  expect(daemon).toContain("const CODEX_ROOM_TOKENS_FILE = join(STATE_DIR, 'codex-room-tokens.json')")
  expect(daemon).toContain('newCodexRoomToken(ck, uuid, bindingGeneration)')
  expect(daemon).toContain('meta: runtime === \'codex\' ? codexTurnMeta(ck, uuid, meta) : meta')
  expect(daemon).toContain("if (targetRuntime === 'codex') invalidateCodexRoomToken(ck, uuid)")
  expect(daemon).toContain("if (runtime === 'codex') invalidateCodexRoomToken(ck, uuid)")
  expect(resolver).toContain('const rawToken = optionalString(args.ccm_room_token)')
  expect(resolver).toContain("event: 'capability_token_missing'")
  expect(resolver).toContain("event: 'capability_token_unknown'")
  expect(resolver).toContain("event: 'capability_token_chat_mismatch'")
  expect(resolver).toContain("event: 'capability_token_binding_stale'")
  expect(resolver).toContain('currentSession !== token.sessionId || currentGeneration !== token.bindingGeneration')
  expect(daemon).toContain('uuid === SHARED_CODEX_BRIDGE_ID ? [] : routableChannelsForUuid(uuid)')
  expect(server).toContain('If <ccm_turn> includes ccm_room_token')
  expect(server).toContain("ccm_room_token: { type: 'string'")
})


test('peer cues rehydrate resumed sessions before sending turns', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const routeCue = daemon.slice(daemon.indexOf('async function routeCue'), daemon.indexOf('async function sendPeerCue'))
  expect(routeCue).toContain('let peerUuid = await ensureRoomAgentReady(ck, peer, false)')
  expect(routeCue).toContain("if (peer === 'claude' && !await waitForLiveBridge(peerUuid))")
  expect(routeCue).toContain('const session = currentAgentSession(peer, peerUuid)')
  expect(routeCue).not.toContain('claudeSessions.get(peerUuid) ?? claudeDriver.get(peerUuid)')
})

test('visible @peer cues route through the unified cue router', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function peerMentionTargets(text: string, fromRuntime: AgentRuntimeKind): AgentRuntimeKind[]')
  expect(daemon).toContain('async function routeVisiblePeerMentions')
  expect(daemon).toContain('await routeCue(cue)')
  expect(daemon).toContain("source: 'text_fallback'")
  expect(daemon).toContain("causeId: `visible_peer:${randomUUID()}`")
  expect(daemon).toContain("event: 'visible_peer_mention_failed'")
  expect(daemon).toContain("cue: cueMatch[1] ? 'visible_peer' : 'explicit'")
  expect(daemon).toContain('↔️ Cueing ${agentName(runtime)} in this room/thread.')
  expect(daemon).toContain('await routeVisiblePeerMentions(event.session.sessionId, ck, text, messageId, event.threadId ?? messageId)')
  expect(daemon).toContain('await routeVisiblePeerMentions(uuid, ck, item.text, item.key, item.replyTo ?? item.key)')
  expect(daemon).toContain('await routeVisiblePeerMentions(uuid, ck, text, ts, replyTo ?? ts)')
})

test('multi-agent cues use default lead with observer chime-in path', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const server = readFileSync('server.ts', 'utf8')
  expect(daemon).toContain('collabRoutingPlan(cmd.runtimes, bindingRuntime(ck))')
  expect(daemon).toContain('const lead = plan.lead')
  expect(daemon).toContain('const peers = plan.observers')
  expect(daemon).toContain('setRoomDefaultAgent(ck, lead)')
  expect(daemon).toContain('setRoomObservers(ck, peers)')
  expect(daemon).toContain('collabObserverTurnText(collab, cmd.text)')
  expect(daemon).toContain('async function chimeInAgent')
  expect(daemon).toContain('async function injectObserverChimeIn')
  expect(daemon).toContain('function latestActiveCollabForObserver')
  expect(daemon).toContain('const observerCollab = latestActiveCollabForObserver(ck, runtime, replyToArg)')
  expect(daemon).toContain("case 'chime_in':")
  expect(daemon).toContain("event: 'chime_in_denied'")
  expect(daemon).toContain("event: 'chime_in_injected'")
  expect(daemon).toContain('Observer(s):')
  expect(daemon).toContain('high-signal detail/context')
  expect(server).toContain("name: 'chime_in'")
  expect(server).toContain('Observer-only collaboration note')
  expect(server).toContain('detail/context/evidence/correction')
  expect(server).toContain('<ccm_collab_context role="observer">')
})

test('Codex slots default to in-repo .codex worktrees when available', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("const CODEX_WORKTREE_MODE")
  expect(daemon).toContain("import { safeWorktreeSlug } from './worktree.js'")
  expect(daemon).toContain('function prepareCodexCwd')
  expect(daemon).toContain("join(root, '.codex', 'worktrees')")
  expect(daemon).toContain("join(worktreesDir, uuid.slice(0, 8))")
  expect(daemon).toContain("['worktree', 'add', '-b', branch, path, 'HEAD']")
  expect(daemon).toContain("['worktree', 'add', path, branch]")
  expect(daemon).toContain("['status', '--porcelain=v1']")
  expect(daemon).toContain('prepareCodexCwd(cwd, sessionId)')
  expect(daemon).toContain('sourceCwd')
  expect(daemon).toContain('worktreeBranch')
  expect(daemon).not.toContain("join(root, '..', `${basename(root)}__wt__${name}`)")
})



test('Telegram self-test filtering uses a typed bot id field', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain("private botId = ''")
  expect(telegram).toContain("this.botId = telegramStringId(me.id) ?? ''")
  expect(telegram).toContain('export function normalizeTelegramInboundText')
  expect(telegram).toContain('const userId = telegramStringId(msg.from?.id)')
  expect(telegram).toContain('const rawText = telegramText(msg.text) || telegramText(msg.caption)')
  expect(telegram).toContain('const document = telegramDocument(msg.document)')
  expect(telegram).toContain('const photos = telegramPhotos(msg.photo)')
  expect(telegram).toContain('const inboundText = normalizeTelegramInboundText(rawText, userId, botId, selfTestPrefix)')
  expect(telegram).not.toContain('(this as any).botId')
  expect(telegram).not.toContain('selfTestPrefix!')
  expect(telegram).not.toContain("this.botId = String(me.id ?? '')")
  expect(telegram).not.toContain('telegram: bot @${me.username}')
})

test('Telegram reactions normalize unsupported CCM status emojis', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain('export function normalizeTelegramReaction')
  expect(telegram).toContain('TELEGRAM_REACTION_ALLOWLIST')
  expect(telegram).toContain('const REACTION_CACHE_TTL_MS = 60 * 60 * 1000')
  expect(telegram).toContain('private pruneReactionCache(now = Date.now()): void')
  expect(telegram).toContain('private reactionCache = new Map<string, { emojis: string[]; updatedAt: number }>()')
  expect(telegram).toContain('this.pruneReactionCache()')
  expect(telegram).toContain('const current = this.reactionCache.get(key)?.emojis ?? []')
  expect(telegram).toContain('this.reactionCache.set(key, { emojis: next, updatedAt: Date.now() })')
  expect(telegram).toContain('const normalized = emoji ? normalizeTelegramReaction(emoji) : undefined')
  expect(telegram).toContain('telegram: removeReaction(${emoji}) on ${channelId}/${messageId} failed')
  const removeReactionBody = telegram.slice(telegram.indexOf('async removeReaction'), telegram.indexOf('async showTyping'))
  expect(removeReactionBody).toContain('try {')
  expect(removeReactionBody).toContain('} catch (err) {')
  expect(removeReactionBody.indexOf('this.reactionCache.set')).toBeGreaterThan(removeReactionBody.indexOf("await this.api('setMessageReaction'"))
  expect(telegram).toContain("'🚫': '👎'")
  expect(telegram).toContain('unsupported reaction')
  expect(telegram.slice(telegram.indexOf('async addReaction'), telegram.indexOf('async removeReaction'))).not.toContain('throw err')
})




test('Telegram sent-message previews are redacted before logging', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain("import { errorMessage, redactSensitiveText } from '../redact.js'")
  expect(telegram).toContain("const preview = redactSensitiveText(text).replace(/\\s+/g, ' ').slice(0, 160)")
  expect(telegram).not.toContain("const preview = text.replace(/\\s+/g, ' ').slice(0, 160)")
})

test('Telegram adapter never partially parses message ids', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain('function telegramMessageIdNumber')
  expect(telegram).toContain("/^\\d+$/.test(value)")
  expect(telegram).toContain('Number.isSafeInteger(parsed) && parsed > 0')
  expect(telegram).not.toContain('parseInt(messageId)')
  expect(telegram).not.toContain('parseInt(opts.replyTo)')
})

test('Telegram callback interactions require data and channel identity', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain('const channelId = telegramChatId(cb.message?.chat)')
  expect(telegram).toContain('if (!cb.id || !cb.data || !channelId) return undefined')
  expect(telegram).toContain('data: cb.data')
  expect(telegram).toContain('messageId: telegramStringId(cb.message?.message_id)')
  expect(telegram).not.toContain('data: cb.data ??')
  expect(telegram).not.toContain('String(cb.message.message_id)')
})

test('Telegram compact callback tokens fail closed when stale', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain("if (!pending) return data.startsWith('tgcb:') ? undefined : data")
  expect(telegram).toContain('const data = this.resolveCallbackData(interaction.data)')
  expect(telegram).toContain('This button expired. Please rerun the command to refresh it.')
  expect(telegram).toContain('show_alert: true')
})

test('Slack callback interactions require data and channel identity', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('const channelId = stringValue(recordValue(payload.channel)?.id)')
  expect(slack).toContain('if (!data || !channelId) return undefined')
  expect(slack).toContain('channelId,')
  expect(slack).not.toContain('channelId: stringValue(recordValue(payload.channel)?.id)')
})

test('Slack search button accepts only exact search action payloads', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('export function slackSearchRuntimeFromAction')
  expect(slack).toContain('export function isSlackSearchAction(data: string): boolean')
  expect(slack).toContain("if (data === 'cmd:search') return undefined")
  expect(slack).toContain('const searchContext = slackSearchRuntimeFromAction(actionData)')
  expect(slack).toContain('if (searchContext !== null)')
  expect(slack).toContain('const triggerId = stringValue(payload.trigger_id)')
  expect(slack).toContain('if (triggerId && channelId)')
  expect(slack).not.toContain("startsWith('cmd:search')")
  expect(slack).not.toContain('if (searchContext !== null && stringValue(payload.trigger_id))')
  expect(slack).not.toContain('trigger_id: stringValue(payload.trigger_id)')
})

test('Telegram uploadFile uses checked Bot API envelopes', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain('private async multipartApi<T = unknown>(method: string, form: FormData): Promise<T>')
  expect(telegram).toContain(`const description = redactSensitiveText(typeof envelope.description === 'string' ? envelope.description : 'request failed')`)
  expect(telegram).toContain('error_code=${envelope.error_code}')
  expect(telegram).toContain('retry_after=${parameters.retry_after}')
  expect(telegram).toContain('migrate_to_chat_id=${parameters.migrate_to_chat_id}')
  expect(telegram).toContain('export async function telegramApiResultFromResponse<T = unknown>(method: string, response: Response): Promise<T>')
  expect(telegram).toContain("const contentType = response.headers.get('content-type') ?? 'unknown content-type'")
  expect(telegram).toContain(`const preview = redactSensitiveText(raw).replace(/\\s+/g, ' ').trim().slice(0, 200)`)
  expect(telegram).toContain('return telegramApiResultFromResponse<T>(method, res)')
  expect(telegram).toContain("const field = isImage ? 'photo' : 'document'")
  expect(telegram).toContain('form.append(field, new Blob([data]), filename)')
  expect(telegram).toContain("await this.multipartApi(isImage ? 'sendPhoto' : 'sendDocument', form)")
})
test('Telegram search replies require channel id and non-empty query', () => {
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(telegram).toContain('handleSearchReply(msg: TelegramMessage): boolean')
  expect(telegram).toContain('const query = typeof msg.text ===')
  expect(telegram).toContain('if (!channelId || !query) return false')
  expect(telegram).toContain('const key = searchContextKey(channelId, telegramStringId(msg.reply_to_message?.message_id))')
  expect(telegram).toContain('if (this.handleSearchReply(msg)) continue')
})




test('E2E plan includes markdown forward styling smoke', () => {
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  expect(plan).toContain('markdown styling prompt')
  expect(plan).toContain('**bold**, [link](https://example.com)')
  expect(plan).toContain('preserve table readability')
  expect(plan).toContain('without raw escape clutter')
})













test('Codex request acknowledgements fallback to main channel on threaded send failure', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('async function acknowledgeCodexRequest'), daemon.indexOf('async function acknowledgeCodexRequestEverywhere'))
  expect(block).toContain('codex request acknowledgement edit failed')
  expect(block).toContain('opts?.replyTo')
  expect(block).toContain('codex request acknowledgement send failed with reply_to=${opts.replyTo}')
  expect(block).toContain('await adapter.sendMessage(channelId, text, mainChannelFallbackOptions(opts)).catch')
  expect(block).toContain('codex request acknowledgement fallback send failed')
  expect(block).not.toContain('await adapter.sendMessage(channelId, text).catch')
  expect(block).not.toContain('await adapter.sendMessage(channelId, text, opts).catch')
})

test('codex nav and command proxy replies use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const navBlock = daemon.slice(daemon.indexOf('async function handleAgentNavCommand'), daemon.indexOf('function configuredCodexModel'))
  expect(navBlock).toContain("'codex nav no pending notice'")
  expect(navBlock).toContain("'codex nav action hint'")
  expect(navBlock).not.toContain('adapter?.sendMessage(localId(ck)')
  const commandBlock = daemon.slice(daemon.indexOf('async function deliverAgentCommand'), daemon.indexOf('async function onMessage'))
  expect(commandBlock).toContain('const commandNoticeOpts = threadId ? { replyTo: threadId, broadcast: true } : undefined')
  expect(commandBlock).toContain('`${runtime} command proxy unavailable notice`')
  expect(commandBlock).toContain('`${runtime} command result notice`')
  expect(commandBlock).toContain('`${runtime} command failure notice`')
  expect(commandBlock).toContain('commandNoticeOpts, `${runtime} command proxy unavailable notice`')
  expect(commandBlock).toContain('commandNoticeOpts, `${runtime} command result notice`')
  expect(commandBlock).toContain('commandNoticeOpts, `${runtime} command failure notice`')
  expect(commandBlock).not.toContain('adapter?.sendMessage(id')
})

test('agent snapshot nav and transcript replies use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const snapshotBlock = daemon.slice(daemon.indexOf('async function sendAgentSnapshot'), daemon.indexOf('async function sendClaudeNav'))
  expect(snapshotBlock).toContain('`${runtime} snapshot notice`')
  expect(snapshotBlock).toContain('`${runtime} snapshot unavailable notice`')
  expect(snapshotBlock).not.toContain('adapter?.sendMessage(id')
  const claudeNavBlock = daemon.slice(daemon.indexOf('async function sendClaudeNav'), daemon.indexOf('async function sendAgentNav'))
  expect(claudeNavBlock).toContain("'claude nav inactive pane notice'")
  expect(claudeNavBlock).not.toContain('adapter?.sendMessage(id')
  const navBlock = daemon.slice(daemon.indexOf('async function sendAgentNav'), daemon.indexOf('const TRANSCRIPT_ENTRY_TEXT_LIMIT'))
  expect(navBlock).toContain('`${runtime} no pending actions notice`')
  expect(navBlock).toContain('`${runtime} pending actions notice`')
  expect(navBlock).not.toContain('adapter?.sendMessage(id')
  const transcriptBlock = daemon.slice(daemon.indexOf('async function sendAgentTranscript'), daemon.indexOf('function codexNavActionAllowed'))
  expect(transcriptBlock).toContain('`${runtime} transcript fallback notice`')
  expect(transcriptBlock).toContain("if (runtime === 'claude')")
  expect(transcriptBlock).toContain('const transcript = claudeTranscript(session, limit)')
  expect(transcriptBlock).toContain('`${runtime} transcript unavailable notice`')
  expect(transcriptBlock).toContain('`${runtime} transcript notice`')
  expect(transcriptBlock).not.toContain('adapter?.sendMessage(id')
})

test('agent read-only commands are pure queries before start or passthrough', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('async function deliverAgentCommand'), daemon.indexOf('async function onMessage'))
  const statusIdx = block.indexOf('if (/^status$/i.test(commandName))')
  const snapshotIdx = block.indexOf('if (/^(ss|screen)$/i.test(commandName))')
  const transcriptIdx = block.indexOf('const transcriptMatch = commandName.match')
  const navIdx = block.indexOf('const navMatch = commandName.match')
  const startIdx = block.indexOf('const uuid = await ensureRoomAgentReady')
  expect(statusIdx).toBeGreaterThan(-1)
  expect(snapshotIdx).toBeGreaterThan(statusIdx)
  expect(transcriptIdx).toBeGreaterThan(snapshotIdx)
  expect(navIdx).toBeGreaterThan(transcriptIdx)
  expect(block).toContain("sendChannelNotice(ck, formatAgentReply(runtime, roomSummary(ck).join('\\n')), commandNoticeOpts, `${runtime} status summary`)")
  expect(block).toContain('const codexUuid = bindingUuid(ck, runtime)')
  expect(block).toContain('`${runtime} status not started notice`')
  expect(block).toContain('`${runtime} status not loaded notice`')
  for (const idx of [statusIdx, snapshotIdx, transcriptIdx, navIdx]) {
    expect(idx).toBeLessThan(startIdx)
    expect(idx).toBeLessThan(block.indexOf('if (!driver.sendCommand)'))
  }
})

test('agent control commands share lifecycle gate except interrupt aliases', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('async function deliverAgentCommand'), daemon.indexOf('async function onMessage'))
  const interruptIdx = block.indexOf("['cancel', 'stop', 'interrupt'].includes(commandVerb)")
  const gateIdx = block.indexOf('const uuid = await ensureRoomAgentReady(ck, runtime, false)')
  expect(interruptIdx).toBeGreaterThan(-1)
  expect(gateIdx).toBeGreaterThan(interruptIdx)
  expect(gateIdx).toBeLessThan(block.indexOf('if (!driver.sendCommand)'))
  expect(block).toContain('if (!uuid) return false')
  expect(block).not.toContain('const requiresLoadedSessionCommand =')
  expect(block).not.toContain('`${runtime} command not loaded notice`')
})

test('agent command help and model notices use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('async function deliverAgentCommand'), daemon.indexOf('const uuid = await ensureRoomAgentReady', daemon.indexOf('async function deliverAgentCommand')))
  expect(body).toContain('`${runtime} command help`')
  expect(body).toContain("'codex model reset notice'")
  expect(body).toContain("'codex model set notice'")
  expect(body).toContain("'codex model status'")
  expect(body).not.toContain('ensureRoomAgentReady')
  expect(body).not.toContain('adapter?.sendMessage(id')
})

test('path binding and slash passthrough confirmations use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slashBlock = daemon.slice(daemon.indexOf("    case 'slash':"), daemon.indexOf("    case 'new':"))
  expect(slashBlock).toContain("commandNoticeOpts, 'claude slash passthrough notice')")
  expect(slashBlock).toContain("commandNoticeOpts, 'claude slash passthrough failure notice')")
  expect(slashBlock).toContain('const writeOk = writeChars(paneId, cmd.command)')
  expect(slashBlock).toContain("const enterOk = writeOk ? sendKeys(paneId, 'Enter') : false")
  expect(slashBlock).toContain('if (!writeOk || !enterOk)')
  expect(slashBlock).not.toContain('adapter?.sendMessage(id')
  const newBlock = daemon.slice(daemon.indexOf("    case 'new':"), daemon.indexOf("    case 'resume_pick':"))
  expect(newBlock).toContain("undefined, 'room directory notice')")
  expect(newBlock).not.toContain('adapter?.sendMessage(id')
  const dirUseBlock = daemon.slice(daemon.indexOf("data.startsWith('dir:start:'"), daemon.indexOf("} else if (data.startsWith('dir:filter:')"))
  expect(dirUseBlock).toContain("undefined, 'directory use failure')")
  expect(dirUseBlock).toContain("undefined, 'directory use notice')")
  expect(dirUseBlock).not.toContain('adapter?.sendMessage(localId(ck)')
})

test('core room command replies use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('async function onMessage'), daemon.indexOf("    case 'slash':", daemon.indexOf('async function onMessage')))
  expect(body).toContain('sendChannelNotice(ck, roomSummary(ck).join(')
  expect(body).toContain("'agents summary'")
  expect(body).toContain("undefined, 'route summary')")
  expect(body).toContain("undefined, 'default agent notice')")
  expect(body).toContain("undefined, 'active agent notice')")
  expect(body).not.toContain('adapter?.sendMessage(id')
})


test('button-return and directory browser sends log failures without losing ids', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const returnBlock = daemon.slice(daemon.indexOf('async function sendWithButtonsReturn'), daemon.indexOf('/** Resolve pane_id'))
  expect(returnBlock).toContain("label = 'button notice'")
  expect(returnBlock).toContain('return await adapter.sendMessage(id, text, opts)')
  expect(returnBlock).toContain('daemon: ${label} send failed for ${ck}: ${errorMessage(err)}')
  expect(returnBlock).not.toContain("return await adapter.sendMessage(id, text, opts)\n}")
  const dialogBlock = daemon.slice(daemon.indexOf('async function sendDialogButtons'), daemon.indexOf('// ---------------------------------------------------------------------------', daemon.indexOf('async function sendDialogButtons')))
  expect(dialogBlock).toContain('await adapter.editMessage(id, existingMsgId, msg, opts)')
  expect(dialogBlock).toContain('return existingMsgId')
  expect(dialogBlock).toContain('editMessage failed for ${u}: ${errorMessage(err)}; keeping existing nav message')
  expect(dialogBlock).toContain('return await adapter.sendMessage(id, msg, opts)')
  expect(dialogBlock).toContain('claude dialog buttons send failed')
  expect(dialogBlock.indexOf('return existingMsgId')).toBeLessThan(dialogBlock.indexOf('editMessage failed for ${u}: ${errorMessage(err)}; keeping existing nav message'))
  expect(dialogBlock.indexOf('return existingMsgId')).toBeLessThan(dialogBlock.indexOf('return await adapter.sendMessage(id, msg, opts)'))
  const dirBlock = daemon.slice(daemon.indexOf('async function sendDirBrowser'), daemon.indexOf('async function sendFindResults'))
  expect(dirBlock).toContain('await sendChannelNotice(ck, text, opts, `${runtime} directory browser`)')
  expect(dirBlock).not.toContain('await adapter.sendMessage(id, text, opts)')
})

test('picker and button replies use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const buttonBlock = daemon.slice(daemon.indexOf('async function sendWithButtons(ck: string'), daemon.indexOf('/** Level 1: list folders'))
  expect(buttonBlock).toContain("label = 'button notice'")
  expect(buttonBlock).toContain('await sendChannelNotice(ck, text, opts, label)')
  expect(buttonBlock).not.toContain('await adapter.sendMessage')
  const pickerBlock = daemon.slice(daemon.indexOf('async function sendPicker'), daemon.indexOf('/** Level 2: list sessions'))
  expect(pickerBlock).toContain("await sendChannelNotice(ck, runtime ? formatAgentReply(runtime, headerLines.join('\\n'))")
  expect(pickerBlock).toContain("opts, 'session picker')")
  expect(pickerBlock).not.toContain('adapter.sendMessage')
  const folderBlock = daemon.slice(daemon.indexOf('async function sendFolderSessions'), daemon.indexOf('// ---------------------------------------------------------------------------', daemon.indexOf('async function sendFolderSessions')))
  expect(folderBlock).toContain("sendChannelNotice(ck, header, opts, 'session folder picker')")
  expect(folderBlock).not.toContain('adapter.sendMessage')
})

test('agent start and resume notices use observable channel notice helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const startBlock = daemon.slice(daemon.indexOf('async function startNew'), daemon.indexOf('function clearRuntimeState'))
  const resumeBlock = daemon.slice(daemon.indexOf('async function resumeAndBind'), daemon.indexOf('// ---------------------------------------------------------------------------', daemon.indexOf('async function resumeAndBind')))
  expect(startBlock).toContain("sendChannelNotice(ck, formatAgentReply(runtime, formatAgentStartFailure(runtime, 'start', result.error)), undefined, `${runtime} start failure`)")
  expect(startBlock).toContain('`${runtime} start notice`')
  expect(startBlock).not.toContain('adapterFor(ck)?.sendMessage(localId(ck)')
  expect(resumeBlock).toContain("sendChannelNotice(ck, formatAgentReply(runtime, formatAgentStartFailure(runtime, 'resume', error)), undefined, `${runtime} resume failure`)")
  expect(resumeBlock).toContain('`${runtime} resume notice`')
  expect(resumeBlock).toContain('`${runtime} bind notice`')
  expect(resumeBlock).not.toContain('adapterFor(ck)?.sendMessage(localId(ck)')
})

test('daemon session discovery logs unreadable transcript directories without noisy missing-dir warnings', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function logUnexpectedFsReadError(action: string, path: string, err: unknown): void')
  expect(daemon).toContain("if (errorCode(err) !== 'ENOENT') process.stderr.write(`daemon: ${action} ${path} failed: ${errorMessage(err)}\\n`)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Claude projects dir', CC_PROJECTS_DIR, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('stat Claude transcript candidate', path, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Claude project transcripts dir', projDir, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Codex sessions dir', dir, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Codex transcript search dir', dir, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Codex session cwd metadata', transcriptPath, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Codex session title metadata', transcriptPath, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read Claude session title metadata', transcriptPath, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('read sanitized path segment dir', current, err)")
  expect(daemon).toContain("logUnexpectedFsReadError('stat Claude transcript candidate', join(projDir, file), err)")
  expect(daemon).toContain("logUnexpectedFsReadError('stat Codex session candidate', path, err)")
  const claudeList = daemon.slice(daemon.indexOf('function listAllClaudeSessions'), daemon.indexOf('function listAllCodexSessions'))
  const codexList = daemon.slice(daemon.indexOf('function listAllCodexSessions'), daemon.indexOf('function listAllAgentSessions'))
  const prefixResolver = daemon.slice(daemon.indexOf('function boundAgentSessions'), daemon.indexOf('function channelsForUuid'))
  expect(prefixResolver).toContain('function boundAgentSessions(runtime?: AgentRuntimeKind): SessionInfo[]')
  expect(prefixResolver).toContain('const candidates = [...boundAgentSessions(preferred), ...listAllAgentSessions(500, preferred)]')
  expect(prefixResolver).toContain('live.has(entry.uuid) ? Date.now() : 0')
  expect(daemon).toContain('function setAgentMetaForUuid(uuid: string, runtime: AgentRuntimeKind, meta: AgentSlotMeta): void')
  expect(daemon).toContain('setAgentMetaForUuid(uuid, runtime, { transport: session.transport')
  expect(claudeList).toContain("} catch (err) {\n    logUnexpectedFsReadError('read Claude projects dir', CC_PROJECTS_DIR, err)")
  expect(claudeList).not.toContain('      } catch {}\n    }\n  } catch {}')
  expect(codexList).not.toContain('try { entries = readdirSync(dir) } catch { return }')
  const codexFind = daemon.slice(daemon.indexOf('function findCodexTranscript'), daemon.indexOf('function findTranscript'))
  expect(codexFind).not.toContain('try { entries = readdirSync(dir) } catch { return }')
  const unsanitize = daemon.slice(daemon.indexOf('function unsanitizePath'), daemon.indexOf('function findClaudeTranscript'))
  expect(unsanitize).toContain("logUnexpectedFsReadError('read sanitized path segment dir', current, err)")
  expect(unsanitize).not.toContain('} catch {}')
  const titleHelpers = daemon.slice(daemon.indexOf('function getCodexSessionCwd'), daemon.indexOf('function listSessions'))
  expect(titleHelpers).toContain('const entry = transcriptRecordFromLine(line)')
  expect(titleHelpers).not.toContain('} catch {}')
})

test('daemon filesystem cleanup logs unexpected errors while ignoring missing files', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function logUnexpectedFsCleanupError(action: string, path: string, err: unknown): void')
  expect(daemon).toContain("if (errorCode(err) !== 'ENOENT') process.stderr.write(`daemon: ${action} ${path} failed: ${errorMessage(err)}\\n`)")
  const shutdown = daemon.slice(daemon.indexOf('async function shutdown(): Promise<void>'))
  expect(shutdown).toContain("logUnexpectedFsCleanupError('unlink IPC socket during shutdown', SOCK_PATH, err)")
  expect(shutdown).toContain("logUnexpectedFsCleanupError('unlink pid file during shutdown', PID_FILE, err)")
  expect(shutdown).not.toContain('try { unlinkSync(SOCK_PATH) } catch {}')
  expect(shutdown).not.toContain('try { unlinkSync(PID_FILE) } catch {}')
})

test('daemon env file load ignores missing files but logs unreadable config', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('function loadEnvFile'), daemon.indexOf('const SHELL_ENV'))
  expect(body).toContain("if (errorCode(err) !== 'ENOENT')")
  expect(body).toContain('failed to load env file ${path}: ${errorMessage(err)}')
  expect(body).not.toContain('} catch {}')
})

test('daemon errno handling uses a shared safe helper', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function errorCode(err: unknown): string | undefined')
  expect(daemon).toContain("if (errorCode(err) !== 'ENOENT')")
  expect(daemon).toContain("catch (err) { return errorCode(err) === 'EPERM' }")
  expect(daemon).not.toContain('as NodeJS.ErrnoException')
})

test('daemon loads state env before derived config constants', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const loadDefault = daemon.indexOf("loadEnvFile(join(DEFAULT_STATE_DIR, '.env'))")
  const shellSnapshot = daemon.indexOf('const SHELL_ENV = new Map(Object.entries(process.env)')
  const stateDir = daemon.indexOf('const STATE_DIR = process.env.CHANNEL_DAEMON_STATE_DIR ?? DEFAULT_STATE_DIR')
  const loadCustom = daemon.indexOf('loadEnvFile(ENV_FILE, { override: true })')
  const defaultCwd = daemon.indexOf('const DEFAULT_CWD = process.env.CHANNEL_DAEMON_CWD')
  const defaultAgent = daemon.indexOf('const DEFAULT_AGENT_RUNTIME')
  expect(loadDefault).toBeGreaterThan(-1)
  expect(shellSnapshot).toBeGreaterThan(-1)
  expect(loadDefault).toBeGreaterThan(shellSnapshot)
  expect(stateDir).toBeGreaterThan(loadDefault)
  expect(loadCustom).toBeGreaterThan(stateDir)
  expect(defaultCwd).toBeGreaterThan(loadCustom)
  expect(defaultAgent).toBeGreaterThan(loadCustom)
  expect(daemon).toContain('for (const [key, value] of SHELL_ENV) process.env[key] = value')
  expect(daemon).toContain('if (opts.override || !process.env[key]) process.env[key] = val')
  expect(daemon).toContain('function envFileValue')
  expect(daemon).toContain('replace(/^export\\s+/,')
  expect(daemon).toContain('if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue')
  expect(daemon.indexOf('// Load .env')).toBe(-1)
})


test('env example covers README-documented operational knobs', () => {
  const env = readFileSync('.env.example', 'utf8')
  for (const name of [
    'CHANNEL_DAEMON_CWD',
    'CHANNEL_DAEMON_SPAWN_MODE',
    'CLAUDE_CHANNEL_MUX_PLUGIN_DIR',
    'CHANNEL_DAEMON_CODEX_WORKTREE',
    'CODEX_MODEL',
    'OPENAI_API_KEY',
    'CHANNEL_DAEMON_ASK_PEER_RATE_LIMIT',
    'CHANNEL_DAEMON_ASK_PEER_RATE_WINDOW_MS',
    'CHANNEL_DAEMON_ASK_PEER_MAX_INFLIGHT_PER_ROOM',
    'CHANNEL_DAEMON_ASK_PEER_INFLIGHT_TTL_MS',
    'CHANNEL_DAEMON_COLLAB_MAX_HANDOFFS',
    'CHANNEL_DAEMON_COLLAB_INLINE_CONTEXT_MAX_CHARS',
    'CHANNEL_DAEMON_COLLAB_STALE_TTL_MS',
    'CHANNEL_DAEMON_PEER_REPLY_INJECTION_MAX_CHARS',
    'CCM_AGENT_CONTEXT_TURN_MAX_CHARS',
    'CHANNEL_DAEMON_AGENT_CONTEXT_TURN_MAX_CHARS',
  ]) expect(env).toContain(name)
})

test('documented environment variables cover daemon aliases and forwarded env', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const env = readFileSync('.env.example', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  for (const name of [
    'CHANNEL_DAEMON_DEFAULT_AGENT',
    'CHANNEL_DAEMON_AGENT',
    'CCM_AGENT',
    'CLAUDE_CHANNEL_MUX_MARKETPLACE',
    'CHANNEL_DAEMON_FORWARD_ENV',
  ]) {
    expect(daemon).toContain(name)
    expect(readme).toContain(name)
  }
  expect(env).toContain('CHANNEL_DAEMON_FORWARD_ENV')
  expect(readme).toContain('OPENAI_API_KEY')
  expect(readme).toContain('Codex App Server credential')
  expect(env).toContain('CLAUDE_CHANNEL_MUX_MARKETPLACE')
  expect(env).toContain('CHANNEL_DAEMON_AGENT or CCM_AGENT')
})

test('service template docs call out placeholder replacement and unit names', () => {
  const readme = readFileSync('README.md', 'utf8')
  const service = readFileSync('ccm.service', 'utf8')
  const plist = readFileSync('ccm.plist', 'utf8')
  expect(service).toContain('/path/to/claude-channel-mux/daemon.ts')
  expect(plist).toContain('/path/to/claude-channel-mux/daemon.ts')
  expect(plist).toContain('/Users/YOU')
  expect(readme).toContain('replace `/path/to/claude-channel-mux` with this checkout path')
  expect(readme).toContain('systemctl --user daemon-reload')
  expect(readme).toContain('systemctl --user enable --now ccm.service')
  expect(readme).toContain('replace `/path/to/claude-channel-mux` plus `/Users/YOU`')
})


test('safe live testing docs require isolated state and channel allowlist', () => {
  const env = readFileSync('.env.example', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  const e2e = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  for (const source of [env, readme, e2e]) {
    expect(source).toContain('CHANNEL_DAEMON_STATE_DIR')
    expect(source).toContain('CHANNEL_DAEMON_ZELLIJ_SESSION')
    expect(source).toContain('CHANNEL_DAEMON_ALLOWED_CHANNELS')
  }
  expect(readme).toContain('same Slack/Telegram tokens as production')
  expect(readme).toContain('gates inbound events plus daemon fan-out')
  expect(e2e).toContain('gates inbound events plus daemon fan-out')
  expect(readme).toContain('does not make platform event delivery exclusive')
  expect(readme).toContain('keep production paused or use separate tokens')
  expect(e2e).toContain('not exclusive platform event delivery')
  expect(e2e).toContain('keep production paused')
  expect(readme).toContain('Keep `CHANNEL_DAEMON_SELF_TEST_PREFIX` unset')
  expect(readme).toContain('bun run e2e:preflight')
  expect(e2e).toContain('bun run e2e:preflight')
  expect(env).toContain('/tmp/ccm-e2e-state')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.scripts['e2e:preflight']).toBe('scripts/e2e-preflight.sh')
  const preflight = readFileSync('scripts/e2e-preflight.sh', 'utf8')
  expect(preflight).toContain('declare -A shell_env_values=()')
  expect(preflight).toContain("while IFS='=' read -r key value; do shell_env_values[\"$key\"]=\"$value\"; done < <(env)")
  expect(preflight).toContain('load_env_file "$default_state_dir/.env" false')
  expect(preflight).toContain('load_env_file "$CHANNEL_DAEMON_STATE_DIR/.env" true')
  expect(preflight).toContain('export "$key=${shell_env_values[$key]}"')
  expect(preflight).toContain('CHANNEL_DAEMON_ALLOWED_CHANNELS:?')
  expect(preflight).toContain('CHANNEL_DAEMON_SELF_TEST_PREFIX must be unset')
  expect(preflight).toContain('Set at least one platform token: SLACK_BOT_TOKEN or TELEGRAM_BOT_TOKEN')
  expect(preflight).toContain('SLACK_APP_TOKEN is required when SLACK_BOT_TOKEN is set')
  expect(preflight).toContain('SLACK_BOT_TOKEN is required when SLACK_APP_TOKEN is set')
  expect(preflight).toContain('CHANNEL_DAEMON_CWD/default cwd is not a readable directory')
  expect(preflight).toContain('production ccm-daemon.service is already running from this candidate worktree')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function channelAllowed(channelKey: string): boolean')
  expect(daemon).toContain('ALLOWED_CHANNELS.has(channelKey) || ALLOWED_CHANNELS.has(localId(channelKey))')
  expect(daemon).toContain('function routableChannelsForUuid(uuid: string, runtime?: AgentRuntimeKind): string[]')
  expect(daemon).toContain('return channelsForUuid(uuid, runtime).filter(ck => channelAllowed(ck))')
  for (const outbound of [
    'const channels = routableChannelsForUuid(uuid, event.session.kind)',
    'for (const ck of routableChannelsForUuid(event.session.sessionId, event.session.kind))',
    'const chans = routableChannelsForUuid(uuid)',
    'for (const ck of routableChannelsForUuid(uuid))',
    'const channels = routableChannelsForUuid(uuid)',
    'for (const ck of routableChannelsForUuid(uuid))',
    'const channels = routableChannelsForUuid(uuid, runtime)',
    "sendToLive(uuid, { type: 'registered', uuid, channels: routableChannelsForUuid(uuid) })",
    'for (const ch of uuid === SHARED_CODEX_BRIDGE_ID ? [] : routableChannelsForUuid(uuid))',
    'const chans = routableChannelsForUuid(s.uuid, s.runtime)',
    'const sessions = listSessions().filter(s => live.has(s.uuid) && routableChannelsForUuid(s.uuid, s.runtime).length > 0)',
  ]) {
    expect(daemon).toContain(outbound)
  }
  const adapterWiring = daemon.slice(daemon.indexOf('for (const adapter of activeAdapters)'), daemon.indexOf('for (const adapter of activeAdapters) adapter.start'))
  for (const handler of ['adapter.onMessage', 'adapter.onSearch', 'adapter.onInteraction']) {
    const start = adapterWiring.indexOf(handler)
    expect(start).toBeGreaterThanOrEqual(0)
    const handlerBlock = adapterWiring.slice(start, adapterWiring.indexOf('})', start) + 2)
    expect(handlerBlock).toContain('if (!channelAllowed(ck)) return')
  }
})

test('public environment knobs are documented in README and env example', () => {
  const code = [
    readFileSync('daemon.ts', 'utf8'),
    readFileSync('server.ts', 'utf8'),
    readFileSync('hooks/pre-compact.ts', 'utf8'),
    readFileSync('adapters/slack.ts', 'utf8'),
    readFileSync('adapters/telegram.ts', 'utf8'),
    readFileSync('agents/claude/channel-driver.ts', 'utf8'),
    readFileSync('agents/codex/app-server-client.ts', 'utf8'),
    readFileSync('agents/codex/app-server-driver.ts', 'utf8'),
  ].join('\n')
  const readme = readFileSync('README.md', 'utf8')
  const env = readFileSync('.env.example', 'utf8')
  const keys = [...code.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map(match => match[1])
  const internal = new Set(['CC_CHANNEL_DAEMON_SOCK', 'CC_CHANNEL_SESSION_UUID', 'NODE_ENV'])
  const publicKeys = [...new Set(keys.filter(key => !internal.has(key)))].sort()
  for (const key of publicKeys) {
    expect(readme).toContain(key)
    expect(env).toContain(key)
  }
  for (const key of internal) {
    expect(readme).not.toContain(key)
    expect(env).not.toContain(key)
  }
})


test('validation toolchain pins project-level TypeScript coverage', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = readFileSync('bun.lock', 'utf8')
  const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'))
  expect(pkg.devDependencies.typescript).toBeTruthy()
  expect(pkg.scripts.typecheck).toBe('tsc -p tsconfig.json')
  expect(pkg.scripts.typecheck).not.toContain('bunx tsc')
  expect(tsconfig.compilerOptions.noEmit).toBe(true)
  expect(tsconfig.compilerOptions.allowImportingTsExtensions).toBe(true)
  expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler')
  for (const pattern of ['*.ts', 'adapters/**/*.ts', 'agents/**/*.ts', 'hooks/**/*.ts', 'test/**/*.ts']) {
    expect(tsconfig.include).toContain(pattern)
  }
  expect(lock).toContain('typescript')
})

test('package exposes one-command validation gate and docs reference it', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const readme = readFileSync('README.md', 'utf8')
  const e2e = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  expect(pkg.scripts.test).toBe('bun test')
  expect(pkg.scripts.typecheck).toBe('tsc -p tsconfig.json')
  expect(pkg.scripts['check:diff']).toBe('git diff --check')
  expect(pkg.scripts['orchestration:new']).toBe('bun scripts/new-orchestration.ts')
  expect(pkg.scripts['orchestration:adopt']).toBe('bun scripts/adopt-orchestration.ts')
  expect(pkg.scripts['orchestration:inbox']).toBe('bun scripts/orchestration-inbox.ts')
  expect(pkg.scripts['validate:orchestration']).toBe('bun scripts/validate-orchestration.ts')
  expect(pkg.scripts.validate).toBe('bun run test && bun run typecheck && bun run validate:orchestration && bun run check:diff')
  expect(readme).toContain('bun run validate')
  expect(readme).toContain('validate:orchestration')
  expect(readme).toContain('bun run orchestration:new')
  expect(readme).toContain('bun run orchestration:adopt')
  expect(readme).toContain('bun run orchestration:inbox')
  expect(readme).toContain('git diff --check')
  expect(e2e).toContain('Run `bun run validate` and `bun run e2e:preflight` from the candidate worktree before switching any live service.')
})


test('E2E plan keeps Claude regression smoke alongside Codex parity', () => {
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  expect(plan).toContain('## Claude Regression Smoke')
  expect(plan).toContain('claude: say exactly CC_READY')
  expect(plan).toContain('/cc ss')
  expect(plan).toContain('/cc transcript 5')
  expect(plan).toContain('/cc nav')
  expect(plan).toContain('CC_THREAD_OK')
  expect(plan).toContain('Claude regression smoke passes')
})

test('E2E plan includes live-only thread broadcast and pending identity gates', () => {
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  expect(plan).toContain('reply_broadcast')
  expect(plan).toContain('THREAD_OK')
  expect(plan).toContain('acknowledgement/edit should still show the `🟢 Codex` identity header')
  expect(plan).toContain('all pending acknowledgements/edited panels keep the `🟢 Codex` identity header')
  expect(plan).toContain('no invented actions outside `availableDecisions`')
  expect(plan).toContain('session|policy|network|deny|abort` should operate')
  expect(plan).toContain('Telegram quoted replies preserve reply anchoring')
})

test('README documents Codex pending request UX', () => {
  const readme = readFileSync('README.md', 'utf8')
  expect(readme).toContain(String.raw`/cx nav [N] [allow\|session\|policy\|network\|deny\|abort\|answer <text>]`)
  expect(readme).toContain('pending Codex requests include action buttons and target request id')
  expect(readme).toContain('The panel names the target request id/method')
  expect(readme).toContain('/cx nav N allow|session|policy|network|deny|abort')
  expect(readme).toContain('Approval buttons mirror Codex `availableDecisions`')
  expect(readme).toContain('`Allow Policy` / `Allow Network`')
  expect(readme).toContain('Clear stale request')
  expect(readme).toContain('exposes only `Clear stale request`, not live approval buttons')
  expect(readme).toContain('Native `/ccm`, `/cc`, and `/cx` commands')
  expect(readme).toContain('slack-app-manifest.json')
  expect(readme).not.toContain('slack-app-manifest.yml')
})

test('/cx ss and /cx nav rehydrate pending Codex request buttons', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const codexResponse = readFileSync('codex-response.ts', 'utf8')
  expect(codexResponse).toContain('export function codexPendingRequestButtons')
  expect(daemon).toContain('function sendCodexPendingActionPanel')
  expect(daemon).toContain('const rendered = renderAgentSnapshot(stale)')
  expect(daemon).toContain('if (stale.pending.length && await sendCodexPendingActionPanel(ck, uuid, rendered, { stale: true })')
  expect(daemon).toContain("actions: ['clear stale request']")
  expect(daemon).toContain('Clear the stale request, then resume or cue Codex again.')
  expect(daemon).toContain('Clear stale request')
  expect(daemon).toContain("decision === 'clear_stale'")
  expect(daemon).toContain('Cleared stale Codex request')
  expect(daemon).toContain('const rendered = renderAgentSnapshot(snapshot)')
  expect(daemon).toContain("runtime === 'codex' && snapshot.pending.length && await sendCodexPendingActionPanel")
  expect(daemon).toContain("runtime === 'codex' && await sendCodexPendingActionPanel(ck, uuid, lines.join")
  expect(daemon).toContain('const pending = sortedPendingCodexRequests(ck, sessionId)')
  expect(daemon).toContain('Target request: ${first.method} (${first.requestId})')
  expect(daemon).toContain('more pending')
  expect(daemon).toContain('Use the buttons below, or reply to this panel or the original Codex prompt for text input.')
  expect(daemon).toContain('await sendWithButtonsReturn(ck, formatAgentReply')
  expect(daemon).toContain('latest.messageIds = [...new Set')
  expect(daemon).toContain('return req.messageId === replyToId || (req.messageIds ?? []).includes(replyToId)')
})

test('/cx nav indexed actions are scoped to the current Codex slot', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('prunePendingCodexRequests()')
  expect(daemon).toContain('const slotUuid = bindingUuid(ck, runtime)')
  expect(daemon).toContain('req.channelKey === ck && (!slotUuid || req.sessionId === slotUuid)')
  expect(daemon).toContain('.sort(([, a], [, b]) => a.createdAt - b.createdAt)')
  expect(daemon).toContain('approve_network|deny')
  expect(daemon).toContain("actionRaw === 'policy' || actionRaw === 'approve_policy'")
  expect(daemon).toContain("actionRaw === 'network' || actionRaw === 'approve_network'")
  expect(daemon).not.toContain('clear|clear_stale|answer')
  expect(daemon).not.toContain("actionRaw === 'clear' || actionRaw === 'clear_stale'")
  expect(daemon).toContain('answer <text>')
  expect(daemon).toContain('Valid actions: ${actionHint}')
  expect(daemon).toContain('policy')
  expect(daemon).toContain('network')
  expect(daemon).toContain('if (!answerText.trim())')
  expect(daemon).toContain('Missing answer text')
  expect(daemon).toContain('function codexNavActionAllowed')
  expect(daemon).toContain('return codexRequestActionAllowed(request, action)')
  const codexResponse = readFileSync('codex-response.ts', 'utf8')
  expect(codexResponse).toContain('export function codexRequestActionAllowed')
  expect(codexResponse).toContain("request.method === 'item/tool/requestUserInput'")
  expect(codexResponse).toContain("request.method === 'item/permissions/requestApproval'")
  expect(daemon).toContain('Action ${actionRaw} is not valid')
  expect(daemon).toContain("if (decision !== 'opt' && !codexNavActionAllowed(pending, decision))")
  expect(daemon).toContain('Codex request action ${decision} is not valid for ${pending.method}')
  expect(daemon).toContain('clear_stale:${sessionId}')
  expect(daemon).toContain('const isStalePanel = staleSessionId === pending.sessionId && !codexSessions.has(pending.sessionId)')
  expect(daemon).toContain('Clear is only available for stale Codex requests')
})







test('adapter payload tests use explicit test injection hooks', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  const testSource = readFileSync('test/adapter-payload.test.ts', 'utf8')
  expect(slack).toContain('injectWebClientForTest')
  expect(telegram).toContain('injectApiForTest')
  expect(telegram).toContain('telegramMessageResult')
  expect(telegram).toContain('telegramFileResult')
  expect(telegram).toContain('return recordValue(value) ?? {}')
  expect(testSource).toContain('Telegram start normalizes malformed bot identity fields')
  expect(telegram).toContain('const messageId = r.message_id == null ? undefined : String(r.message_id)')
  expect(telegram).toContain('telegramApiResult<T>')
  expect(telegram).not.toContain("return typeof value === 'object' && value ? value as TelegramMessageResult : {}")
  expect(telegram).not.toContain("return typeof value === 'object' && value ? value as TelegramFileResult : {}")
  expect(telegram).not.toContain('firstId = String(r.message_id)')
  expect(telegram).toContain('function recordValue(value: unknown): Record<string, unknown> | undefined')
  expect(telegram).toContain('const envelope = recordValue(value)')
  expect(telegram).not.toContain('const envelope = value as { ok?: unknown; description?: unknown; result?: unknown }')
  expect(telegram).not.toContain('res.json() as any')
  expect(testSource).toContain('slack.injectWebClientForTest')
  expect(testSource).toContain('telegram.injectApiForTest')
  expect(testSource).not.toContain('as any')
  expect(testSource).not.toContain('Record<string, any>')
})

test('adapter download failures include platform and file id', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(slack).toContain('export async function slackDownloadHttpError(fileId: string, resp: Response): Promise<Error>')
  expect(slack).toContain('Slack download ${fileId}: HTTP ${resp.status}, ${contentType}')
  expect(slack).toContain('body: ${preview}')
  expect(slack).toContain(`redactSensitiveText(raw).replace(/\\s+/g, ' ').trim().slice(0, 200)`)
  expect(slack).toContain('if (!resp.ok) throw await slackDownloadHttpError(fileId, resp)')
  expect(slack).toContain('Slack download ${fileId}: missing download URL')
  expect(telegram).toContain('Telegram download ${fileId}: HTTP ${resp.status}')
  expect(telegram).toContain('Telegram download ${fileId}: missing file path')
  expect(slack).not.toContain('throw new Error(`Download ${resp.status}`)')
  expect(telegram).not.toContain('throw new Error(`Download ${resp.status}`)')
})
test('adapter downloads sanitize local file path components', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  for (const source of [slack, telegram]) {
    expect(source).toContain('function safeDownloadName(value: string): string')
    expect(source).toContain('const id = safeDownloadName(fileId)')
    expect(source).toContain('const dest = `${this.inboxDir}/${id}-${name}`')
    expect(source).not.toContain('const dest = `${this.inboxDir}/${fileId}-${name}`')
  }
})
test('adapter downloads use shared response body stream helper', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  const stream = readFileSync('adapters/stream.ts', 'utf8')
  expect(stream).toContain('function responseBodyStream')
  expect(slack).toContain('responseBodyStream(resp)')
  expect(telegram).toContain('responseBodyStream(resp)')
  expect(slack).not.toContain('resp.body as any')
  expect(telegram).not.toContain('resp.body as any')
})

test('adapter inbound handlers catch callback rejections', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  for (const source of [slack, telegram]) {
    expect(source).toContain('private dispatchMessage(msg: InboundMessage): void')
    expect(source).toContain('private dispatchInteraction(interaction: InteractionCallback): void')
    expect(source).toContain('private dispatchSearch(channelId: string, query: string, context?: SearchContext): void')
    expect(source).toContain('void Promise.resolve(this.messageCb?.(msg)).catch')
    expect(source).toContain('void Promise.resolve(this.interactionCb?.(interaction)).catch')
    expect(source).toContain('void Promise.resolve(this.searchCb?.(channelId, query, context)).catch')
    expect(source).not.toContain('if (msg) this.messageCb?.(msg)')
    expect(source).not.toContain('if (interaction) this.interactionCb?.(interaction)')
  }
  expect(slack).toContain('if (pending && modal) this.dispatchSearch(pending.channelId, modal.query, pending.context)')
  expect(telegram).toContain('this.dispatchSearch(channelId, query, pending?.context)')
  for (const source of [slack, telegram]) {
    expect(source).not.toContain('this.searchCb(pending.channelId, modal.query, pending.context)')
    expect(source).not.toContain('this.searchCb(channelId, query, context)')
  }
})
test('adapter SDK inbound boundaries avoid any escape hatches', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')

  expect(slack).toContain('type SlackInteractiveEnvelope = { body?: unknown; ack?: SlackAck }')
  expect(slack).toContain('async function slackAck(ack: SlackAck | undefined, label: string): Promise<void>')
  expect(slack).toContain("await slackAck(ack, 'message')")
  expect(slack).toContain("await slackAck(ack, 'interactive')")
  expect(slack).toContain("await slackAck(ack, 'slash_commands')")
  expect(slack).toContain("this.socket.on('interactive', async ({ body, ack }: SlackInteractiveEnvelope)")
  expect(slack).toContain("this.socket.on('slash_commands', async ({ body, ack }: SlackSlashEnvelope)")
  expect(slack).toContain('export function slackModalViewId(body: unknown): string | undefined')
  expect(slack).toContain('export function slackModalSubmission(body: unknown): { viewId: string; query: string } | undefined')
  expect(slack).toContain('export function slackInteractionCallback(body: unknown): InteractionCallback | undefined')
  expect(slack).toContain('export function slackSlashInboundMessage(body: unknown): InboundMessage | undefined')
  expect(slack).toContain('function optionalStringValue(value: unknown): string | undefined')
  expect(slack).toContain('function fallbackStringValue(value: unknown): string | undefined')
  expect(slack).toContain('function slackPostTs(value: unknown): string | undefined')
  expect(slack).toContain('function slackTimestampIso(value: unknown): string')
  expect(slack).toContain('this.botUserId = stringValue(recordValue(auth)?.user_id)')
  expect(slack).toContain('replyToId: optionalStringValue(event.thread_ts)')
  expect(slack).toContain('return slackPostTs(res)')
  expect(slack).toContain('const modalViewId = slackModalViewId(payload)')
  expect(slack).toContain('this.prunePendingSearchChannels()')
  expect(slack).toContain('this.pendingSearchChannels.delete(modalViewId)')
  expect(slack).toContain("try {\n            const res = await this.webClient.views.open({")
  expect(slack).toContain('slack: search modal open failed')
  expect(slack).toContain('Failed to open directory search modal. Try `ccm find <query>` instead.')
  expect(slack).toContain('slack: search modal failure notice failed for ${channelId}: ${errorMessage(sendErr)}')
  expect(slack).not.toContain('      await ack()')
  expect(slack).not.toContain('      await ack?.()')
  expect(slack).not.toContain('this.pendingSearchChannels.delete(modal.viewId)')
  expect(slack).not.toContain(': any) =>')
  expect(slack).not.toContain('auth.user_id as string')
  expect(slack).not.toContain('auth.bot_id as string')
  expect(slack).not.toContain('event.thread_ts as string')
  expect(slack).not.toContain('res.ts as string')
  expect(telegram).toContain('type TelegramUpdate = { update_id?: number; callback_query?: TelegramCallbackQuery; message?: TelegramMessage }')
  expect(telegram).toContain('function telegramUpdates(value: unknown): TelegramUpdate[]')
  expect(telegram).toContain('function telegramString(value: unknown): string | undefined')
  expect(telegram).toContain('function telegramStringId(value: unknown): string | undefined')
  expect(telegram).toContain('function telegramTimestampIso(value: number | string | undefined): string')
  expect(telegram).toContain('function telegramText(value: unknown): string')
  expect(telegram).toContain('function telegramPhotos(value: unknown): TelegramPhoto[]')
  expect(telegram).toContain('function telegramDocument(value: unknown): TelegramDocument | undefined')
  expect(telegram).toContain('function telegramAttachmentSize(value: unknown): string | undefined')
  expect(telegram).toContain('const meta: Record<string, string> = { ts: telegramTimestampIso(msg.date) }')
  expect(telegram).toContain('export function telegramCallbackInteraction(cb: TelegramCallbackQuery): InteractionCallback | undefined')
  expect(telegram).toContain('export function telegramInboundMessage(msg: TelegramMessage, botId =')
  expect(telegram).toContain('if (!channelId || !userId || !messageId) return undefined')
  expect(telegram).toContain('answerCallbackQuery expired alert failed')
  expect(telegram).toContain('answerCallbackQuery ack failed')
  expect(telegram).toContain('const inboundText = normalizeTelegramInboundText(rawText, userId, botId, selfTestPrefix)')
  expect(telegram).toContain('userName: telegramText(msg.from?.username) || telegramText(msg.from?.first_name) || userId')
  expect(telegram).toContain("const updates = telegramUpdates(await this.api<unknown>('getUpdates'")
  expect(telegram).not.toContain('Record<string, any>')
  expect(telegram).not.toContain('userId: String(msg.from?.id)')
  expect(telegram).not.toContain('messageId: String(msg.message_id)')
  expect(telegram).not.toContain('return chat?.id == null ?')
  expect(telegram).not.toContain('const id = String(value)')
  expect(telegram).not.toContain('new Date((msg.date ?? 0) * 1000).toISOString()')
  expect(telegram).not.toContain('const rawText = msg.text ?? msg.caption ??')
  expect(telegram).not.toContain('if (msg.photo)')
  expect(telegram).not.toContain('if (msg.document)')
  expect(telegram).not.toContain('meta.attachment_name = msg.document.file_name')
  expect(telegram).not.toContain('meta.attachment_size = String(msg.document.file_size)')
})

test('adapter renderButtons chunks platform button rows', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(slack).toContain('for (let i = 0; i < buttons.length; i += 5)')
  expect(slack).toContain('const chunk = buttons.slice(i, i + 5)')
  expect(telegram).toContain('for (let i = 0; i < buttons.length; i += 2)')
  expect(telegram).toContain('buttons.slice(i, i + 2).map')
  expect(slack).not.toContain('elements: buttons.map')
  expect(telegram).not.toContain('inlineKeyboard: [buttons.map')
})
test('Slack callback payloads compact both action ids and values', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('function slackActionId(data: string): string')
  expect(slack).toContain('const CALLBACK_VALUE_LIMIT = 1900')
  expect(slack).toContain('private compactCallbackValue(data: string): string')
  expect(slack).toContain('private resolveCallbackValue(data: string, opts: { consume?: boolean } = {}): string | undefined')
  expect(slack).toContain('const actionData = this.resolveCallbackValue(rawActionData, { consume: false })')
  expect(slack).toContain('action_id: slackActionId(b.data)')
  expect(slack).toContain('value: this.compactCallbackValue(b.data)')
  expect(slack).toContain("if (!pending) return data.startsWith('slcb:') ? undefined : data")
  expect(slack).toContain('if (!actionData) {')
  expect(slack).toContain('This button expired after a CCM restart or timeout')
  expect(slack).toContain('expired button warning send failed for ${channelId}: ${errorMessage(err)}')
  expect(slack).not.toContain("void this.sendMessage(channelId, '⚠️ This button expired after a CCM restart or timeout. Please rerun the command to refresh it.')\n")
  expect(slack).toContain('const data = this.resolveCallbackValue(interaction.data)')
  expect(slack).toContain('if (data) this.dispatchInteraction({ ...interaction, data })')
  expect(slack).not.toContain('value: b.data')
})





test('daemon invalid known callbacks reply with a visible refresh hint', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('async function sendInvalidButtonMessage')
  expect(daemon).toContain('This button is stale or malformed. Please rerun the command to refresh it.')
  expect(daemon).toContain('if (page == null) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).toContain("if (!parsed) { await sendInvalidButtonMessage(ck, 'claude'); return }")
  expect(daemon).toContain('if (!uuid) { await sendInvalidButtonMessage(ck); return }')
  expect(daemon).not.toContain(`if (page == null) return
      await sendPicker`)
  expect(daemon).not.toContain(`if (!parsed) return
      const paneId = resolvePaneId`)
})

test('daemon treats page display buttons as no-op callbacks', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("data === 'ccr:__noop' || data === 'noop'")
  expect(daemon).toContain("bottomButtons.push({ text: `${page + 1}/${totalPages}`, data: 'noop' })")
})

test('adapter inline keyboards stay behind typed SendOptions contract', () => {
  const types = readFileSync('adapters/types.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')

  expect(types).toContain('export type PlatformInlineKeyboard = unknown')
  expect(types).toContain('inlineKeyboard?: PlatformInlineKeyboard')
  expect(types).toContain('renderListPicker(items: PickerItem[], page: number, totalPages: number, callbackPrefix: string): SendOptions')
  expect(types).toContain('renderButtons(buttons: ButtonItem[]): SendOptions')
  expect(types).not.toContain('inlineKeyboard?: any')
  expect(daemon).not.toContain('renderButtons(buttons) as { inlineKeyboard?: unknown }')
  expect(types).not.toMatch(/render(?:ListPicker|Grid|Buttons)[\s\S]*?: any/)
  expect(slack).toContain('function slackInlineKeyboard(value: unknown): SlackBlock[]')
  expect(slack).toContain('function recordValue(value: unknown): Record<string, unknown> | undefined')
  expect(slack).toContain('value !== null && !Array.isArray(value)')
  expect(telegram).toContain('function telegramInlineKeyboard(value: unknown): TelegramInlineKeyboard | undefined')
})

test('Slack adapter centralizes WebClient startup assertion', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('private get webClient(): WebClient')
  expect(slack).toContain("throw new Error('Slack adapter is not started')")
  expect(slack).toContain('this.webClient.chat.postMessage')
  expect(slack).not.toContain('this.web!.')
})

test('Slack file metadata is typed and behavior-tested', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('function slackFileString(value: unknown): string | undefined')
  expect(slack).toContain('function slackFileSize(value: unknown): string | number | undefined')
  expect(slack).toContain('function slackFileInfos(value: unknown): SlackFileInfo[]')
  expect(slack).toContain('export function slackFileMetadata(files: unknown): Record<string, string>')
  expect(slack).toContain('Object.assign(meta, slackFileMetadata(event.files))')
  expect(slack).not.toContain('event.files as any')
  expect(slack).not.toContain('export function slackFileMetadata(files: SlackFileInfo[] | undefined)')
  expect(slack).not.toContain('if (!files?.length) return {}')
  expect(slack).not.toContain('if (first.size != null) meta.attachment_size = String(first.size)')
})

test('Slack bot-message inbound uses typed fallback identity', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('export function slackInboundIdentity')
  expect(slack).toContain('export function slackInboundEventFields')
  expect(slack).toContain('.flatMap(value => fallbackStringValue(value) ?? [])')
  expect(slack).toContain('fallbackStringValue(event.username) ?? fallbackStringValue(event.bot_profile?.name) ?? userId')
  expect(slack).toContain('const fields = slackInboundEventFields(event)')
  expect(slack).toContain('if (!fields) return')
  expect(slack).toContain('const identity = slackInboundIdentity(event, this.botUserId, this.botId)')
  expect(slack).toContain('if (!userId) return')
  expect(slack).toContain('channelId: fields.channelId')
  expect(slack).toContain('messageId: fields.messageId')
  expect(slack).toContain('text: fields.text')
  expect(slack).toContain('timestamp <= 0')
  expect(slack).toContain('userId,')
  expect(slack).not.toContain('resolveUserName(event.user)')
  expect(slack).not.toContain('String(event.username ?? event.bot_profile?.name ?? userId)')
  expect(slack).not.toContain(`.map(value => String(value ??`)
  expect(slack).not.toContain('.find(Boolean) ??')
  expect(slack).not.toContain('r.user?.profile?.display_name || r.user?.real_name || r.user?.name || userId')
  expect(slack).not.toContain('parseFloat(m.ts')
  expect(slack).not.toContain('for (const m of res.messages ?? [])')
  expect(slack).not.toContain('userId: event.user')
  expect(slack).not.toContain('channelId: event.channel')
  expect(slack).not.toContain('messageId: event.ts')
  expect(slack).not.toContain('parseFloat(event.ts)')
})

test('Slack user display-name lookup failures log before falling back to user id', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const body = slack.slice(slack.indexOf('private async resolveUserName'), slack.indexOf('async fetchThread'))
  expect(body).toContain('this.webClient.users.info({ user: userId })')
  expect(body).toContain('slack: users.info failed for ${userId}: ${errorMessage(err)}')
  expect(body).toContain('return userId')
  expect(body).not.toContain('} catch { return userId }')
})

test('Slack slash command bridge covers /cx without duplicate message id', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const manifest = readFileSync('slack-app-manifest.json', 'utf8')
  expect(slack).toContain('Handle Slack slash commands (/ccm, /cc, /cx)')
  for (const command of ['\"command\": \"/ccm\"', '\"command\": \"/cc\"', '\"command\": \"/cx\"']) expect(manifest).toContain(command)
  const parsed = JSON.parse(manifest)
  const commands = parsed.features.slash_commands
  const ccm = commands.find((cmd: { command: string }) => cmd.command === '/ccm')
  const cc = commands.find((cmd: { command: string }) => cmd.command === '/cc')
  const cx = commands.find((cmd: { command: string }) => cmd.command === '/cx')
  expect(ccm.description).toBe('Claude Channel Mux — room, resume, stop, help')
  expect(cx.description).toBe('Codex command proxy — help, ss, nav, transcript, goal, cancel')
  expect(cc.description).toBe('Claude command proxy — help, ss, nav, transcript, cancel')
  expect(ccm.usage_hint).toBe('[default claude|codex | agents | route | orchestrator/orch on|off|status | resume [agent] | stop [agent] | find <query> | help]')
  expect(cc.usage_hint).toBe('<command> (e.g. help, ss, nav, transcript, compact, model, cancel)')
  expect(cx.usage_hint).toBe('<command> (e.g. help, ss, nav, transcript, status, mcp, model, goal, cancel)')
  for (const name of ['default', 'agents', 'route', 'orchestrator', 'resume', 'stop', 'find', 'help']) expect(ccm.usage_hint).toContain(name)
  for (const name of ['help', 'ss', 'nav', 'transcript', 'compact', 'model', 'cancel']) expect(cc.usage_hint).toContain(name)
  for (const name of ['help', 'ss', 'nav', 'transcript', 'status', 'mcp', 'model', 'goal', 'cancel']) expect(cx.usage_hint).toContain(name)
  expect(manifest).not.toContain('exit, cost')
  expect(manifest).toContain('Claude Code and Codex')
  expect(slack).toContain('export function normalizeSlackSlashCommandText')
  expect(slack).toContain('export function slackSlashInboundMessage')
  expect(slack).toContain('const msg = slackSlashInboundMessage(payload)')
  expect(slack).toContain('normalizeSlackSlashCommandText(command, text)')
  const slashHelper = slack.slice(slack.indexOf('export function slackSlashInboundMessage'), slack.indexOf('export type SlackInboundIdentityInput'))
  expect((slashHelper.match(/messageId:/g) ?? []).length).toBe(1)
})

test('Slack slash inbound requires channel and user identity', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('const userId = stringValue(payload.user_id)')
  expect(slack).toContain('if (!command || !channelId || !userId) return undefined')
  expect(slack).toContain('userName: stringValue(payload.user_name) || userId')
})

test('slash command audit and command visibility use central daemon paths', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const onMessageBlock = daemon.slice(daemon.indexOf('async function onMessage'), daemon.indexOf('async function routeVisiblePeerMentions'))
  const commandBlock = daemon.slice(daemon.indexOf('async function deliverAgentCommand'), daemon.indexOf('async function onMessage'))
  const toolBlock = daemon.slice(daemon.indexOf('async function handleTool'), daemon.indexOf('// ---------------------------------------------------------------------------\n// Permission request'))
  expect(slack).toContain("meta: { ts: new Date().toISOString(), source: 'slack_slash_command', command, raw_text: text }")
  expect(daemon).toContain("event: 'slack_slash_command_received'")
  expect(onMessageBlock).toContain('const cmd = parseCmd(msg.text)')
  expect(onMessageBlock).toContain('auditInboundParsedCommand(ck, msg, cmd)')
  expect(onMessageBlock.indexOf('const cmd = parseCmd(msg.text)')).toBeLessThan(onMessageBlock.indexOf('auditInboundParsedCommand(ck, msg, cmd)'))
  expect(commandBlock).toContain("event: 'agent_command_received'")
  expect(commandBlock).toContain("event: 'agent_command_executed'")
  expect(daemon).toContain('function parsedCommandNotice(runtime: AgentRuntimeKind, command: string): string')
  expect(daemon).toContain('function visibleCommandText(command: string): string')
  expect(daemon).toContain('formatParsedAgentCommand(visibleCommandText(command))')
  expect(readFileSync('commands.ts', 'utf8')).toContain('export function formatParsedAgentCommand(command: string): string')
  expect(daemon).not.toContain('function firstLine(text: string)')
  expect(commandBlock).toContain('parsedCommandNotice(runtime, normalizedCommand)')
  expect(daemon).toContain("'capture_worker_report'")
  expect(toolBlock).toContain('const visibleToolCommand = VISIBLE_TOOL_COMMAND_NAMES.has(msg.tool)')
  expect(toolBlock).toContain("event: 'agent_tool_command_received'")
  expect(toolBlock).toContain("event: 'agent_tool_command_executed'")
  expect(toolBlock).toContain('🧭 Parsed tool command:')
})


test('channel tag message id extraction avoids any casts', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const transcript = readFileSync('transcript.ts', 'utf8')
  expect(daemon).toContain("import { channelMessageIdFromContent, extractTextFromContent, nestedRecord, textBlocksFromContent, transcriptRecordFromLine, transcriptString, transcriptTextBlocks } from './transcript.js'")
  expect(daemon).toContain('const entry = transcriptRecordFromLine(line)')
  expect(daemon).toContain('const replyTo = channelMessageIdFromContent(msg?.content)')
  expect(transcript).toContain('function transcriptRecord(value: unknown): Record<string, unknown> | undefined')
  expect(transcript).toContain('return transcriptRecord(parsed)')
  expect(transcript).toContain('return transcriptRecord(value?.[key])')
  expect(transcript).toContain('export function channelMessageIdFromContent')
  expect(transcript).toContain('export function transcriptRecordFromLine')
  expect(transcript).toContain('const block = transcriptRecord(item)')
  expect(transcript).toContain('const record = transcriptRecord(item)')
  expect(transcript).toContain('const record = transcriptRecord(block)')
  expect(transcript).not.toContain('type TextContentBlock')
  expect(transcript).not.toContain('item as TextContentBlock')
  expect(transcript).not.toContain('item as Record<string, unknown>')
  expect(transcript).not.toContain('block as Record<string, unknown>')
  expect(transcript).not.toContain('as any')
  expect(daemon).not.toContain('(c as any).type')
  expect(daemon).not.toContain('((c as any).text')
})

test('daemon untrusted JSON parsing avoids any escape hatches', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const transcript = readFileSync('transcript.ts', 'utf8')
  expect(daemon).toContain("import { parseZellijJson, zellijPanes, type ZellijPane } from './zellij-json.js'")
  expect(daemon).toContain("zellijPanes(parseZellijJson(zellijActionSync(['list-panes', '--json', '--tab', '--state']")
  expect(daemon).not.toContain('function zellijPaneInfos(value: unknown): ZellijPaneInfo[]')
  expect(daemon).not.toContain('JSON.parse(zellijActionSync')
  expect(daemon).toContain('function recordValue(value: unknown): Record<string, unknown> | undefined')
  expect(daemon).toContain('value !== null && !Array.isArray(value)')
  expect(transcript).toContain('export function textBlocksFromContent(content: unknown): string')
  expect(daemon).toContain('function stringList(value: unknown): string[]')
  expect(daemon).toContain('function permissionBehavior(value: unknown):')
  expect(daemon).toContain('function isToolCallMessage(msg: Record<string, unknown>)')
  expect(daemon).toContain('function isPermissionRequestMessage(msg: Record<string, unknown>)')
  const ipc = readFileSync('ipc.ts', 'utf8')
  expect(daemon).toContain("import { ipcMessageFromLine } from './ipc.js'")
  expect(daemon).toContain('const msg = ipcMessageFromLine(line)')
  expect(ipc).toContain('export function ipcMessageFromLine(line: string): Record<string, unknown> | undefined')
  expect(ipc).toContain('let parsed: unknown')
  expect(daemon).toContain('const entry = transcriptRecordFromLine(line)')
  expect(daemon).not.toMatch(/\bas any\b/)
  expect(daemon).not.toMatch(/:\s*any\b/)
  expect(daemon).not.toContain('null as unknown as NodeJS.Timeout')
  expect(transcript).not.toMatch(/\bas any\b/)
  expect(daemon).not.toContain('msg.args.files as string[]')
})
test('reply tool treats attachment upload failure as partial success', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('const uploadFailures: string[] = []')
  expect(daemon).toContain('uploadFailures.push(`${basename(f)}: ${errorMessage(err)}`)')
  expect(daemon).toContain('attachment upload failed: ${uploadFailures.join(\'; \')}')
  expect(daemon).toContain('reply attachment upload warning')
  expect(daemon).toContain('Attachment upload failed after the reply was sent')
  expect(daemon).toContain('reply attachment upload warning failed for ${ck}: ${errorMessage(err)}')
  expect(daemon).not.toContain('reply attachment upload warning failed for ${ck}: ${err}')
  expect(daemon).toContain('replyTo ? { replyTo, broadcast: true } : undefined')
  expect(daemon).not.toContain('for (const f of stringList(msg.args.files))\n          await adapter.uploadFile')
})

test('reply tool keeps Slack thread broadcast parity', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(daemon).toContain('replyTo,')
  expect(daemon).toContain('broadcast: true')
  expect(daemon).toContain("async function sendWithButtons(ck: string, text: string, buttons: ButtonItem[], sendOpts?: SendOptions, label = 'button notice')")
  expect(daemon).toContain('const opts = { ...sendOpts, ...adapter.renderButtons(buttons) }')
  expect(slack).toContain('reply_broadcast: opts.broadcast ?? true')
})

test('tool errors clear active typing before returning to agent', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const block = daemon.slice(daemon.indexOf('async function handleTool'), daemon.indexOf('// ---------------------------------------------------------------------------\n// Permission request'))
  expect(block).toContain("} catch (err) {\n    await clearAgentTyping(uuid)")
  expect(block.indexOf('await clearAgentTyping(uuid)', block.indexOf('} catch (err) {'))).toBeLessThan(block.indexOf("sendToLive(route.responseUuid, { type: 'tool_error'"))
})

test('agent replies are visibly identity-prefixed and idempotent', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const identity = readFileSync('agents/identity.ts', 'utf8')
  expect(daemon).toContain("import { agentLabel, agentName, formatAgentReply } from './agents/identity.js'")
  expect(identity).toContain("return runtime === 'codex' ? '🟢 Codex' : '🟣 Claude'")
  expect(identity).toContain("return runtime === 'codex' ? '**🟢 Codex**' : '**🟣 Claude**'")
  expect(identity).toContain('trimmed.startsWith(header +')
  expect(identity).toContain('trimmed.startsWith(label +')
  expect(identity).toContain('return `${header}\\n${trimmed}`')
  for (const call of [
    "formatAgentReply(event.session.kind, text)",
    "formatAgentReply(runtime, rendered)",
    "formatAgentReply(runtimeForUuid(uuid), text)",
    "formatAgentReply('codex', text)",
    "formatAgentReply(runtime, formatAgentStartFailure(runtime, 'start', result.error))",
    "formatAgentReply(runtime, `🚀 ${agentName(runtime)} session",
    "formatAgentReply(cmd.runtime, `✅ Active agent is now",
    "formatAgentReply(runtime, formatAgentStartFailure(runtime, 'resume', error))",
    "formatAgentReply(runtime,\n      hasTranscript ?",
    "formatAgentReply(runtime, `✅ Bound to ${agentName(runtime)}",
    "formatAgentReply('claude', `Session",
    "formatAgentReply(runtimeForUuid(uuid), `🔐 *${tool_name}*",
    "formatAgentReply(runtimeForUuid(uuid), `✅ ${agentName(runtimeForUuid(uuid))} session",
    "formatAgentReply(runtime, `✅ Room directory set to",
    "formatAgentReply(runtime, `📂 Choose working directory for ${agentName(runtime)}:`)",
    "formatAgentReply(runtime, `⏱ Recent directories for ${agentName(runtime)}:`)",
    "formatAgentReply(runtime, `📂 ${agentName(runtime)} working directory browser",
    "runtime ? formatAgentReply(runtime, headerLines.join('\\n'))",
    "formatAgentReply(runtime, `${agentName(runtime)} session",
    "`⏳ ${agentName(runtime)} agent slot session starting up.`",
    "formatAgentReply(runtime, message)",
    "formatAgentReply(runtime, `🔍 Found ${results.length} ${agentName(runtime)} director",
    "formatAgentReply(activeRuntime, 'No active agent sessions to stop.')",
    "formatAgentReply(activeRuntime, detail)",
    "`📋 Browse ${agentName(activeRuntime)} sessions`",
    "formatAgentReply(runtime, `No ${agentName(runtime)} sessions in",
    "formatAgentReply(runtime, `📂 ${agentName(runtime)} sessions in",
    "formatAgentReply(runtime, `❌ ${agentName(runtime)} directory search failed",
    "formatAgentReply(runtime, `🔍 No ${agentName(runtime)} directories matching",
    "formatAgentReply(activeRuntime, '⏹ Select agent session to stop:')",
    "`⏹ ${s.runtime === 'codex' ? 'CX' : 'CC'} ${s.uuid.slice(0, 8)}",
    "`🚀 Start ${agentName(runtime)}`",
    "formatAgentReply(cmd.runtime, `✅ Default agent is now",
    "formatAgentReply(runtime, `✅ Room directory set to",
    "formatAgentReply('codex', `📋 Codex plan",
    "formatAgentReply(runtimeForUuid(uuid), `📋 Tasks",
    "sendChannelNotice(ck, formatAgentReply(runtimeForUuid(uuid), '🗜️ Compacting conversation context...')",
    "formatAgentReply('claude', claudeNavMessageText(u, screen))",
    "formatAgentReply('claude', `🎮 Claude screen",
    "formatAgentReply('claude', '⏳ Navigating Claude...')",
  ]) expect(daemon).toContain(call)
})

test('agent event and transcript poll missing adapters are observable', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const eventBlock = daemon.slice(daemon.indexOf("if (event.type !== 'assistant_final')"), daemon.indexOf('if (!delivered && channelsForUuid', daemon.indexOf("if (event.type !== 'assistant_final')")))
  expect(eventBlock).toContain('agent event send skipped ${event.session.sessionId.slice(0, 8)} channel=${ck}: no adapter')
  const pollBlock = daemon.slice(daemon.indexOf('async function flushTranscriptDelivery'), daemon.indexOf('function queueTranscriptDelivery'))
  expect(pollBlock).toContain('poll send skipped ${uuid.slice(0, 8)} key=${item.key} channel=${ck}: no adapter')
  expect(pollBlock).toContain('item.delivered.add(ck)')
  expect(pollBlock).not.toContain('if (!adapter) { item.delivered.add(ck); continue }')
})

test('Codex assistant messages are forwarded before final turn completion', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const types = readFileSync('agents/types.ts', 'utf8')
  const codexDriver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(types).toContain("type: 'assistant_message'")
  expect(codexDriver).toContain("type: 'assistant_message'")
  expect(codexDriver).toContain('function assistantMessageText')
  expect(codexDriver).toContain("item.type === 'agentMessage'")
  expect(codexDriver).toContain("item.type === 'message' && item.role === 'assistant'")
  expect(daemon).toContain("event.type === 'assistant_message'")
  expect(daemon).toContain("formatAgentReply(event.session.kind, `💭 ${text}`)")
  expect(daemon).toContain('daemon: agent mid-turn send skipped')
})

test('agent final fallback replies preserve originating thread when known', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const types = readFileSync('agents/types.ts', 'utf8')
  const codexDriver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  expect(types).toContain('channelKey?: string; threadId?: string')
  expect(codexDriver).toContain('turnChannels: Map<string, string>')
  expect(codexDriver).toContain('runtime.turnChannels.set(input.turn.turnId, input.turn.channelKey)')
  expect(codexDriver).toContain('private moveTurnRoute')
  expect(codexDriver).toContain('if (channelKey) runtime.turnChannels.set(toTurnId, channelKey)')
  expect(codexDriver).toContain('runtime.turnChannels.delete(nativeTurnId)')
  expect(codexDriver).toContain('const channelKey = runtime.turnChannels.get(nativeTurnId)')
  expect(codexDriver).toContain('return { channelThreadId, channelKey }')
  expect(codexDriver).toContain('channelKey, threadId: channelThreadId')
  expect(daemon).toContain('const opts = event.channelKey === ck && event.threadId ? { replyTo: event.threadId, broadcast: true } : undefined')
  expect(daemon).toContain('agent event send failed with reply_to=')
})


test('Slack rich message delivery falls back to visible plain text', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  expect(slack).toContain('function isSlackBlockPayloadError(err: unknown): boolean')
  expect(slack).toContain("'invalid_blocks'")
  expect(slack).toContain("'msg_blocks_too_long'")
  expect(slack).toContain('rich message blocks rejected, retrying plain text')
  expect(slack).toContain('rich message edit rejected, retrying plain text')
  expect(slack).toContain('const { blocks: _blocks, ...plainPayload } = basePayload')
  expect(slack).toContain('const { blocks: _blocks, ...plainPayload } = payload')
  expect(slack).toContain('return slackPostTs(res)')
})

test('reply delivery preserves Slack thread broadcast and safe fallback parity', () => {
  const types = readFileSync('adapters/types.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const server = readFileSync('server.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(types).toContain('broadcast?: boolean')
  expect(slack).toContain('thread_ts: opts.replyTo')
  expect(slack).toContain('reply_broadcast: opts.broadcast ?? true')
  expect(server).toContain('reply_to')
  expect(daemon).toContain('const replyToArg = optionalString(msg.args.reply_to)')
  expect(daemon).toContain('let replyTo = replyToArg')
  expect(daemon).toContain('known && known.size > 0 && !known.has(replyTo)')
  expect(daemon).toContain('falling back to main channel')
  expect(daemon).toContain('replyTo,')
  expect(daemon).toContain('broadcast: true')
})

test('channel notice sends are logged and fallback from stale thread anchors', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('async function sendChannelNotice')
  expect(daemon).toContain('send skipped for ${ck}: no adapter')
  expect(daemon).toContain('send failed with reply_to=${opts.replyTo} for ${ck}; retrying main channel')
  expect(daemon).toContain('function mainChannelFallbackOptions(opts?: SendOptions): SendOptions | undefined')
  expect(daemon).toContain('opts?.inlineKeyboard ? { inlineKeyboard: opts.inlineKeyboard } : undefined')
  expect(daemon).toContain('return await adapter.sendMessage(localId(ck), text, mainChannelFallbackOptions(opts))')
  expect(daemon).toContain('fallback send failed for ${ck}: ${errorMessage(fallbackErr)}')
  expect(daemon).toContain('send failed for ${ck}: ${errorMessage(err)}')
  expect(daemon).toContain("opts, 'agent error'")
  expect(daemon).toContain("undefined, 'codex worktree warning'")
  expect(daemon).toContain("undefined, 'invalid button'")
  expect(daemon).toContain("undefined, 'session reconnect'")
  expect(daemon).toContain("undefined, 'claude nav status'")
})

test('Codex request notice helpers log missing adapters', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('codex notice send skipped channel=${channelId}: no adapter')
  expect(daemon).toContain('codex request acknowledgement skipped channel=${channelId}: no adapter')
})
test('Slack removeReaction logs unexpected failures but ignores expected misses', () => {
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const body = slack.slice(slack.indexOf('async removeReaction'), slack.indexOf('async showTyping'))
  expect(slack).toContain(`return redactSensitiveText(message).replace(/\\s+/g, ' ').trim().slice(0, 160) || 'unknown'`)
  expect(body).toContain('const code = slackErrorCode(err)')
  expect(body).toContain("['no_reaction', 'not_reacted', 'message_not_found'].includes(code)")
  expect(body).toContain('slack: removeReaction(${emoji}→${name}) on ${channelId}/${messageId} failed: ${code}')
  expect(body).not.toContain('.catch(() => {})')
})

test('agent typing indicators are started and cleared on terminal paths', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const telegram = readFileSync('adapters/telegram.ts', 'utf8')
  expect(slack).toContain('async showTyping(channelId: string, threadTs?: string)')
  expect(slack).toContain('async clearTyping(channelId: string, threadTs?: string)')
  expect(slack).toContain('assistant.threads.setStatus(clear) failed: ${code}\\n')
  expect(telegram).toContain('async showTyping(channelId: string)')
  expect(telegram).toContain('sendChatAction typing failed on ${channelId}')
  expect(telegram).toContain('throw err')
  expect(daemon).toContain('const activeTypingAnchors = new Map')
  expect(daemon).toContain('const typingThreadId = msg.replyToId ?? msg.messageId')
  expect(daemon).toContain("adapter?.addReaction(id, msg.messageId, '👀').catch(err =>")
  expect(daemon).toContain('daemon: start-turn reaction failed')
  expect(daemon).toContain('adapter?.showTyping?.(id, typingThreadId).catch(err =>')
  expect(daemon).toContain('daemon: start-turn typing failed')
  expect(daemon).toContain('const turnNoticeOpts = { replyTo: typingThreadId, broadcast: true }')
  expect(daemon).toContain('activeTypingAnchors.set(uuid, { channelKey: ck, threadId: typingThreadId })')
  expect(daemon).toContain('async function clearAgentTyping(sessionId: string)')
  expect(daemon).toContain('await adapter?.clearTyping?.(localId(anchor.channelKey), anchor.threadId).catch(err =>')
  expect(daemon).toContain('daemon: clear typing failed for')
  expect(daemon).toContain("event.type === 'error'")
  expect(daemon).toContain("event.type === 'status' && (event.status === 'idle' || event.status === 'stopped')")
  expect(daemon).toContain('await clearAgentTyping(uuid)')
  expect(daemon).toContain("await clearAgentTyping(uuid)\n      await sendChannelNotice(ck, formatAgentReply('codex', `❌ Failed to send turn: ${errorMessage(err)}`), turnNoticeOpts, 'codex send turn failure')")
  expect(daemon).toContain('await clearAgentTyping(uuid)\n    const paneStatus = runtime === \'claude\' && zellijAvailable ? getPaneStatus(uuid) : null')
  expect(daemon).toContain('await sendWithButtons(ck, formatAgentReply(runtime, message),')
  expect(daemon).toContain('], turnNoticeOpts)')
  expect(daemon).toContain('activeTypingAnchors.delete(uuid)')
})


test('shutdown broadcasts service restart notices before stopping adapters', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const shutdown = daemon.slice(daemon.indexOf('async function shutdown(): Promise<void>'))
  expect(daemon).toContain('function activeRoomChannelsForShutdown(): string[]')
  expect(daemon).toContain('async function notifyRoomsDaemonShutdown(): Promise<void>')
  expect(daemon).toContain('for (const [uuid, entry] of live)')
  expect(daemon).toContain('for (const anchor of activeTypingAnchors.values())')
  expect(daemon).toContain("sendChannelNotice(ck, text, undefined, 'daemon shutdown notice')")
  expect(shutdown.indexOf('await notifyRoomsDaemonShutdown()')).toBeGreaterThan(-1)
  expect(shutdown.indexOf('await notifyRoomsDaemonShutdown()')).toBeLessThan(shutdown.indexOf('for (const [uuid] of live) await killSession(uuid)'))
  expect(shutdown.indexOf('await notifyRoomsDaemonShutdown()')).toBeLessThan(shutdown.indexOf('for (const adapter of activeAdapters)'))
})

test('shutdown adapter stops log failures without aborting cleanup', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const slack = readFileSync('adapters/slack.ts', 'utf8')
  const shutdown = daemon.slice(daemon.indexOf('async function shutdown(): Promise<void>'))
  expect(shutdown).toContain('for (const adapter of activeAdapters)')
  expect(shutdown).toContain('await adapter.stop()')
  expect(shutdown).toContain('adapter stop failed: ${errorMessage(err)}\\n`)')
  expect(shutdown).not.toContain('for (const a of activeAdapters) await a.stop().catch(() => {})')
  expect(slack).toContain('Socket Mode disconnect failed: ${errorMessage(err)}\\n`)')
  expect(slack).not.toContain('disconnect().catch(() => {})')
})

test('daemon watcher plugin failures are observable while preserving polling fallback', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const body = daemon.slice(daemon.indexOf('async function ensureWatcherPlugin'), daemon.indexOf('const screenWatchers'))
  expect(body).toContain('watcher plugin launch failed (will use polling fallback): ${errorMessage(err)}')
  expect(body).toContain('watch pane ${paneId} failed (polling fallback remains active): ${errorMessage(err)}')
  expect(body).toContain('unwatch pane ${paneId} failed: ${errorMessage(err)}')
  expect(body).not.toContain("process.stderr.write('daemon: watcher plugin launch failed (will use polling fallback)\n')")
  expect(body).not.toContain('} catch {}')
})

test('daemon zellij cleanup and teardown failures are observable', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('failed to delete exited zellij session ${JSON.stringify(ZELLIJ_SESSION)}: ${errorMessage(err)}')
  expect(daemon).toContain('failed to list zellij sessions before bootstrap: ${errorMessage(err)}')
  expect(daemon).toContain('let lastBootstrapCheckError: unknown')
  expect(daemon).toContain('lastBootstrapCheckError = err')
  expect(daemon).toContain('zellij bootstrap session check failed: ${errorMessage(lastBootstrapCheckError)}')
  expect(daemon).toContain('failed to stop zellij bootstrap client: ${errorMessage(err)}')
  expect(daemon).toContain('failed to clean exited tab ${p.tab_name}: ${errorMessage(err)}')
  expect(daemon).toContain('failed to list exited tabs for cleanup: ${errorMessage(err)}')
  expect(daemon).toContain('child SIGTERM failed for ${uuid.slice(0, 8)}: ${errorMessage(err)}')
  expect(daemon).toContain('IPC destroy failed for ${uuid.slice(0, 8)}: ${errorMessage(err)}')
  expect(daemon).toContain('close tab failed for ${uuid.slice(0, 8)}: ${errorMessage(err)}')
  expect(daemon).not.toContain("try { await zellijAsync(['delete-session', ZELLIJ_SESSION, '--force']) } catch {}")
  expect(daemon).not.toContain("try { scriptProc.kill() } catch {}")
  const ensureBody = daemon.slice(daemon.indexOf('async function ensureZellijSession'), daemon.indexOf('/** Clean up exited ccm tabs'))
  expect(ensureBody).not.toContain('} catch {}')
})

test('daemon runtime teardown clears per-session UI state', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function clearPerSessionUiState(uuid: string, opts: { clearPeerInflight?: boolean } = {}): void')
  expect(daemon).not.toContain('codexNativeSessionIds')
  expect(daemon).toContain('codexStoredNativeSessionId(uuid)')
  expect(daemon).toContain('codexPlanMessages.delete(uuid)')
  expect(daemon).toContain('announcedReconnect.delete(uuid)')
  expect(daemon).toContain('knownThreadAnchors.delete(uuid)')
  expect(daemon).toContain('recentReplies.delete(uuid)')
  expect(daemon).toContain('pendingPermission.delete(uuid)')
  expect(daemon).toContain('activeTypingAnchors.delete(uuid)')
  expect(daemon).toContain('async function killSession(uuid: string): Promise<void>')
  expect(daemon).toContain('const l = live.get(uuid)')
  expect(daemon).toContain('if (l?.child)')
  expect(daemon).toContain('child SIGTERM failed for ${uuid.slice(0, 8)}: ${errorMessage(err)}')
  expect(daemon).toContain('} else if (l && zellijAvailable)')
  expect(daemon).toContain('IPC destroy failed for ${uuid.slice(0, 8)}: ${errorMessage(err)}')
  expect(daemon).not.toContain("if (l?.child) {\n    l.child.kill('SIGTERM')")
  expect(daemon).not.toContain('const l = live.get(uuid)\n  if (!l) return\n  const claudeSession = claudeSessions.get(uuid)')
  expect(daemon).toContain('clearSessionTerminalState(uuid)')
  expect(daemon).toContain('clearPerSessionUiState(uuid, { clearPeerInflight: true })')
})

test('daemon stop buttons preserve room mappings before killing runtime', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('async function stopRoomMappedSession(ck: string, runtime: AgentRuntimeKind, uuid: string): Promise<void>')
  expect(daemon).toContain('setAgentDesiredRunning(ck, runtime, false)')
  expect(daemon).toContain("} else if (action.startsWith('stopnew:')) {")
  expect(daemon).toContain("} else if (action.startsWith('stop:')) {")
  expect(daemon).toContain("} else if (action.startsWith('stopnow:')) {")
  const stopCallbackBody = daemon.slice(daemon.indexOf("} else if (action.startsWith('stop:')) {"), daemon.indexOf("} else if (action.startsWith('stopnow:')) {"))
  expect(stopCallbackBody).toContain('if (bindingUuid(ck, runtime) === uuid) await stopRoomMappedSession(ck, runtime, uuid)')
  expect(stopCallbackBody).toContain('unbindSessionEverywhere(uuid, runtime)')
  expect(stopCallbackBody).toContain('await killSessionIfUnboundEverywhere(uuid, runtime)')
  expect(stopCallbackBody).toContain('{ text: `▶️ Resume`, data: `ccr:${runtime}:${uuid}` }')
  expect(stopCallbackBody).toContain('{ text: `🚀 Start ${agentName(runtime)}`, data: `cmd:new:${runtime}` }')
})

test('room stop owns runtime lifecycle while preserving the room mapping', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const stopCase = daemon.slice(daemon.indexOf("    case 'stop':"), daemon.indexOf("    case 'stop_id':"))
  expect(stopCase).toContain('await stopRoomMappedSession(ck, runtime, uuid)')
  expect(stopCase).toContain('Room mapping was kept for resume.')
  expect(stopCase).not.toContain('unbindSessionEverywhere')
  expect(stopCase).not.toContain('killSessionIfUnboundEverywhere')
  expect(stopCase).not.toContain('suspended.')
})

test('resume by agent id restores the room cwd from the selected session', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function cwdForSessionInfo(session: SessionInfo | undefined, fallback: string): string')
  const resumeIdCase = daemon.slice(daemon.indexOf("    case 'resume_id':"), daemon.indexOf("    case 'screen':"))
  expect(resumeIdCase).toContain('let selected: SessionInfo | undefined')
  expect(resumeIdCase).toContain('const resolved = resolveSessionById(uuid, cmd.runtime)')
  expect(resumeIdCase).toContain('selected = resolved.session')
  expect(resumeIdCase).toContain('const runtime = selected.runtime')
  expect(resumeIdCase).toContain('await resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')
  const resumeCallback = daemon.slice(daemon.indexOf("} else if (data.startsWith('ccr:')) {"), daemon.indexOf("} else if (data.startsWith('ccp:')) {"))
  expect(resumeCallback).toContain('const selected = listAllAgentSessions(500, runtime).find(s => s.uuid === uuid) ?? boundAgentSessions(runtime).find(s => s.uuid === uuid)')
  expect(resumeCallback).toContain('await resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')
})

test('resume and stop ids reject malformed, unknown, and ambiguous matches', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function resolveSessionById(input: string, preferred?: AgentRuntimeKind): SessionIdResolution')
  expect(daemon).toContain("type SessionIdResolution = { ok: true; session: SessionInfo } | { ok: false; reason: 'invalid' | 'unknown' | 'ambiguous'; matches?: SessionInfo[] }")
  const resolver = daemon.slice(daemon.indexOf('function resolveSessionById'), daemon.indexOf('function channelsForUuid'))
  expect(resolver).toContain("if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input)) return { ok: false, reason: 'invalid' }")
  expect(resolver).toContain('if (input.length >= 36)')
  expect(resolver).toContain('if (!parseSessionCallbackUuid(input)) return { ok: false, reason: \'invalid\' }')
  expect(resolver).toContain('return exact ? { ok: true, session: exact } : { ok: false, reason: \'unknown\' }')
  expect(resolver).toContain('return matches.length === 1 ? { ok: true, session: matches[0] } : { ok: false, reason: \'ambiguous\', matches }')
  const resumeIdCase = daemon.slice(daemon.indexOf("    case 'resume_id':"), daemon.indexOf("    case 'screen':"))
  expect(resumeIdCase).toContain('const resolved = resolveSessionById(uuid, cmd.runtime)')
  expect(resumeIdCase).toContain('await sendSessionIdResolutionFailure(ck, uuid, resolved, cmd.runtime)')
  expect(resumeIdCase).not.toContain('resolveSessionRuntime(uuid, cmd.runtime)')
  const stopIdCase = daemon.slice(daemon.indexOf("    case 'stop_id':"), daemon.indexOf("    case 'agent_command':"))
  expect(stopIdCase).toContain('const resolved = resolveSessionById(uuid, cmd.runtime)')
  expect(stopIdCase).toContain('await sendSessionIdResolutionFailure(ck, uuid, resolved, cmd.runtime)')
  expect(stopIdCase).not.toContain('resolveSessionRuntime(uuid, cmd.runtime)')
})

test('runtime-scoped resume and stop accept verb-first id commands', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const parseCmd = daemon.slice(daemon.indexOf('function parseCmd'), daemon.indexOf('// ---------------------------------------------------------------------------\n// Session picker'))
  expect(parseCmd).toContain('const resumeRuntimeIdM = args.match(/^resume\\s+(claude|cc|codex|cx)\\s+([0-9a-f-]{8,36})$/i)')
  expect(parseCmd).toContain("if (resumeRuntimeIdM) return { t: 'resume_id', uuid: resumeRuntimeIdM[2], runtime: /^(codex|cx)$/i.test(resumeRuntimeIdM[1]) ? 'codex' : 'claude' }")
  expect(parseCmd).toContain('const stopRuntimeIdM = args.match(/^stop\\s+(claude|cc|codex|cx)\\s+([0-9a-f-]{8,36})$/i)')
  expect(parseCmd).toContain("if (stopRuntimeIdM) return { t: 'stop_id', uuid: stopRuntimeIdM[2], runtime: /^(codex|cx)$/i.test(stopRuntimeIdM[1]) ? 'codex' : 'claude' }")
  expect(parseCmd.indexOf('const resumeRuntimeIdM')).toBeLessThan(parseCmd.indexOf('const resumeRuntimeM'))
  expect(parseCmd.indexOf('const stopRuntimeIdM')).toBeLessThan(parseCmd.indexOf('const stopRuntimeM'))
})

test('resume failure rolls back transient room binding changes', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function restoreBindingSnapshot(ck: string, snapshot: ChannelBinding | undefined): void')
  const resumeBody = daemon.slice(daemon.indexOf('async function resumeAndBind'), daemon.indexOf('// ---------------------------------------------------------------------------', daemon.indexOf('async function resumeAndBind')))
  expect(resumeBody).toContain('const before = loadBindings()[ck]')
  expect(resumeBody).toContain('let boundForResume = false')
  expect(resumeBody).toContain('setBindingSession(ck, runtime, uuid, makeActive)')
  expect(resumeBody).toContain('boundForResume = true')
  expect(resumeBody).toContain('if (boundForResume) restoreBindingSnapshot(ck, before)')
  expect(resumeBody).toContain("formatAgentStartFailure(runtime, 'resume', error)")
})

test('Codex resume uses transcript cwd but only trusted stored native id', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const spawnBody = daemon.slice(daemon.indexOf('async function spawnResumeOnce'), daemon.indexOf('async function resumeAndBind'))
  expect(spawnBody).toContain('const sessionInfo = selected ?? listAllAgentSessions(500, runtime).find(s => s.uuid === uuid)')
  expect(spawnBody).toContain('const fallbackCwd = meta?.cwd ?? sessionInfo?.cwd ?? (bound ? roomCwd(bound.channelKey) : undefined) ?? DEFAULT_CWD')
  expect(spawnBody).toContain('normalizeCodexResumeCwd(uuid, fallbackCwd, meta?.sourceCwd)')
  expect(daemon).toContain('function normalizeCodexResumeCwd(uuid: string, cwd: string, sourceCwd?: string): string')
  expect(daemon).toContain('function codexNativeSessionIdForResume(uuid: string, meta?: AgentSlotMeta): string | undefined')
  expect(daemon).toContain('function codexStoredNativeSessionId(uuid: string): string | undefined')
  expect(daemon).toContain('function codexLogicalSessionIdForNative(nativeSessionId: string): string | undefined')
  expect(daemon).toContain("join(sourceRoot, '.codex', 'worktrees', uuid.slice(0, 8))")
  expect(daemon).toContain("execFileSync('git', ['worktree', 'move', cwd, target]")
  expect(spawnBody).toContain('const nativeSessionId = runtime === \'codex\' ? sessionInfo?.nativeSessionId ?? codexNativeSessionIdForResume(uuid, meta) : undefined')
  expect(spawnBody).toContain('Codex resume requires a trusted native thread id; refusing to start a new conversation.')
  expect(spawnBody).toContain("runtime === 'codex' ? !!nativeSessionId : hasTranscript")
  expect(spawnBody).toContain("{ model: meta?.model }, nativeSessionId")
  expect(spawnBody).not.toContain('codexNativeSessionIds')
  expect(spawnBody).not.toContain('?? uuid')
})

test('Codex session picker maps native transcript ids back to CCM logical ids', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const listBody = daemon.slice(daemon.indexOf('function listAllCodexSessions'), daemon.indexOf('function listAllAgentSessions'))
  const resumeIdCase = daemon.slice(daemon.indexOf("case 'resume_id'"), daemon.indexOf("case 'screen'"))
  const resumeCallback = daemon.slice(daemon.indexOf("} else if (data.startsWith('ccr:')) {"), daemon.indexOf("} else if (data.startsWith('ccp:')) {"))
  expect(listBody).toContain('const nativeSessionId = m[1]')
  expect(listBody).toContain('const uuid = codexLogicalSessionIdForNative(nativeSessionId) ?? nativeSessionId')
  expect(listBody).toContain('nativeSessionId, mtime: st.mtimeMs')
  expect(resumeIdCase).toContain('resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')
  expect(resumeCallback).toContain('resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')
})

test('Codex native id resolver never falls back to CCM uuid or transcript rollout filename', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const resolverBody = daemon.slice(daemon.indexOf('function codexNativeSessionIdForResume'), daemon.indexOf('function saveTranscriptDeliveries'))
  const staleSnapshotBody = daemon.slice(daemon.indexOf('function staleCodexPendingSnapshot'), daemon.indexOf('function codexPendingSnapshot'))
  expect(resolverBody).toContain('meta?.nativeSessionId')
  expect(resolverBody).toContain('codexStoredNativeSessionId(uuid)')
  expect(resolverBody).not.toContain('codexTranscriptSessionId(transcript.path)')
  expect(resolverBody).not.toContain('?? uuid')
  expect(staleSnapshotBody).toContain("const nativeSessionId = codexNativeSessionIdForResume(sessionId, agentMeta(ck, 'codex'))")
  expect(staleSnapshotBody).toContain("nativeSessionId: nativeSessionId ?? ''")
  expect(staleSnapshotBody).not.toContain('?? sessionId')
})

test('Codex app-server resume fails closed instead of silently starting after resume failure', () => {
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const createRuntime = driver.slice(driver.indexOf('private async createRuntime'), driver.indexOf('private configArgs'))
  expect(createRuntime).toContain('const response = nativeSessionId')
  expect(createRuntime).not.toContain('const response = nativeSessionId && !effectiveModel')
  expect(createRuntime).toContain("? await client.request('thread/resume', { threadId: nativeSessionId }, 60_000)")
  expect(createRuntime).toContain(": await client.request('thread/start'")
  expect(createRuntime).not.toContain(".catch(() => null)")
  expect(createRuntime).not.toContain('threadResponse ?? await client.request')
})

test('Codex explicit stop clears pending requests while stale panels remain restart-only', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('function deletePendingCodexRequestsForSession(sessionId: string): void')
  expect(daemon).toContain('function deletePendingCodexRequestsForRequest(sessionId: string, requestId: string): void')
  expect(daemon).toContain('if (req.sessionId !== sessionId) continue')
  expect(daemon).toContain('deletePendingCodexRequestsForSession(uuid)')
  const killSessionBody = daemon.slice(daemon.indexOf('async function killSession(uuid: string): Promise<void>'), daemon.indexOf('function unbind(ck: string'))
  expect(killSessionBody).toContain('deletePendingCodexRequestsForSession(uuid)')
  const clearRuntimeBody = daemon.slice(daemon.indexOf('function clearRuntimeState(uuid: string'), daemon.indexOf('function liveEntryNeedsRespawn'))
  expect(clearRuntimeBody).not.toContain('deletePendingCodexRequestsForSession(uuid)')
  expect(daemon).toContain('staleCodexPendingSnapshot')
  expect(daemon).toContain('Clear stale request')
})


test('Codex pending acknowledgements keep agent identity on send and edit paths', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("await sendCodexNotice(adapter, localId(ck), formatAgentReply('codex', '⚠️ Codex request expired or already resolved. Refreshing current Codex pending actions.'))")
  expect(daemon).toContain('const pendingNoticeOpts = pending.threadId ? { replyTo: pending.threadId, broadcast: true } : undefined')
  expect(daemon).toContain("await sendCodexNotice(adapter, localId(ck), formatAgentReply('codex', '⚠️ Clear is only available for stale Codex requests. Use Deny or Abort for live requests.'), pendingNoticeOpts)")
  expect(daemon).toContain("const text = formatAgentReply('codex', '🧹 Cleared stale Codex request.')")
  expect(daemon).toContain("const text = formatAgentReply('codex', `✅ Codex request ${label}.`)")
  expect(daemon).toContain('async function acknowledgeCodexRequest')
  expect(daemon).toContain('await adapter.editMessage(channelId, messageId, text)')
  expect(daemon).toContain('codex request acknowledgement edit failed')
  expect(daemon).toContain('codex notice send failed with reply_to=${opts.replyTo} channel=${channelId}; retrying main channel: ${errorMessage(err)}')
  expect(daemon).toContain('codex notice fallback send failed channel=${channelId}: ${errorMessage(fallbackErr)}')
  expect(daemon).toContain('codex request acknowledgement edit failed channel=${channelId} message=${messageId}: ${errorMessage(err)}')
  expect(daemon).toContain('codex request acknowledgement send failed with reply_to=${opts.replyTo} channel=${channelId}; retrying main channel: ${errorMessage(err)}')
  expect(daemon).toContain('codex request acknowledgement fallback send failed channel=${channelId}: ${errorMessage(fallbackErr)}')
  expect(daemon).toContain('codex request acknowledgement send failed channel=${channelId}: ${errorMessage(err)}')
  expect(daemon).not.toContain('codex request acknowledgement edit failed channel=${channelId} message=${messageId}: ${err}')
  expect(daemon).not.toContain('codex notice fallback send failed channel=${channelId}: ${fallbackErr}')
  expect(daemon).not.toContain('codex notice send failed with reply_to=${opts.replyTo} channel=${channelId}; retrying main channel: ${err}')
  expect(daemon).toContain('await adapter.sendMessage(channelId, text, opts)')
  expect(daemon).toContain('await adapter.sendMessage(channelId, text, mainChannelFallbackOptions(opts)).catch')
  expect(daemon).not.toContain('await adapter.sendMessage(channelId, text).catch')
  expect(daemon).not.toContain('await adapter.sendMessage(channelId, text, opts).catch')
  expect(daemon).toContain('async function acknowledgeCodexRequestEverywhere')
  expect(daemon).toContain('request.sessionId === sessionId && request.requestId === requestId')
  expect(daemon).toContain('await acknowledgeCodexRequest(adapter, request.channelId, messageId, text, request.threadId ? { replyTo: request.threadId, broadcast: true } : undefined)')
  expect(daemon).toContain('await acknowledgeCodexRequestEverywhere(pending.sessionId, pending.requestId, text, key, messageId)')
  expect(daemon).not.toContain('await acknowledgeCodexRequest(adapter, pending.channelId, messageId, text)')

  const clearStart = daemon.indexOf("const text = formatAgentReply('codex', '🧹 Cleared stale Codex request.')")
  const clearEnd = daemon.indexOf('const session = codexSessions.get(pending.sessionId)', clearStart)
  const clearBlock = daemon.slice(clearStart, clearEnd)
  expect(clearStart).toBeGreaterThanOrEqual(0)
  expect(clearEnd).toBeGreaterThan(clearStart)
  expect(clearBlock.indexOf('acknowledgeCodexRequestEverywhere')).toBeLessThan(clearBlock.indexOf('deletePendingCodexRequestsForRequest'))
  const successStart = daemon.indexOf('const label = decision ===')
  const successBlock = daemon.slice(successStart, daemon.indexOf('// ---------------------------------------------------------------------------', successStart))
  expect(successStart).toBeGreaterThanOrEqual(0)
  expect(successBlock.indexOf('acknowledgeCodexRequestEverywhere')).toBeLessThan(successBlock.indexOf('deletePendingCodexRequestsForRequest'))
  expect(successBlock).not.toContain('deletePendingCodexRequest(pendingKey)')

  const textReplyStart = daemon.indexOf('async function resolveCodexServerRequestWithText')
  const textReplyEnd = daemon.indexOf('async function sendCodexNotice', textReplyStart)
  const textReplyBlock = daemon.slice(textReplyStart, textReplyEnd)
  expect(textReplyStart).toBeGreaterThanOrEqual(0)
  expect(textReplyEnd).toBeGreaterThan(textReplyStart)
  expect(textReplyBlock).toContain('acknowledgeCodexRequestEverywhere(pending.sessionId, pending.requestId, text, key, msg.replyToId)')
  expect(textReplyBlock.indexOf('acknowledgeCodexRequestEverywhere')).toBeLessThan(textReplyBlock.indexOf('deletePendingCodexRequestsForRequest'))
  expect(textReplyBlock).toContain("sendCodexNotice(adapter, localId(ck), formatAgentReply('codex', `⚠️ Failed to send input to Codex: ${errorMessage(err)}`), msg.replyToId ? { replyTo: msg.replyToId, broadcast: true } : undefined)")
  expect(textReplyBlock).not.toContain("sendCodexNotice(adapter, localId(ck), formatAgentReply('codex', '✅ Sent input to Codex.')")

  const unavailableStart = daemon.indexOf("const text = formatAgentReply('codex', '⚠️ Codex session is no longer available.')")
  const unavailableEnd = daemon.indexOf('const result = codexTextResponseResult', unavailableStart)
  const unavailableBlock = daemon.slice(unavailableStart, unavailableEnd)
  expect(unavailableStart).toBeGreaterThanOrEqual(0)
  expect(unavailableEnd).toBeGreaterThan(unavailableStart)
  expect(unavailableBlock).toContain('acknowledgeCodexRequestEverywhere(pending.sessionId, pending.requestId, text, key, msg.replyToId)')
  expect(unavailableBlock.indexOf('acknowledgeCodexRequestEverywhere')).toBeLessThan(unavailableBlock.indexOf('deletePendingCodexRequestsForRequest'))

  const unavailableButtonStart = daemon.indexOf("const text = formatAgentReply('codex', '⚠️ Codex session is no longer available.')", unavailableEnd)
  const unavailableButtonEnd = daemon.indexOf("if (decision !== 'opt'", unavailableButtonStart)
  const unavailableButtonBlock = daemon.slice(unavailableButtonStart, unavailableButtonEnd)
  expect(unavailableButtonStart).toBeGreaterThanOrEqual(0)
  expect(unavailableButtonEnd).toBeGreaterThan(unavailableButtonStart)
  expect(unavailableButtonBlock).toContain('acknowledgeCodexRequestEverywhere(pending.sessionId, pending.requestId, text, key, messageId)')
  expect(unavailableButtonBlock.indexOf('acknowledgeCodexRequestEverywhere')).toBeLessThan(unavailableButtonBlock.indexOf('deletePendingCodexRequestsForRequest'))
})

test('compaction lifecycle is surfaced before and after compacting', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const hook = readFileSync('hooks/pre-compact.ts', 'utf8')
  expect(daemon).toContain("if (msg.type === 'compact_starting')")
  expect(daemon).toContain('🗜️ Compacting conversation context...')
  expect(daemon).toContain("event.type === 'compaction'")
  expect(daemon).toContain("event.status === 'started' ?")
  expect(daemon).toContain('✅ Context compacted, ready to continue.')
  expect(daemon).toContain('async function sendCompactionComplete(uuid: string, key: string): Promise<void>')
  expect(daemon).toContain('await sendCompactionComplete(uuid, key)')
  expect((daemon.match(/formatAgentReply\(runtimeForUuid\(uuid\), display\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  expect(hook).toContain('export function preCompactSessionId(input: string): string | undefined')
  expect(hook).toContain('let parsed: unknown')
  expect(hook).toContain('const sessionId = record?.session_id')
  expect(hook).toContain('export function compactStartingMessage(uuid: string): string')
  expect(hook).not.toContain('let data: { session_id?: string }')
  expect(driver).toContain("type: 'compaction'")
  expect(driver).toContain("status: 'started'")
  expect(driver).toContain("status: 'completed'")
})

test('Codex app-server uses websocket runtime and auto-attaches remote TUI', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const driver = readFileSync('agents/codex/app-server-driver.ts', 'utf8')
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  const lifecycle = readFileSync('agents/codex/session.ts', 'utf8')
  const bindings = readFileSync('bindings.ts', 'utf8')
  expect(client).toContain("'ws://127.0.0.1:0'")
  expect(client).toContain('appServerListenUrlFromLine')
  expect(client).toContain('new WebSocket(this.appServerUrl)')
  expect(driver).toContain('listen: this.opts.appServerListen ?? runtimeConfig.appServerListen')
  expect(driver).toContain("meta: { appServerUrl: client.url() }")
  expect(daemon).toContain('codexConfig: CODEX_CONFIG')
  expect(daemon).toContain('const codexSessionLifecycle = new CodexAppServerSession')
  expect(lifecycle).toContain('export function codexTuiTabName(sessionId: string): string')
  expect(lifecycle).toContain('return `ccm:cx:${sessionId.slice(0, 8)}`')
  expect(daemon).toContain('async function ensureCodexRemoteTui')
  expect(lifecycle).toContain('function codexRemoteTuiCommand')
  expect(lifecycle).toContain('function codexTuiPaneMatchesSession')
  expect(lifecycle).toContain("[status.terminalCommand, status.paneCommand].some(command => command?.includes(appServerUrl) && command.includes(threadId))")
  expect(lifecycle).toContain('closing stale codex remote TUI')
  expect(daemon).toContain('function codexUpdatePromptVisible(screen: string): boolean')
  expect(daemon).toContain("sendKeys(paneId, 'Down', 'Down', 'Enter')")
  expect(daemon).toContain('async function sendCodexTuiNav')
  expect(lifecycle).toContain("commandLine(config.command, [...config.launchArgs, '--remote', appServerUrl, 'resume', session.nativeSessionId, '-C', session.cwd])")
  const commandBody = lifecycle.slice(lifecycle.indexOf('function codexRemoteTuiCommand'), lifecycle.indexOf('export class CodexAppServerSession'))
  expect(commandBody).toContain("'resume', session.nativeSessionId")
  expect(daemon).toContain('const tuiReady = await ensureCodexRemoteTui(sessionId, session)')
  expect(daemon).toContain('const { appServerUrl: _appServerUrl, ...durableMeta } = meta')
  expect(daemon).not.toContain('appServerUrl: session.meta?.appServerUrl')
  expect(daemon).not.toContain('void ensureCodexRemoteTui(uuid, session, ck)')
  expect(daemon).not.toContain("if (peer === 'codex') void ensureCodexRemoteTui(peerUuid, session, ck)")
  expect(lifecycle).toContain('this.tui.closeTab(this.tabName(sessionId))')
  expect(bindings).not.toContain('appServerUrl?: string')
  expect(bindings).toContain('tuiTabName?: string')
})


test('E2E parity plan includes reversible production cutover runbook', () => {
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  expect(plan).toContain('## Temporary Cutover Runbook')
  expect(plan).toContain('before-cx-e2e')
  expect(plan).toContain('systemctl --user stop ccm-daemon.service')
  expect(plan).toContain('systemctl --user daemon-reload')
  expect(plan).toContain('CHANNEL_DAEMON_ALLOWED_CHANNELS=slack:<SLACK_CHANNEL_ID>,telegram:<TELEGRAM_GROUP_ID>')
  expect(plan).toContain('CHANNEL_DAEMON_SELF_TEST_PREFIX')
  expect(plan).toContain('readlink /proc/$pid/cwd')
  expect(plan).toContain('WorkingDirectory=<CANDIDATE_CWD>')
  expect(plan).toContain('The final cwd should be `<PRODUCTION_CWD>` unless the user explicitly requests')
})

test('completion audit maps objective to concrete evidence and keeps live E2E open', () => {
  const audit = readFileSync('docs/completion-audit.md', 'utf8')
  for (const required of [
    'Objective Restatement',
    'Prompt-to-Artifact Checklist',
    'Claude Code (`/cc`) and Codex (`/cx`)',
    'visible agent identity',
    'Preserve original Claude use cases',
    'Make `/cc` and `/cx` command UX shape consistent',
    'Preserve Slack thread broadcast and Telegram reply anchoring',
    'Preserve markdown forwarding/styling',
    'Handle Codex approvals/input/nav like Claude nav where possible',
    'Support Codex transcript fallback',
    'Support Codex worktree/cwd UX aligned with Claude',
    'Keep daemon state lightweight',
    'Make same-room peer handoff controlled but async',
    'Support safe E2E cutover using same Slack/Telegram tokens',
    'scripts/e2e-cutover.sh',
    'auto-restore and backup overwrite guard',
    'Final live Slack/Telegram E2E',
    'scripts/e2e-result.sh new/check',
    'scripts/e2e-result.sh check <result-file>',
    'Missing; required before 100%',
  ]) {
    expect(audit).toContain(required)
  }
})

test('E2E cutover helper preserves reversible service safety rails', () => {
  const script = readFileSync('scripts/e2e-cutover.sh', 'utf8')
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  for (const required of [
    'start-candidate',
    'restore-old',
    'before-cx-e2e',
    'CHANNEL_DAEMON_SELF_TEST_PREFIX must be unset',
    'CHANNEL_DAEMON_ALLOWED_CHANNELS="$allow" "$root/scripts/e2e-preflight.sh"',
    'systemctl --user stop "$service"',
    'systemctl --user daemon-reload',
    'proc_root="${CCM_E2E_PROC_ROOT:-/proc}"',
    'readlink "$proc_root/$pid/cwd"',
    'expected $prod_cwd',
    'Restoring previous unit automatically.',
    'cp "$backup" "$unit"',
    'Refusing to overwrite existing backup with unexpected cwd',
  ]) {
    expect(script).toContain(required)
  }
  expect(plan).toContain('scripts/e2e-cutover.sh start-candidate')
  expect(plan).toContain('scripts/e2e-cutover.sh restore-old')
})

test('live E2E result template captures auditable completion evidence', () => {
  const template = readFileSync('docs/e2e-result-template.md', 'utf8')
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  for (const required of [
    'Candidate cwd',
    'Restored production cwd',
    'Slack channel: `<SLACK_CHANNEL_ID>`',
    'Telegram group: `<TELEGRAM_GROUP_ID>`',
    '`bun run validate` passed before cutover',
    '`scripts/e2e-cutover.sh start-candidate` landed in candidate cwd',
    '`/cx help` shows `🟢 Codex`',
    '`/cx ss` shows Codex snapshot',
    '`/cx nav` shows/handles pending approval',
    'Thread reply `codex: reply exactly THREAD_OK` stays threaded and broadcasts',
    'Markdown prompt renders bold/link/table readably',
    '`claude: say exactly CC_READY` replies',
    '`/cc ss` shows Claude snapshot only',
    'Repeat Codex smoke in Telegram group',
    'Repeat Claude smoke in Telegram group',
    '`scripts/e2e-cutover.sh restore-old` restored old production cwd',
  ]) {
    expect(template).toContain(required)
  }
  expect(plan).toContain('scripts/e2e-result.sh new <run-name>')
  expect(plan).toContain('scripts/e2e-result.sh check <result-file>')
})

test('live E2E result helper is documented and guarded', () => {
  const script = readFileSync('scripts/e2e-result.sh', 'utf8')
  const plan = readFileSync('docs/e2e-parity-plan.md', 'utf8')
  const preflight = readFileSync('scripts/e2e-preflight.sh', 'utf8')
  for (const required of [
    'new [name]',
    'check <file>',
    'Result file still contains TODO checks',
    'Result file has no PASS/WARN evidence rows',
    'docs/e2e-results',
    'CCM_E2E_RESULTS_DIR',
  ]) {
    expect(script).toContain(required)
  }
  expect(plan).toContain('scripts/e2e-result.sh new <run-name>')
  expect(plan).toContain('scripts/e2e-result.sh check <result-file>')
  expect(preflight).toContain('scripts/e2e-result.sh new <run-name>')
  expect(preflight).toContain('scripts/e2e-result.sh check <result-file>')
})


test('Codex app-server stop owns process-group and awaited stop semantics', () => {
  const client = readFileSync('agents/codex/app-server-client.ts', 'utf8')
  const daemon = readFileSync('daemon.ts', 'utf8')
  const lifecycle = readFileSync('agents/codex/session.ts', 'utf8')
  expect(client).toContain('detached: true')
  expect(client).toContain('function signalProcessGroup')
  expect(client).toContain("signalProcessGroup(pid, 'SIGTERM')")
  expect(client).toContain("signalProcessGroup(pid, 'SIGKILL')")
  expect(daemon).toContain('async function killSession(uuid: string): Promise<void>')
  expect(daemon).toContain('await codexSessionLifecycle.stop(uuid)')
  expect(lifecycle).toContain('await this.opts.driver.stop?.(session)')
  expect(daemon).toContain('async function killSessionIfUnboundEverywhere(uuid: string, runtime: AgentRuntimeKind): Promise<boolean>')
  expect(daemon).toContain('async function stopRoomMappedSession(ck: string, runtime: AgentRuntimeKind, uuid: string): Promise<void>')
  const killSessionBody = daemon.slice(daemon.indexOf('async function killSession(uuid: string): Promise<void>'), daemon.indexOf('function unbind(ck: string'))
  expect(killSessionBody).not.toContain('void codexSessionLifecycle.stop(uuid).catch')
})

test('room lifecycle contract keeps mappings through stop and gates Codex TUI readiness', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const bindings = readFileSync('bindings.ts', 'utf8')
  const lifecycle = readFileSync('agents/codex/session.ts', 'utf8')
  expect(bindings).toContain('desiredRunning?: boolean')
  expect(daemon).toContain('function setAgentDesiredRunning')
  expect(daemon).toContain('function agentDesiredRunning')
  expect(daemon).toContain('setAgentDesiredRunning(ck, runtime, false)')
  expect(daemon).toContain('await killSession(uuid)')
  const stopCase = daemon.slice(daemon.indexOf("case 'stop':"), daemon.indexOf("case 'stop_id':"))
  expect(stopCase).toContain('await stopRoomMappedSession(ck, runtime, uuid)')
  expect(stopCase).not.toContain('unbindSessionEverywhere')
  expect(daemon).toContain('async function ensureRoomAgentReady')
  expect(daemon).toContain('const uuid = await ensureRoomAgentReady(ck, runtime, false)')
  expect(daemon).toContain('let uuid = await ensureRoomAgentReady(ck, runtime, makeActive)')
  expect(daemon).toContain('let peerUuid = await ensureRoomAgentReady(ck, peer, false)')
  expect(daemon).toContain('const tuiReady = await ensureCodexRemoteTui')
  expect(lifecycle).toContain('codexTuiPaneReadyForSession')
  expect(lifecycle).toContain('throw new Error(`codex remote TUI failed to become ready')
})

test('room delete and path-change reset are confirmed operations', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain("| { t: 'delete_room' }")
  expect(daemon).toContain('async function deleteRoomState')
  expect(daemon).toContain("if (/^(?:delete|reset)\\s+room$/i.test(args)) return { t: 'delete_room' }")
  expect(daemon).toContain("{ text: '🗑 Confirm Delete Room', data: 'cmd:delete_room_confirm' }")
  expect(daemon).toContain("action === 'delete_room_confirm'")
  expect(daemon).toContain("action.startsWith('pathconfirm:')")
  expect(daemon).toContain('await deleteRoomState(ck)')
  expect(daemon).toContain('encodeURIComponent(cmd.cwd)')
})


test('stopped Codex sessions remain resolvable for resume by ccm id', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  expect(daemon).toContain('type StoredCodexSession = { transcriptPath?: string; nativeSessionId?: string; cwd?: string; mtime: number }')
  expect(daemon).toContain('function rememberCodexSession(session: AgentSession): void')
  expect(daemon).toContain('rememberCodexSession(session)')
  expect(daemon).toContain('const storedCodexSessions = (): SessionInfo[] => Object.entries(codexSessionMap).map')
  expect(daemon).toContain('codexStoredNativeSessionId(uuid)')
  expect(daemon).not.toContain('codexNativeSessionIds')
})

test('Codex resume uses selected stored native thread before stale room metadata', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const nativeResolver = daemon.slice(daemon.indexOf('function codexNativeSessionIdForResume'), daemon.indexOf('function codexNativeSessionIdFromTranscriptPath'))
  expect(nativeResolver.indexOf('codexStoredNativeSessionId(uuid)')).toBeGreaterThanOrEqual(0)
  expect(nativeResolver.indexOf('meta?.nativeSessionId')).toBeGreaterThan(nativeResolver.indexOf('codexStoredNativeSessionId(uuid)'))

  const spawnResume = daemon.slice(daemon.indexOf('async function spawnResumeOnce'), daemon.indexOf('async function resumeAndBind'))
  expect(spawnResume).toContain('selected?: SessionInfo')
  expect(spawnResume).toContain('sessionInfo?.nativeSessionId ?? codexNativeSessionIdForResume(uuid, meta)')
  expect(spawnResume).toContain('Codex resume requires a trusted native thread id; refusing to start a new conversation.')
  expect(spawnResume).not.toContain("spawnAgent(runtime, uuid, cwd, hasTranscript")

  const resumeIdCase = daemon.slice(daemon.indexOf("case 'resume_id':"), daemon.indexOf("case 'screen':"))
  expect(resumeIdCase).toContain('selected = resolved.session')
  expect(resumeIdCase).toContain('await resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')

  const callbackResume = daemon.slice(daemon.indexOf("data.startsWith('ccr:')"), daemon.indexOf("data.startsWith('ccp:')"))
  expect(callbackResume).toContain('listAllAgentSessions(500, runtime).find(s => s.uuid === uuid) ?? boundAgentSessions(runtime).find(s => s.uuid === uuid)')
  expect(callbackResume).toContain('await resumeAndBind(ck, uuid, runtime, true, cwdForSessionInfo(selected, roomCwd(ck)), selected)')
})


test('Codex remote TUI attaches to app-server without owning thread lifecycle', () => {
  const lifecycle = readFileSync('agents/codex/session.ts', 'utf8')
  const commandBody = lifecycle.slice(lifecycle.indexOf('function codexRemoteTuiCommand'), lifecycle.indexOf('export class CodexAppServerSession'))
  const classBody = lifecycle.slice(lifecycle.indexOf('export class CodexAppServerSession'))
  expect(commandBody).toContain("commandLine(config.command, [...config.launchArgs, '--remote', appServerUrl, 'resume', session.nativeSessionId, '-C', session.cwd])")
  expect(commandBody).toContain('session.nativeSessionId')
  expect(classBody).toContain('codexTuiPaneMatchesSession(status, appServerUrl, session.nativeSessionId)')
})
