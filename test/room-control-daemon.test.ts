import { readFileSync } from 'fs'
import { test, expect } from 'bun:test'
import { CCM_MCP_TOOLS } from '../mcp-tools.js'

test('MCP exposes the V1 room lifecycle and parent worker execution tools with bound-room routing', () => {
  const server = readFileSync('server.ts', 'utf8')
  const toolText = JSON.stringify(CCM_MCP_TOOLS)

  expect(server).toContain('tools: CCM_MCP_TOOLS')
  expect(toolText).toContain('create_room_with_bot_invited')
  expect(toolText).toContain('archive_room')
  expect(toolText).toContain('bind_worker_room')
  expect(toolText).toContain('start_worker_agent')
  expect(toolText).toContain('send_worker_raw_command')
  expect(toolText).toContain('send_worker_task')
  expect(toolText).toContain('capture_worker_report')
  expect(toolText).toContain('get_current_ccm_context')
  expect(toolText).toContain('authorized_control_tools')
  expect(toolText).toContain('resolved')
  expect(toolText).toContain('ambiguous')
  expect(toolText).toContain('not_bound')
  expect(toolText).toContain('desired_room_name')
  expect(toolText).toContain('parent_chat_id')
  expect(toolText).toContain('chat_id is optional when the current CCM turn/session binding resolves to one room')
  expect(toolText).toContain('bind a worker room cwd/runtime metadata from the current Orchestrator parent room')
  expect(toolText).toContain('start or resume the assigned worker agent in a bound worker room from the current Orchestrator parent room')
  expect(toolText).toContain('send a raw native runtime slash command to a started worker agent from the current Orchestrator parent room')
  expect(toolText).toContain('send a bounded Worker Task to a started/bound worker room from the current Orchestrator parent room')
  expect(toolText).toContain('retrieve worker-room transcript/reportback facts from the current Orchestrator parent room')
  expect(toolText).toContain('Do not use the desired/new worker room as chat_id')
  expect(server).not.toContain("ccm_room_token")
  expect(toolText).not.toContain('create_telegram_room')
  expect(toolText).not.toContain('adopt_room')
})

test('Agent Control Path schemas allow resolver chat_id fallback where safe', () => {
  const currentContext = CCM_MCP_TOOLS.find(tool => tool.name === 'get_current_ccm_context')
  expect(currentContext?.inputSchema.required).toEqual([])
  expect(currentContext?.outputSchema?.required).toEqual(['status', 'authorized_control_tools'])
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('authorized_control_tools')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('orchestrator_source')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('parent_room_id')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('resolved')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('ambiguous')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('not_bound')

  const createRoom = CCM_MCP_TOOLS.find(tool => tool.name === 'create_room_with_bot_invited')
  expect(createRoom?.inputSchema.required).toEqual(['desired_room_name'])
  expect(JSON.stringify(createRoom)).toContain('parent_chat_id defaults to the resolved/current Orchestrator parent room')

  for (const name of ['archive_room', 'bind_worker_room', 'start_worker_agent', 'send_worker_raw_command', 'send_worker_task', 'capture_worker_report'] as const) {
    const tool = CCM_MCP_TOOLS.find(candidate => candidate.name === name)
    expect(tool?.inputSchema.required).not.toContain('chat_id')
  }
})

test('daemon room control routes are gated by bound room, adapter, and orchestrator flag', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')

  expect(daemon).toContain('assertOrchestratorRoom(route.channelKey)')
  expect(daemon).toContain('currentCcmContextForSession(uuid: string, args: Record<string, unknown>)')
  expect(daemon).toContain('orchestratorToolChannelKey(uuid: string, requestedCk: string)')
  expect(daemon).toContain("msg.tool === 'get_current_ccm_context'")
  expect(daemon).toContain('resolveCurrentCcmContext(callerUuid')
  expect(daemon).toContain('requires an orchestrator room, but')
  expect(daemon).toContain('const parentChatId = stringValue(msg.args.parent_chat_id) || route.channelKey')
  expect(daemon).toContain("case 'create_room_with_bot_invited'")
  expect(daemon).toContain("case 'archive_room'")
  expect(daemon).toContain("case 'bind_worker_room'")
  expect(daemon).toContain("case 'start_worker_agent'")
  expect(daemon).toContain("case 'send_worker_raw_command'")
  expect(daemon).toContain("case 'send_worker_task'")
  expect(daemon).toContain("case 'capture_worker_report'")
  expect(daemon).toContain('adapter.createRoomWithBotInvited')
  expect(daemon).toContain('adapter.archiveRoom')
  const archiveBlock = daemon.slice(daemon.indexOf("case 'archive_room':"), daemon.indexOf("case 'bind_worker_room':"))
  expect(archiveBlock).toContain('const workerCk = channelKeyForRoomId(route.channelKey, roomId)')
  expect(archiveBlock).toContain('assertSamePlatformRoom(route.channelKey, workerCk)')
  expect(archiveBlock).toContain('await deleteRoomState(workerCk)')
  expect(archiveBlock.indexOf('const resultFacts = await adapter.archiveRoom({ roomId })')).toBeLessThan(archiveBlock.indexOf('await deleteRoomState(workerCk)'))
  expect(daemon).toContain('setRoom(workerCk, cwd, runtime)')
  expect(daemon).toContain('setRoomWorkerRole(workerCk, route.channelKey)')
  expect(daemon).toContain('setRoomWorkerRole(channelKeyForRoomId(route.channelKey, resultFacts.roomId), route.channelKey)')
  expect(daemon).toContain("if (!cwd.startsWith('/')) throw new Error('cwd must be absolute')")
  expect(daemon).toContain('startNew(workerCk, roomCwd(workerCk), runtime, true, true)')
  expect(daemon).toContain("waitForLiveBridge(sessionId, 30_000)")
  expect(daemon).toContain("if (!rawCommand.startsWith('/')) throw new Error('command must be slash-shaped')")
  expect(daemon).toContain('sendClaudePaneRawCommand(workerCk, sessionId, rawCommand)')
  expect(daemon).toContain('sendCodexRawCommand(workerCk, sessionId, rawCommand')
  expect(daemon).toContain("if (!sessionId) throw new Error('worker agent must be started before sending a task')")
  expect(daemon).toContain('call start_worker_agent before send_worker_task')
  expect(daemon).toContain('deliverUserTurn(workerCk')
  expect(daemon).toContain('workerTranscriptFacts(workerCk, runtime, limit)')
  expect(daemon).toContain("lastAssistantMessage: [...entries].reverse().find(entry => entry.role !== 'user')?.text")
  expect(daemon).toContain('JSON.stringify(resultFacts)')
  expect(daemon).toContain('Room is not flagged as an Agent Control Path orchestrator room')
  expect(daemon).toContain('Room lifecycle operation is not supported by')
})

test('daemon preflights Claude goals that request visible worker rooms', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const helper = daemon.slice(daemon.indexOf('function claudeGoalRequiresOrchestrator'), daemon.indexOf('function zellijSync'))
  const slashBlock = daemon.slice(daemon.indexOf("    case 'slash':"), daemon.indexOf("    case 'new':"))

  expect(helper).toContain('/^\\/goal')
  for (const marker of ['orchestrate-workers', 'Worker Rooms?', 'Agent Control Path', 'create_room_with_bot_invited', 'bind_worker_room', 'start_worker_agent', 'send_worker_task', 'capture_worker_report']) {
    expect(helper).toContain(marker)
  }
  expect(helper).toContain('attention_needed — stopped before starting Claude `/goal`.')
  expect(helper).toContain('Run `/ccm orch on` in this room')
  expect(slashBlock).toContain('claudeGoalRequiresOrchestrator(cmd.command) && !normalizeBinding(loadBindings()[ck]).isOrchestrator')
  expect(slashBlock.indexOf('claudeGoalRequiresOrchestrator(cmd.command)')).toBeLessThan(slashBlock.indexOf('const uuid = bindingUuid(ck, runtime)'))
  expect(slashBlock.indexOf('claudeGoalRequiresOrchestrator(cmd.command)')).toBeLessThan(slashBlock.indexOf('sendClaudePaneRawCommand(ck, uuid, commandText)'))
})

test('rotate_orchestrator is registered as an Agent Control Path tool and succeeds without growing the net orchestrator count', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const toolText = JSON.stringify(CCM_MCP_TOOLS)

  expect(daemon).toContain("'rotate_orchestrator'")
  expect(daemon).toContain("'capture_worker_report', 'rotate_orchestrator'")
  expect(toolText).toContain('rotate_orchestrator')
  expect(toolText).toContain('succession, not escalation')

  const rotateBlock = daemon.slice(daemon.indexOf("case 'rotate_orchestrator':"), daemon.indexOf("case 'ask_peer':"))
  expect(rotateBlock).toContain('assertOrchestratorRoom(route.channelKey)')
  expect(rotateBlock).toContain('channelKeyForRoomId(route.channelKey, stringValue(msg.args.successor_room_id))')
  expect(rotateBlock).toContain('assertSamePlatformRoom(route.channelKey, successorCk)')
  expect(rotateBlock).toContain("throw new Error('successor_room_id must not be the calling orchestrator room')")
  expect(rotateBlock).toContain('setBindingSuccessorRole(b, successorCk, DEFAULT_AGENT_RUNTIME)')
  expect(rotateBlock).toContain('setBindingWorkerRole(b, workerCk, successorCk, DEFAULT_AGENT_RUNTIME)')
  expect(rotateBlock).toContain('setBindingOrchestratorFlag(b, route.channelKey, false, DEFAULT_AGENT_RUNTIME)')
  expect(rotateBlock).toContain("throw new Error(`worker_room_ids entry ${workerCk} has no existing binding`)")
  expect(rotateBlock).toContain("event: 'orchestrator_rotated'")
  expect(rotateBlock).toContain("operation: 'rotate_orchestrator'")
  // Load-mutate-save as a single pass: exactly one loadBindings()/saveBindings() call in the block.
  expect(rotateBlock.match(/loadBindings\(\)/g)?.length).toBe(1)
  expect(rotateBlock.match(/saveBindings\(/g)?.length).toBe(1)
})

test('startNew resolves a claude worker room model pin/default before any uuid binding exists', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')

  // effectiveClaudeModelForRoom does the override/worker-default/inherited resolution directly
  // from a channel key, and effectiveClaudeModel (uuid-keyed) delegates to it rather than
  // duplicating the logic.
  const forRoomFn = daemon.slice(daemon.indexOf('function effectiveClaudeModelForRoom'), daemon.indexOf('function effectiveClaudeModel(uuid'))
  expect(forRoomFn).toContain("agentMeta(ck, 'claude')?.model")
  expect(forRoomFn).toContain('isWorkerRoomKey(ck)')
  expect(forRoomFn).toContain('WORKER_DEFAULT_CLAUDE_MODEL')
  const uuidFn = daemon.slice(daemon.indexOf('function effectiveClaudeModel(uuid'), daemon.indexOf('function effectiveClaudeModel(uuid') + 400)
  expect(uuidFn).toContain('...effectiveClaudeModelForRoom(ck)')

  // spawnClaude prefers an explicitly-passed channel key over the uuid lookup.
  const spawnClaudeFn = daemon.slice(daemon.indexOf('async function spawnClaude'), daemon.indexOf('async function spawnCodexAppServer'))
  expect(spawnClaudeFn).toContain('explicitChannelKey?: string')
  expect(spawnClaudeFn).toContain('explicitChannelKey ? { ck: explicitChannelKey, ...effectiveClaudeModelForRoom(explicitChannelKey) } : effectiveClaudeModel(uuid)')

  // spawnAgent forwards it from options into the claude driver; codex keeps taking options as-is.
  const spawnAgentFn = daemon.slice(daemon.indexOf('async function spawnAgent'), daemon.indexOf('async function spawnClaude'))
  expect(spawnAgentFn).toContain('channelKey?: string')
  expect(spawnAgentFn).toContain('claudeDriver.start({ sessionId: uuid, cwd, channelKey: options.channelKey })')
  expect(spawnAgentFn).toContain('claudeDriver.resume({ sessionId: uuid, cwd, channelKey: options.channelKey })')

  // The claudeDriver wiring and startNew's first-spawn call both carry the channel key through.
  expect(daemon).toContain('spawn: (sessionId, cwd, resumeMode, channelKey) => spawnClaude(sessionId, cwd, resumeMode, channelKey)')
  const startNewFn = daemon.slice(daemon.indexOf('async function startNew'), daemon.indexOf('function clearRuntimeState'))
  expect(startNewFn).toContain('spawnAgent(runtime, uuid, cwd, false, { model: existingMeta?.model, channelKey: ck })')
})

test('capture_worker_report transcript reads use unwrapClaudeTurnText, not the broken non-backreferenced tag strip', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')

  expect(daemon).toContain('unwrapClaudeTurnText(extractTextFromContent(message?.content)).trim()')
  expect(daemon).not.toContain('.replace(/<[^>]+>[\\s\\S]*?<\\/[^>]+>/g, \'\')')
  const readEntriesFn = daemon.slice(daemon.indexOf('function readClaudeTranscriptEntries'), daemon.indexOf('function claudeSnapshot'))
  expect(readEntriesFn).toContain("entry.type === 'user'")
  expect(readEntriesFn).toContain('unwrapClaudeTurnText')
})

test('get_worker_status exposes claude pane dialog state via the same detection claudeSnapshot uses, without making workerStatusFacts async', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const toolText = JSON.stringify(CCM_MCP_TOOLS)

  const dialogFn = daemon.slice(daemon.indexOf('function claudeWorkerPaneDialog'), daemon.indexOf('function workerStatusFacts'))
  expect(dialogFn).toContain('resolveClaudePaneHandle(sessionId)')
  expect(dialogFn).toContain('dumpScreenInSession(pane.sessionName, pane.paneId)')
  expect(dialogFn).toContain('isClaudeDialogScreen(screen)')
  expect(dialogFn).not.toContain('async')

  const factsFn = daemon.slice(daemon.indexOf('function workerStatusFacts'), daemon.indexOf('function roomHasResettableState'))
  expect(factsFn).not.toContain('async function workerStatusFacts')
  expect(factsFn).toContain("...(runtime === 'claude' ? { paneDialog: claudeWorkerPaneDialog(sessionId) } : {})")

  // Call sites stay synchronous too -- no await was added.
  expect(daemon).toContain("result = JSON.stringify({ ok: true, operation: 'get_worker_status', ...workerStatusFacts(workerCk, runtime) })")
  expect(daemon).not.toContain('await workerStatusFacts')
  expect(toolText).toContain('paneDialog')
})
