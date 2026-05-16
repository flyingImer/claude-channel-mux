import { CodexAppServerClient, jsonObject } from '../agents/codex/app-server-client.ts'

const events: string[] = []
const client = new CodexAppServerClient({
  codexBin: process.env.CODEX_BIN ?? 'codex',
  cwd: process.cwd(),
  env: process.env,
  stderr: line => { if (/error|warn/i.test(line)) process.stderr.write(line + '\n') },
  notification: msg => { if (typeof msg.method === 'string') events.push(msg.method) },
  serverRequest: msg => events.push(String(msg.method)),
})

try {
  await client.start()
  const thread = await client.request('thread/start', {
    cwd: process.cwd(),
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
  }, 60_000)
  const threadResult = jsonObject(thread.result)
  const threadObject = jsonObject(threadResult?.thread)
  const threadId = typeof threadObject?.id === 'string' ? threadObject.id : ''
  if (!threadId) throw new Error('missing thread id')

  await client.request('turn/start', {
    threadId,
    input: [{
      type: 'text',
      text: 'Make a concise two-step plan for checking a build, then stop. Do not run commands.',
      text_elements: [],
    }],
    cwd: process.cwd(),
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [process.cwd()],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  }, 120_000).catch(() => undefined)

  await new Promise(resolve => setTimeout(resolve, Number(process.env.CCM_CODEX_SMOKE_WAIT_MS ?? 12_000)))
  const uniqueEvents = [...new Set(events)]
  const result = { hasPlanUpdated: uniqueEvents.includes('turn/plan/updated'), events: uniqueEvents }
  console.log(JSON.stringify(result, null, 2))
  if (!result.hasPlanUpdated) process.exitCode = 1
} finally {
  await client.stop().catch(() => undefined)
}
