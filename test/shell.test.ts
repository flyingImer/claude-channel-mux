import { test, expect } from 'bun:test'
import { commandLine, commandPrefix, forwardedEnvExports, shellArg, shellWords, validEnvName } from '../shell.ts'

test('validEnvName accepts only shell-safe environment variable names', () => {
  expect(validEnvName('OPENAI_API_KEY')).toBe(true)
  expect(validEnvName('_TOKEN1')).toBe(true)
  expect(validEnvName('1TOKEN')).toBe(false)
  expect(validEnvName('BAD-NAME')).toBe(false)
  expect(validEnvName('BAD NAME')).toBe(false)
  expect(validEnvName('BAD=$(echo pwn)')).toBe(false)
})

test('shellArg safely single-quotes shell values', () => {
  expect(shellArg('simple')).toBe("'simple'")
  expect(shellArg("a'b")).toBe("'a'\\''b'")
  expect(shellArg('')).toBe("''")
})

test('command helpers support wrapper prefixes', () => {
  expect(shellWords('env CODEX_PROFILE=prod codex')).toEqual(['env', 'CODEX_PROFILE=prod', 'codex'])
  expect(shellWords('"/opt/Codex CLI/codex" --profile prod')).toEqual(['/opt/Codex CLI/codex', '--profile', 'prod'])
  expect(commandPrefix('', 'codex')).toEqual(['codex'])
  expect(commandLine(['env', 'CODEX_PROFILE=prod', 'codex'], ['app-server', '--listen', 'stdio://'])).toBe("'env' 'CODEX_PROFILE=prod' 'codex' 'app-server' '--listen' 'stdio://'")
})

test('forwardedEnvExports keeps empty values and reports invalid names', () => {
  const invalid: string[] = []
  const env = { OPENAI_API_KEY: 'sk-test', EMPTY: '', QUOTED: "a'b" }
  const result = forwardedEnvExports([' OPENAI_API_KEY ', 'BAD-NAME', 'EMPTY', 'MISSING', 'QUOTED'], env, name => invalid.push(name))

  expect(result).toBe("OPENAI_API_KEY='sk-test' EMPTY='' QUOTED='a'\\''b'")
  expect(invalid).toEqual(['BAD-NAME'])
})
