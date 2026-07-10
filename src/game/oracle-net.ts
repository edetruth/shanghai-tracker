/**
 * The Oracle — in-browser inference for the PIMC-distilled neural network
 * (ml/pimc/models/network_v7.pt, exported by ml/pimc/export_oracle.py).
 *
 * Hand-rolled forward pass over a 3-block LayerNorm MLP (~191K params):
 *   170 -> [Linear 256, LayerNorm, ReLU] x3 -> discard head (53) + draw head (1)
 *
 * The network decides ONLY two things (matching the evaluated configuration):
 *   - take the top discard vs draw from the pile
 *   - which card to discard
 * Everything else (buying, meld timing, lay-offs, joker swaps) stays with the
 * regular AI heuristics.
 *
 * State encoding replicates ml/pimc/collect_data.py build_state_vec plus the
 * NetworkHook quirks it was trained AND evaluated with:
 *   - seen-card slots [53:106] are always zero
 *   - opponent hand sizes are a flat CARDS_DEALT[round] estimate, not live counts
 * Do not "improve" these: the network expects this exact distribution.
 */

import type { Card } from './types'
import { CARDS_DEALT } from './rules'

const STATE_DIM = 170
const N_TYPES = 53      // 52 rank/suit combos + joker
const JOKER_TYPE = 52
const LN_EPS = 1e-5

interface Tensor {
  shape: number[]
  data: Float32Array
}

export interface OracleModel {
  tensors: Record<string, Tensor>
}

interface RawTensor { shape: number[]; data: string }
interface RawWeights {
  format: string
  stateDim: number
  tensors: Record<string, RawTensor>
}

// ── Weight loading ───────────────────────────────────────────────────────────

function b64ToF32(b64: string): Float32Array {
  let bytes: Uint8Array
  if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  } else {
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  }
  // Copy into a fresh, aligned buffer before viewing as float32
  const aligned = new Uint8Array(bytes.length)
  aligned.set(bytes)
  return new Float32Array(aligned.buffer)
}

const REQUIRED_TENSORS = [
  'backbone.0.weight', 'backbone.0.bias', 'backbone.1.weight', 'backbone.1.bias',
  'backbone.4.weight', 'backbone.4.bias', 'backbone.5.weight', 'backbone.5.bias',
  'backbone.8.weight', 'backbone.8.bias', 'backbone.9.weight', 'backbone.9.bias',
  'discard_head.weight', 'discard_head.bias', 'draw_head.weight', 'draw_head.bias',
]

export function parseOracleModel(rawData: unknown): OracleModel {
  const raw = rawData as RawWeights
  if (raw.format !== 'pimcnet-v1') {
    throw new Error(`Unsupported oracle weights format: ${raw.format}`)
  }
  const tensors: Record<string, Tensor> = {}
  for (const name of REQUIRED_TENSORS) {
    const t = raw.tensors[name]
    if (!t) throw new Error(`Oracle weights missing tensor: ${name}`)
    tensors[name] = { shape: t.shape, data: b64ToF32(t.data) }
  }
  return { tensors }
}

// ── Math primitives ──────────────────────────────────────────────────────────

/** y = W x + b, with W row-major (outDim x inDim). */
function linear(w: Tensor, b: Tensor, x: Float32Array): Float32Array {
  const [outDim, inDim] = w.shape
  const y = new Float32Array(outDim)
  const wd = w.data
  for (let o = 0; o < outDim; o++) {
    let sum = b.data[o]
    const row = o * inDim
    for (let i = 0; i < inDim; i++) sum += wd[row + i] * x[i]
    y[o] = sum
  }
  return y
}

/** In-place LayerNorm with affine params (PyTorch semantics, eps 1e-5). */
function layerNormRelu(gamma: Tensor, beta: Tensor, x: Float32Array): void {
  const n = x.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += x[i]
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean
    variance += d * d
  }
  variance /= n
  const inv = 1 / Math.sqrt(variance + LN_EPS)
  for (let i = 0; i < n; i++) {
    const v = (x[i] - mean) * inv * gamma.data[i] + beta.data[i]
    x[i] = v > 0 ? v : 0 // fused ReLU (dropout is identity at inference)
  }
}

export interface OracleOutput {
  discardLogits: Float32Array // 53 card-type logits
  drawLogit: number           // > 0 means take the discard
}

export function forwardOracle(model: OracleModel, state: Float32Array): OracleOutput {
  const t = model.tensors
  let h = linear(t['backbone.0.weight'], t['backbone.0.bias'], state)
  layerNormRelu(t['backbone.1.weight'], t['backbone.1.bias'], h)
  h = linear(t['backbone.4.weight'], t['backbone.4.bias'], h)
  layerNormRelu(t['backbone.5.weight'], t['backbone.5.bias'], h)
  h = linear(t['backbone.8.weight'], t['backbone.8.bias'], h)
  layerNormRelu(t['backbone.9.weight'], t['backbone.9.bias'], h)
  const discardLogits = linear(t['discard_head.weight'], t['discard_head.bias'], h)
  const drawLogit = linear(t['draw_head.weight'], t['draw_head.bias'], h)[0]
  return { discardLogits, drawLogit }
}

// ── State encoding ───────────────────────────────────────────────────────────

const SUIT_INDEX: Record<string, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }

/** Compact card-type index 0-52: suit*13 + (rank-1) for naturals, 52 for jokers. */
export function oracleCardType(card: Card): number {
  if (card.suit === 'joker') return JOKER_TYPE
  return SUIT_INDEX[card.suit] * 13 + (card.rank - 1)
}

/**
 * Build the 170-dim state vector for one decision.
 *
 * @param discardTop  the top discard for DRAW decisions, null for DISCARD decisions
 * @param roundIdx    0-based round index (0-6)
 * @param opponentCount  number of opponents (fills up to 3 flat hand-size slots)
 */
export function buildOracleState(
  hand: Card[],
  discardTop: Card | null,
  roundIdx: number,
  hasLaidDown: boolean,
  opponentCount: number,
): Float32Array {
  const v = new Float32Array(STATE_DIM)
  for (const c of hand) v[oracleCardType(c)] += 1
  // [53:106] seen counts stay zero (training distribution — see header)
  if (discardTop) v[106 + oracleCardType(discardTop)] = 1
  v[159 + Math.min(roundIdx, 6)] = 1
  v[166] = hasLaidDown ? 1 : 0
  const flatSize = CARDS_DEALT[Math.min(roundIdx, 6)] / 12
  const slots = Math.min(opponentCount, 3)
  for (let i = 0; i < slots; i++) v[167 + i] = flatSize
  return v
}

// ── Decisions ────────────────────────────────────────────────────────────────

/** Should The Oracle take the top discard as its draw? */
export function oracleShouldTakeDiscard(
  model: OracleModel,
  hand: Card[],
  discardTop: Card,
  roundIdx: number,
  hasLaidDown: boolean,
  opponentCount: number,
): boolean {
  const state = buildOracleState(hand, discardTop, roundIdx, hasLaidDown, opponentCount)
  return forwardOracle(model, state).drawLogit > 0
}

/**
 * Choose The Oracle's discard: argmax over card types present in hand,
 * jokers always masked out (mirrors PIMCNet.predict_discard).
 * Returns null when no legal choice exists (all-joker hand) — caller falls
 * back to the heuristic.
 */
export function oracleChooseDiscard(
  model: OracleModel,
  hand: Card[],
  roundIdx: number,
  hasLaidDown: boolean,
  opponentCount: number,
): Card | null {
  const state = buildOracleState(hand, null, roundIdx, hasLaidDown, opponentCount)
  const { discardLogits } = forwardOracle(model, state)

  let bestType = -1
  let bestLogit = -Infinity
  for (let type = 0; type < N_TYPES; type++) {
    if (type === JOKER_TYPE) continue
    if (state[type] <= 0) continue // not in hand
    if (discardLogits[type] > bestLogit) {
      bestLogit = discardLogits[type]
      bestType = type
    }
  }
  if (bestType < 0) return null
  return hand.find(c => oracleCardType(c) === bestType) ?? null
}
