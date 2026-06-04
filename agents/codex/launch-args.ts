import { codexLaunchArgs, codexModelFromEnv } from './config.js'

export { codexLaunchArgs }

export function codexEffectiveModel(modelOverride?: string): string | undefined {
  const model = (modelOverride ?? '').trim()
  return model || undefined
}

export function codexEffectiveModelFromEnv(env: NodeJS.ProcessEnv, modelOverride?: string): string | undefined {
  return codexModelFromEnv(env, modelOverride)
}

export function codexLaunchArgsForModel(input: { model?: string }): string[] {
  return codexLaunchArgs(input.model)
}

export function codexLaunchArgsFromEnv(env: NodeJS.ProcessEnv, modelOverride?: string): string[] {
  return codexLaunchArgs(codexEffectiveModelFromEnv(env, modelOverride))
}
