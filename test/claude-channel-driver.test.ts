import { test, expect } from 'bun:test'
import { ClaudeChannelAgentDriver } from '../agents/claude/channel-driver.ts'

test('start/resume forward the room channel key to spawn, so a first-ever spawn (no uuid binding yet) can still resolve its model pin', async () => {
  const spawnCalls: Array<{ sessionId: string; cwd: string; resumeMode: boolean; channelKey?: string }> = []
  const driver = new ClaudeChannelAgentDriver({
    spawn: async (sessionId, cwd, resumeMode, channelKey) => {
      spawnCalls.push({ sessionId, cwd, resumeMode, channelKey })
      return true
    },
    sendInbound: () => true,
  })

  await driver.start({ sessionId: 'uuid-1', cwd: '/repo', channelKey: 'slack:C1' })
  await driver.resume({ sessionId: 'uuid-2', cwd: '/repo', channelKey: 'slack:C2' })

  expect(spawnCalls).toEqual([
    { sessionId: 'uuid-1', cwd: '/repo', resumeMode: false, channelKey: 'slack:C1' },
    { sessionId: 'uuid-2', cwd: '/repo', resumeMode: true, channelKey: 'slack:C2' },
  ])
})

test('start/resume pass undefined through when no channel key is known, matching pre-existing callers', async () => {
  const spawnCalls: Array<string | undefined> = []
  const driver = new ClaudeChannelAgentDriver({
    spawn: async (_sessionId, _cwd, _resumeMode, channelKey) => {
      spawnCalls.push(channelKey)
      return true
    },
    sendInbound: () => true,
  })

  await driver.start({ sessionId: 'uuid-3', cwd: '/repo' })
  expect(spawnCalls).toEqual([undefined])
})

test('a failed spawn still throws regardless of channel key', async () => {
  const driver = new ClaudeChannelAgentDriver({
    spawn: async () => false,
    sendInbound: () => true,
  })

  await expect(driver.start({ sessionId: 'uuid-4', cwd: '/repo', channelKey: 'slack:C1' })).rejects.toThrow('failed to start Claude Code session')
})
