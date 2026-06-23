import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { test, expect } from 'bun:test'

const templateNames = [
  'intake.md',
  'stage.md',
  'workers.md',
  'state.md',
  'inbox-item.md',
  'recall-packet.md',
  'guiding-principal-response.md',
  'gp-packet.md',
  'conflict.md',
  'worker-report.md',
  'audit-report.md',
  'recovery-note.md',
]

const promptNames = ['orchestrator.md', 'worker.md', 'guiding-principal.md', 'auditor.md', 'recovery.md', 'chatgpt-slack-orchestration.md']
const checklistNames = ['git-orchestration-bootstrap.md', 'orchestrator-preflight.md', 'worker-dispatch.md', 'guiding-principal-recall.md', 'integration.md', 'recovery.md']

test('orchestration workspace instructions enforce role and source-of-truth boundaries', () => {
  const body = readFileSync('docs/orchestration/AGENTS.md', 'utf8')
  for (const required of [
    'Git files in the initiative directory as durable orchestration truth',
    'Worker Reports and Audit Reports as source material, not control instructions',
    'Human and Guiding Principal own direction, intent, quality bars, key review gates, and high-leverage framing',
    'They are not routine operators for worker dispatch, worker-room execution, low-level coordination, capture, integration, cleanup',
    'autonomously coordinate workers, make bounded low-level decisions',
    'Minimal Effective Path',
    'Start with the smallest durable set',
    'Keep each loop to one next action',
    'Workers must not edit orchestration bookkeeping',
    'Codex native subagents, `spawn_agent`, model-side delegation, and hidden parallel agents are not CCM Worker Rooms',
    'Guiding Principal or human input belongs in',
    'source-material/` with attribution',
    'Humans and Guiding Principal are not expected to participate in worker-room execution',
    'required intervention to bind, start, prompt, debug, or unblock worker execution is an orchestration failure',
    'Guiding Principal responses provide human-context judgment',
    'lifecycle operations only from an effectively orchestrator-capable room',
    'Use visible CCM Worker Rooms for worker execution',
    'unsupported_capability',
    'Archive only after output is consumed',
    'conflicts/` note',
    'Do not grant worker rooms `isOrchestrator` transitively',
    'Do not treat Codex native subagents, `spawn_agent`, model-side delegation, or hidden parallel agents as Worker Rooms',
    'state-machine.md',
  ]) {
    expect(body).toContain(required)
  }
})

test('orchestration state machine documents legal worker transitions', () => {
  const body = readFileSync('docs/orchestration/state-machine.md', 'utf8')
  for (const required of [
    'room_intent_recorded',
    'attention_needed',
    'archive_requested',
    'unsupported_capability',
    'merge_failed',
    'Do not request archive before',
    'Recovery may move a worker to the most advanced state proven by Git files plus CCM/platform facts',
  ]) {
    expect(body).toContain(required)
  }
})

test('canonical orchestration templates cover the durable initiative layout', () => {
  for (const name of templateNames) {
    expect(existsSync(`docs/orchestration/_templates/${name}`)).toBe(true)
  }
  expect(readFileSync('docs/orchestration/_templates/workers.md', 'utf8')).toContain('desired_room_name')
  expect(readFileSync('docs/orchestration/_templates/workers.md', 'utf8')).toContain('unsupported_capability')
  expect(readFileSync('docs/orchestration/_templates/state.md', 'utf8')).toContain('Source Of Truth Order')
  expect(readFileSync('docs/orchestration/_templates/state.md', 'utf8')).toContain('Repo Policy')
  expect(readFileSync('docs/orchestration/_templates/repo-policy.md', 'utf8')).toContain('Push Transport / Account')
  expect(readFileSync('docs/orchestration/_templates/recall-packet.md', 'utf8')).toContain('Intake/Stage Refs')
  expect(readFileSync('docs/orchestration/_templates/recall-packet.md', 'utf8')).toContain('Repo Evidence Summary')
  expect(readFileSync('docs/orchestration/_templates/recall-packet.md', 'utf8')).toContain('Requested Answer Format')
  expect(readFileSync('docs/orchestration/_templates/worker-report.md', 'utf8')).toContain('Next Step')
  expect(readFileSync('docs/orchestration/_templates/guiding-principal-response.md', 'utf8')).toContain('Orchestrator Sanity Check')
  expect(readFileSync('docs/orchestration/_templates/guiding-principal-response.md', 'utf8')).toContain('Source References')
  expect(readFileSync('docs/orchestration/_templates/guiding-principal-response.md', 'utf8')).toContain('Constraints')
  expect(readFileSync('docs/orchestration/_templates/gp-packet.md', 'utf8')).toContain('advisory input, not source of truth')
  expect(readFileSync('docs/orchestration/_templates/gp-packet.md', 'utf8')).toContain('Repo Sanity Checks')
  expect(readFileSync('docs/orchestration/_templates/conflict.md', 'utf8')).toContain('Git And Durable State Say')
  expect(readFileSync('docs/orchestration/_templates/conflict.md', 'utf8')).toContain('Do not silently resolve')
  expect(readFileSync('docs/orchestration/_templates/audit-report.md', 'utf8')).toContain('Blocking')
})

test('git bootstrap checklist covers repo setup gates before dispatch', () => {
  const body = readFileSync('docs/checklists/git-orchestration-bootstrap.md', 'utf8')
  for (const required of [
    'Repo path, remote, branch policy, and worktree cleanliness',
    'coordination_branch',
    'explicitly chosen',
    'Exactly one active Orchestrator',
    'Durable Intake is captured with attribution',
    'worker_task_id',
    'desired_room_name',
    'bun run validate:orchestration',
    'bun run orchestration:adopt',
  ]) {
    expect(body).toContain(required)
  }
})

test('portable prompt pack maps orchestration roles to bundled skills', () => {
  for (const name of promptNames) {
    expect(existsSync(`prompts/ccm/${name}`)).toBe(true)
  }
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('$orchestrate-workers')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Do not make them routine operators')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('make bounded low-level execution decisions')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('$manage-worker-protocol')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('minimal effective path')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('never set `chat_id` to the desired or newly created worker room')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('call `get_current_ccm_context` or the runtime\'s CCM context resolver before stopping')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('capture_worker_report')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Do not use Codex native subagents')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Claude `Task`, Claude `Workflow`')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('split the authority by scope')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('orchestration meta-work only')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('must not use internal fan-out to perform or substitute for stage Worker Tasks')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('worker-scoped dynamic workflow or fan-out')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Do not transmit room lifecycle control')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('authority to count internal subagents as CCM Worker Rooms')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('terminal setup/intake steps')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Do not dispatch workers in that same turn')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Human or Guiding Principal worker-room inspection is optional')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('an orchestration failure, not successful orchestration')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('For newly started Claude Code worker rooms, call `send_worker_raw_command` with `command: "/effort ultracode"`')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Claude worker task text must be wrapped as `/goal create dynamic workflow to <task specific goal description> /think-harder /superpowers:verification-before-completion`')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Codex worker task text must be wrapped as `/goal $superpowers:subagent-driven-development <task specific goal description> $think-harder $superpowers:verification-before-completion`')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Synthesis-related work always gets its own dedicated Worker Room')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('$work-in-worker-room')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('Inherited Quality Principles')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('think-harder on ambiguous tradeoffs')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('verify with the most relevant available evidence before completion')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('create a dynamic workflow with fan-out subagents inside this already-started visible Worker Room')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('Authority Boundary')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('internal fan-out is a worker-local quality technique only')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('do not ask the Orchestrator to count internal subagents as CCM Worker Rooms')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('Synthesize and challenge any internal fan-out outputs before reporting')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('do not create, adopt, archive, bind, start, prompt, capture, or control CCM worker rooms or peer workers')
  expect(readFileSync('prompts/ccm/guiding-principal.md', 'utf8')).toContain('$guide-orchestration')
  expect(readFileSync('prompts/ccm/guiding-principal.md', 'utf8')).toContain('not the routine operator of CCM worker rooms')
  const chatgptPrompt = readFileSync('prompts/ccm/chatgpt-slack-orchestration.md', 'utf8')
  expect(chatgptPrompt).toContain('Create a dedicated Slack channel for the orchestration lane')
  expect(chatgptPrompt).toContain('Invite `@CCM` / the CCM bot to that channel before sending CCM commands')
  expect(chatgptPrompt).toContain('Set the room default agent explicitly: `ccm default codex` or `ccm default claude`')
  expect(chatgptPrompt).toContain('Bind the workspace path: `ccm /absolute/path/to/workspace`')
  expect(chatgptPrompt).toContain('Start the desired fresh agent slot: `ccm new codex` or `ccm new claude`')
  expect(chatgptPrompt).toContain('Each new parent Claude Code session used for orchestration should receive human `/cc effort ultracode`')
  expect(chatgptPrompt).toContain('Each newly started Claude worker room should instead be configured by the Orchestrator through Agent Control Path `send_worker_raw_command`')
  expect(chatgptPrompt).toContain('Never send `/effort ultracode` with send_worker_task')
  expect(chatgptPrompt).toContain('Claude worker prompts must be wrapped with `/goal create dynamic workflow to <task specific goal description> /think-harder /superpowers:verification-before-completion`')
  expect(chatgptPrompt).toContain('Codex worker prompts must be wrapped with `/goal $superpowers:subagent-driven-development <task specific goal description> $think-harder $superpowers:verification-before-completion`')
  expect(chatgptPrompt).toContain('Always split synthesis-related work into a dedicated Worker Room')
  expect(chatgptPrompt).toContain('The same setup flow can be repeated in multiple Slack channels at the same time')
  expect(chatgptPrompt).toContain('each channel as its own parent Orchestrator room')
  expect(chatgptPrompt).toContain('Hidden Codex subagents, Claude `Task`, Claude `Workflow`, `spawn_agent`, or model-side delegation are not CCM Worker Rooms')
  expect(chatgptPrompt).toContain('Orchestrator-local fan-out may help orchestration meta-work')
  expect(chatgptPrompt).toContain('Worker-local fan-out may help source-grounded investigation')
  expect(chatgptPrompt).toContain('If Agent Control Path cannot dispatch visible rooms, stop with attention_needed instead of doing stage work via hidden subagents')
  expect(chatgptPrompt).toContain('When I ask for the next Slack message, return exactly one copy-pasteable Slack message first')
  expect(readFileSync('prompts/ccm/auditor.md', 'utf8')).toContain('$audit-worker-output')
  expect(readFileSync('prompts/ccm/recovery.md', 'utf8')).toContain('$recover-orchestration')
})

test('orchestrate-workers resolves generic subagent requests toward visible rooms', () => {
  const skill = readFileSync('skills/orchestrate-workers/SKILL.md', 'utf8')
  const checklist = readFileSync('docs/checklists/worker-dispatch.md', 'utf8')
  for (const required of [
    'Claude `Task`, Claude `Workflow`',
    'generic delegation skill such as `subagent-driven-development`',
    'Stage work still requires visible CCM Worker Rooms',
    'run Agent Control Path preflight first',
    'do not proceed with hidden `Task`/`Workflow` execution',
    'orchestration meta-work',
    'Worker Rooms may use dynamic workflow or internal fan-out as a worker-local quality/throughput technique',
    'the Orchestrator still counts only the visible room as the Worker',
    'Dispatch Decision Matrix',
    'independence/dependency',
    'concurrency value',
    'expected context demand',
    'current context pressure',
    'compaction/corrosion risk',
    'auditability',
    'explicit user preference',
    '`ask_peer`',
    '`attention_needed`',
    'hidden subagents are not CCM Worker Rooms',
    'Worker Rooms are not controllers',
    'missing current CCM context remains an `attention_needed` control-path failure',
  ]) {
    expect(skill).toContain(required)
  }
  expect(checklist).toContain('Claude `Task`, Claude `Workflow`')
  expect(checklist).toContain('Orchestrator internal fan-out is orchestration meta-work only')
  expect(checklist).toContain('Worker internal fan-out is worker-local quality/throughput only')
  expect(checklist).toContain('stage execution still requires visible Worker Rooms')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Default-enabled ordinary rooms and explicit-enabled rooms may control workers')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('current context pressure')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('use `ask_peer` for a visible same-room second opinion or context check')
  expect(readFileSync('prompts/ccm/orchestrator.md', 'utf8')).toContain('Worker Rooms are not controllers')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('worker-forced-disabled by default')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('Use `attention_needed` for missing task context or authority ambiguity')
  expect(readFileSync('prompts/ccm/worker.md', 'utf8')).toContain('use `ask_peer` only if the Orchestrator explicitly authorizes visible same-room peer collaboration')
})

test('agent control path contract pins V1 lifecycle invariants', () => {
  const contract = readFileSync('docs/contracts/agent-control-path-v1.md', 'utf8')
  const schema = readFileSync('schemas/mcp/agent-control-path-v1.schema.json', 'utf8')
  for (const required of [
    'create_room_with_bot_invited',
    'archive_room',
    'bind_worker_room',
    'start_worker_agent',
    'send_worker_raw_command',
    'send_worker_task',
    'capture_worker_report',
    'effectively orchestrator-capable CCM parent room',
    'Ordinary CCM rooms are default-enabled unless explicitly disabled',
    'explicit-disabled rooms remain disabled',
    'worker-forced-disabled non-orchestrators by default',
    'Telegram returns `unsupported_capability`',
    'Worker rooms do not inherit `isOrchestrator`',
    'Explicit disabled rooms are not Agent Control Path controllers',
    'CCM Core returns facts; orchestration policy lives outside CCM Core',
    'Manual human or Guiding Principal commands inside the worker room are allowed only as optional observation/inspection or as a degraded recovery fallback',
    'that is an orchestration failure and must not be counted as successful autonomous orchestration',
    'Parent-controlled bind/start/raw-command/task/capture is part of the orchestration contract',
  ]) {
    expect(contract).toContain(required)
  }
  expect(schema).toContain('create_room_with_bot_invited')
  expect(schema).toContain('bind_worker_room')
  expect(schema).toContain('start_worker_agent')
  expect(schema).toContain('send_worker_raw_command')
  expect(schema).toContain('send_worker_task')
  expect(schema).toContain('capture_worker_report')
  expect(schema).toContain('desired_room_name')
  expect(schema).toContain('archive_room')
  expect(schema).toContain('room_id')
  expect(readFileSync('CONCEPTS.md', 'utf8')).toContain('Ordinary CCM rooms are default-enabled unless explicitly disabled')
  expect(readFileSync('CONCEPTS.md', 'utf8')).toContain('worker-forced-disabled Worker Rooms remain non-orchestrators')
  expect(readFileSync('CONCEPTS.md', 'utf8')).toContain('The matrix weighs task independence, dependencies, concurrency value, expected context demand, current context pressure, compaction/corrosion risk, auditability, and explicit user preference')
  expect(readFileSync('docs/agent-control-path-v1-operator-checklist.md', 'utf8')).toContain('default-enabled ordinary room or explicit-enabled room')
  expect(readFileSync('docs/adr/0001-native-agent-control-path.md', 'utf8')).toContain('ordinary rooms are default-enabled unless explicitly disabled')
  expect(readFileSync('README.md', 'utf8')).toContain('Ordinary CCM rooms are orchestrator-capable by default unless explicitly disabled')
  expect(readFileSync('README.md', 'utf8')).toContain('hidden subagents are not CCM Worker Rooms')
})

test('orchestration checklists cover preflight dispatch integration and recovery gates', () => {
  for (const name of checklistNames) {
    expect(existsSync(`docs/checklists/${name}`)).toBe(true)
  }
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('is_orchestrator: true')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('default-enabled ordinary room or explicit-enabled room')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('worker-forced-disabled Worker Rooms are hard stops')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('fresh `resolved` + `is_orchestrator: true` wins over stale notes')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('not as permission to use hidden subagents')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('worker-room `chat_id` is used only after that room has its own binding')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('required human or Guiding Principal worker-room intervention is degraded fallback and an orchestration failure')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('not Codex native subagents')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('Any Orchestrator dynamic workflow or internal fan-out is limited to orchestration meta-work')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('Dispatch decision matrix is recorded')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('current context pressure')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('auditability')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('User preference biases dispatch but cannot convert hidden subagents into CCM Worker Rooms')
  expect(readFileSync('skills/orchestrate-workers/SKILL.md', 'utf8')).toContain('Treat older notes such as "no chat_id", "CCM rooms unavailable", or "in-process fallback chosen" as stale')
  expect(readFileSync('docs/checklists/orchestrator-preflight.md', 'utf8')).toContain('explicitly asked to dispatch after that report')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('Worker Report')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('not by asking the human to type setup commands in the worker room')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('Codex native subagents')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('expected context demand')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('whether `ask_peer` is enough')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('whether `attention_needed` is required')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('worker-forced-disabled non-orchestrators by default')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('passes down inherited quality principles such as think-harder and verification-before-completion')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('Claude workers receive `send_worker_raw_command` with `/effort ultracode` before `send_worker_task`')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('Runtime-specific wrapper is applied before the Worker Task brief')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('Synthesis-related work is dispatched to a dedicated Worker Room')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('requires synthesis and verification of internal subagent outputs before final Worker Report')
  expect(readFileSync('docs/checklists/worker-dispatch.md', 'utf8')).toContain('Human or Guiding Principal presence in the worker room is optional inspection only')
  expect(readFileSync('docs/checklists/guiding-principal-recall.md', 'utf8')).toContain('not being used as a routine approval gate')
  expect(readFileSync('docs/checklists/guiding-principal-recall.md', 'utf8')).toContain('bun run orchestration:inbox')
  expect(readFileSync('docs/checklists/integration.md', 'utf8')).toContain('Archive is requested only after consumption')
  expect(readFileSync('docs/checklists/recovery.md', 'utf8')).toContain('Duplicate Orchestrators')
})

test('orchestration inbox script captures attributed intake and Guiding Principal supplements', () => {
  const script = readFileSync('scripts/orchestration-inbox.ts', 'utf8')
  expect(script).toContain("'conflicts'")

  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-'))
  const bodyPath = join(tempRoot, 'body.md')
  writeFileSync(bodyPath, 'Human context about reader-facing framing.\n')

  const intakePath = execFileSync('bun', [
    'scripts/orchestration-inbox.ts',
    'demo',
    '--kind',
    'intake',
    '--from',
    'Guiding Principal',
    '--source-ref',
    'chatgpt://thread/1',
    '--root',
    tempRoot,
    '--body-file',
    bodyPath,
  ], { encoding: 'utf8' }).trim()

  expect(intakePath).toBe(join(tempRoot, 'demo', 'intake.md'))
  expect(readFileSync(intakePath, 'utf8')).toContain('Captured By: Guiding Principal')
  expect(readFileSync(intakePath, 'utf8')).toContain('Source Reference: chatgpt://thread/1')

  const inboxPath = execFileSync('bun', [
    'scripts/orchestration-inbox.ts',
    'demo',
    '--kind',
    'inbox',
    '--from',
    'Guiding Principal',
    '--source-ref',
    'chatgpt://thread/2',
    '--title',
    'Reader framing',
    '--at',
    '2026-06-11T00:00:00.000Z',
    '--root',
    tempRoot,
    '--body-file',
    bodyPath,
  ], { encoding: 'utf8' }).trim()

  expect(inboxPath).toBe(join(tempRoot, 'demo', 'inbox', '2026-06-11-001-reader-framing.md'))
  const inbox = readFileSync(inboxPath, 'utf8')
  expect(inbox).toContain('From: Guiding Principal')
  expect(inbox).toContain('Status: unread')
  expect(inbox).toContain('Source Reference: chatgpt://thread/2')
})

test('new orchestration script creates the portable harness and durable repo structure from templates', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-new-'))
  const bodyPath = join(tempRoot, 'body.md')
  writeFileSync(bodyPath, 'Initial product intent.\n')

  execFileSync('bun', [
    'scripts/new-orchestration.ts',
    'demo',
    '--from',
    'human',
    '--source-ref',
    'slack:C123/456',
    '--title',
    'bootstrap-stage',
    '--coordination-branch',
    'coordination/demo',
    '--remote',
    'git@example.com:repo.git',
    '--branch-policy',
    'coordination branch required',
    '--push-policy',
    'push with verified token',
    '--target-base',
    'main',
    '--orchestrator-session',
    'session-123',
    '--root',
    tempRoot,
    '--body-file',
    bodyPath,
  ], { encoding: 'utf8' })

  for (const entry of ['AGENTS.md', 'state-machine.md', '_templates/worker-report.md', '_templates/repo-policy.md']) {
    expect(existsSync(join(tempRoot, entry))).toBe(true)
  }
  for (const entry of ['intake.md', 'stage.md', 'workers.md', 'state.md', 'inbox', 'recall', 'decisions', 'reports', 'source-material', 'decisions/repo-policy.md']) {
    expect(existsSync(join(tempRoot, 'demo', entry))).toBe(true)
  }
  expect(readFileSync(join(tempRoot, 'AGENTS.md'), 'utf8')).toContain('Minimal Effective Path')
  expect(readFileSync(join(tempRoot, 'demo', 'intake.md'), 'utf8')).toContain('Initial product intent.')
  expect(readFileSync(join(tempRoot, 'demo', 'intake.md'), 'utf8')).toContain('Source Reference: slack:C123/456')
  expect(readFileSync(join(tempRoot, 'demo', 'state.md'), 'utf8')).toContain('Coordination Branch: `coordination/demo`')
  expect(readFileSync(join(tempRoot, 'demo', 'state.md'), 'utf8')).toContain('Active Orchestrator Session: `session-123`')
  expect(readFileSync(join(tempRoot, 'demo', 'state.md'), 'utf8')).toContain('Remote: `git@example.com:repo.git`')
  expect(readFileSync(join(tempRoot, 'demo', 'decisions', 'repo-policy.md'), 'utf8')).toContain('Push Transport / Account: push with verified token')
  expect(execFileSync('bun', ['scripts/validate-orchestration.ts', '--root', tempRoot], { encoding: 'utf8' })).toContain('orchestration validation passed')
  expect(() => execFileSync('bun', ['scripts/validate-orchestration.ts', '--root', tempRoot, '--ready'], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
})

test('orchestration ready validation accepts concrete worker rows without template placeholders', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-ready-'))
  const bodyPath = join(tempRoot, 'body.md')
  writeFileSync(bodyPath, 'Initial product intent.\n')
  execFileSync('bun', [
    'scripts/new-orchestration.ts',
    'demo',
    '--from',
    'human',
    '--source-ref',
    'slack:C123/456',
    '--title',
    'bootstrap-stage',
    '--coordination-branch',
    'coordination/demo',
    '--target-base',
    'main',
    '--remote',
    'local',
    '--branch-policy',
    'coordination branch required',
    '--push-policy',
    'no push during test',
    '--orchestrator-session',
    'session-123',
    '--root',
    tempRoot,
    '--body-file',
    bodyPath,
  ], { encoding: 'utf8' })
  writeFileSync(join(tempRoot, 'demo', 'stage.md'), `# Stage Contract: bootstrap-stage

## Objective

Prepare a durable orchestration bootstrap.

## Inputs

- \`CONTEXT.md\`

## Non-Goals

- No production code changes.

## Worker Plan

- \`context-audit-001\`: review context and write a report.

## Acceptance Evidence

- \`bun scripts/validate-orchestration.ts --root docs/orchestration --ready\` passes.

## Audit Requirement

Independent audit required before Stage 1.

## Human / Review Gates

- Human confirms live CCM room authority.
`)
  writeFileSync(join(tempRoot, 'demo', 'workers.md'), `# Worker State Index

| Worker Task ID | desired_room_name | Runtime | State | Branch/Worktree | Room ID | Capture ID | Output Consumed | Archive State | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| \`context-audit-001\` | \`ccm-demo-context-audit\` | \`codex\` | \`planned\` | \`/repo\` |  |  | \`no\` | \`not_requested\` | Wait for Orchestrator dispatch. |

## State Vocabulary

\`planned\` -> \`room_intent_recorded\` -> \`room_init_started\` -> \`room_ready\` -> \`task_sent\` -> \`attention_needed\` -> \`reported\` -> \`captured\` -> \`consumed\` -> \`archive_requested\` -> \`archived\`

Terminal alternatives: \`rejected\`, \`abandoned\`, \`failed\`, \`unsupported_capability\`, \`cleanup_failed\`.
`)
  writeFileSync(join(tempRoot, 'demo', 'intake.md'), readFileSync(join(tempRoot, 'demo', 'intake.md'), 'utf8')
    .replace('- <repo policy, platform limit, deadline, non-goal>', '- Do not change production code during bootstrap.')
    .replace('- <open clarification or none>', '- None.'))
  writeFileSync(join(tempRoot, 'demo', 'state.md'), readFileSync(join(tempRoot, 'demo', 'state.md'), 'utf8')
    .replace('- Next Action: `<single next action>`', '- Next Action: Orchestrator dispatches `context-audit-001`.')
    .replace('- Blockers: `<none or exact blocker>`', '- Blockers: none'))
  expect(execFileSync('bun', ['scripts/validate-orchestration.ts', '--root', tempRoot, '--ready'], { encoding: 'utf8' })).toContain('orchestration validation passed')
})

test('new orchestration script reuses matching root harness files for later initiatives', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-reuse-'))
  for (const initiativeId of ['first', 'second']) {
    execFileSync('bun', [
      'scripts/new-orchestration.ts',
      initiativeId,
      '--from',
      'human',
      '--source-ref',
      'slack:C123/456',
      '--coordination-branch',
      'coordination/demo',
      '--root',
      tempRoot,
    ], { encoding: 'utf8' })
  }
  expect(existsSync(join(tempRoot, 'first', 'intake.md'))).toBe(true)
  expect(existsSync(join(tempRoot, 'second', 'intake.md'))).toBe(true)
})

test('orchestration validation honors the root option', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-validate-root-'))
  expect(() => execFileSync('bun', [
    'scripts/validate-orchestration.ts',
    '--root',
    tempRoot,
  ], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
})

test('new orchestration script requires explicit coordination branch', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-branch-'))
  expect(() => execFileSync('bun', [
    'scripts/new-orchestration.ts',
    'demo',
    '--from',
    'human',
    '--source-ref',
    'slack:C123/456',
    '--root',
    tempRoot,
  ], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
})

test('adopt orchestration script validates existing initiatives without overwriting files', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ccm-orchestration-adopt-'))
  execFileSync('bun', [
    'scripts/new-orchestration.ts',
    'demo',
    '--from',
    'human',
    '--source-ref',
    'slack:C123/456',
    '--coordination-branch',
    'coordination/demo',
    '--root',
    tempRoot,
  ], { encoding: 'utf8' })
  const intakePath = join(tempRoot, 'demo', 'intake.md')
  const before = readFileSync(intakePath, 'utf8')
  const output = execFileSync('bun', [
    'scripts/adopt-orchestration.ts',
    'demo',
    '--root',
    tempRoot,
  ], { encoding: 'utf8' })
  expect(output).toContain('adopted')
  expect(readFileSync(intakePath, 'utf8')).toBe(before)

  rmSync(join(tempRoot, 'demo', 'conflicts'), { recursive: true, force: true })
  expect(() => execFileSync('bun', [
    'scripts/adopt-orchestration.ts',
    'demo',
    '--root',
    tempRoot,
  ], { encoding: 'utf8', stdio: 'pipe' })).toThrow()

  const repairOutput = execFileSync('bun', [
    'scripts/adopt-orchestration.ts',
    'demo',
    '--root',
    tempRoot,
    '--repair',
  ], { encoding: 'utf8' })
  expect(repairOutput).toContain('created directories: conflicts')
  expect(existsSync(join(tempRoot, 'demo', 'conflicts'))).toBe(true)
  expect(execFileSync('bun', ['scripts/validate-orchestration.ts', '--root', tempRoot], { encoding: 'utf8' })).toContain('orchestration validation passed')
})

test('orchestration validation is wired into package validation', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.scripts['orchestration:new']).toBe('bun scripts/new-orchestration.ts')
  expect(pkg.scripts['orchestration:adopt']).toBe('bun scripts/adopt-orchestration.ts')
  expect(pkg.scripts['orchestration:inbox']).toBe('bun scripts/orchestration-inbox.ts')
  expect(pkg.scripts['validate:orchestration']).toBe('bun scripts/validate-orchestration.ts')
  expect(pkg.scripts.validate).toContain('bun run validate:orchestration')
  expect(readFileSync('docs/plans/2026-06-11-orchestration-harness-hardening.md', 'utf8')).toContain('Cross-Runtime Mechanisms Beyond AGENTS.md And Skills')
})
