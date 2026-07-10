/**
 * Lazy loader for The Oracle's weights (src/game/oracle-weights.json, ~1 MB).
 * The JSON is code-split by Vite and only fetched the first time a game with
 * The Oracle starts. Subsequent calls reuse the parsed model.
 */

import { parseOracleModel, type OracleModel } from './oracle-net'

let modelPromise: Promise<OracleModel> | null = null

export function loadOracleModel(): Promise<OracleModel> {
  if (!modelPromise) {
    modelPromise = import('./oracle-weights.json')
      .then(mod => parseOracleModel((mod as { default?: unknown }).default ?? mod))
      .catch(err => {
        modelPromise = null // allow retry on transient failure
        throw err
      })
  }
  return modelPromise
}

/** Synchronous access for callers that know the model is already loaded. */
let loadedModel: OracleModel | null = null
export function getLoadedOracleModel(): OracleModel | null {
  return loadedModel
}
export async function ensureOracleModel(): Promise<OracleModel> {
  const m = await loadOracleModel()
  loadedModel = m
  return m
}
