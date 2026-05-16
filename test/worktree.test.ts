import { test, expect } from 'bun:test'
import { safeWorktreeSlug } from '../worktree.ts'

test('safeWorktreeSlug preserves git-safe slug characters', () => {
  expect(safeWorktreeSlug('abc-DEF_123.foo')).toBe('abc-DEF_123.foo')
})

test('safeWorktreeSlug normalizes unsafe path and branch characters', () => {
  expect(safeWorktreeSlug(' hello/world:with spaces 🚀 ')).toBe('hello-world-with-spaces')
  expect(safeWorktreeSlug('---a---b---')).toBe('a-b')
  expect(safeWorktreeSlug('🔥🔥')).toBe('session')
})

test('safeWorktreeSlug caps length for readable branch and path names', () => {
  expect(safeWorktreeSlug('a'.repeat(200))).toHaveLength(80)
})
