// Which collections the home page features, decided the same way in every
// copy of Karum.
//
// Five slots: the three collections with the most ZNN volume in the last 48
// hours, then two new collections drawn at random from the newest that are
// not already featured. With fewer than three that traded, the rest of the
// top three are filled by all-time volume and then size, so there are always
// at least three.
//
// "The same in every copy" rests on three choices, each of which alone would
// let two browsers disagree:
//
//   - The window ends on the last whole UTC hour, not on this browser's clock.
//     Two people a minute apart otherwise count a sale at the window's edge
//     differently.
//   - The random draw is seeded by the UTC date, so every copy draws the same
//     two, and the draw changes once a day rather than on every load.
//   - Every ordering ends in the collection's address, so a tie in volume
//     never falls back to whatever order the API happened to return.
//
// The input is the chain's own sales as a node indexes them, which every node
// on the same chain agrees on. The node answers 24-hour and all-time volume
// but not 48 hours, so the 48 hours is summed here from the sales feed, which
// returns at most the newest 200 sales. On a chain busier than that in two
// days, the oldest sales in the window are not seen and the ranking is by the
// newest 200.

import type {Collection, Sale} from './api'
import {isZero} from './format'

export const WINDOW_HOURS = 48
export const TOP = 3
export const NEW = 2
/** How far back "new" looks: the newest this many, before the draw. */
export const NEW_POOL = 8

export interface Featured {
  collection: Collection
  reason: 'volume' | 'new' | 'fill'
  /** Whole ZNN traded in the window. */
  volume48h: number
}

/** The last whole UTC hour, in unix seconds: the end of the window. */
export function windowEnd(nowMs = Date.now()): number {
  return Math.floor(nowMs / 3_600_000) * 3600
}

/** A seed shared by every copy for the whole of a UTC day. */
function daySeed(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/** A small seeded generator (FNV-1a into xorshift), deterministic everywhere. */
function seeded(seed: string) {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return (h >>> 0) / 4294967296
  }
}

const byAddress = (a: Collection, b: Collection) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())

export function pickFeatured(collections: Collection[], sales: Sale[], nowMs = Date.now()): Featured[] {
  const end = windowEnd(nowMs)
  const start = end - WINDOW_HOURS * 3600

  // Volume per collection over the window: ZNN sales only, which is what
  // every other volume on the site counts too.
  const volume = new Map<string, number>()
  for (const s of sales) {
    if (s.timestamp < start || s.timestamp >= end || !isZero(s.currency)) continue
    const k = s.collection.toLowerCase()
    volume.set(k, (volume.get(k) ?? 0) + s.priceNum)
  }
  const vol = (c: Collection) => volume.get(c.address.toLowerCase()) ?? 0

  // Only collections with something in them can be shown.
  const candidates = collections.filter((c) => c.items > 0)

  const traded = candidates
    .filter((c) => vol(c) > 0)
    .sort((a, b) => vol(b) - vol(a) || byAddress(a, b))

  const out: Featured[] = traded.slice(0, TOP).map((c) => ({collection: c, reason: 'volume', volume48h: vol(c)}))

  // Always three: fill from all-time volume, then size.
  if (out.length < TOP) {
    const taken = new Set(out.map((f) => f.collection.address.toLowerCase()))
    const rest = candidates
      .filter((c) => !taken.has(c.address.toLowerCase()))
      .sort((a, b) => b.volume - a.volume || b.items - a.items || byAddress(a, b))
    for (const c of rest.slice(0, TOP - out.length)) out.push({collection: c, reason: 'fill', volume48h: vol(c)})
  }

  // Two new ones, drawn from the newest not already featured.
  const taken = new Set(out.map((f) => f.collection.address.toLowerCase()))
  const pool = candidates
    .filter((c) => !taken.has(c.address.toLowerCase()))
    .sort((a, b) => b.firstBlock - a.firstBlock || byAddress(a, b))
    .slice(0, NEW_POOL)
  const rand = seeded(`${daySeed(nowMs)}:${pool.map((c) => c.address.toLowerCase()).join(',')}`)
  // Fisher-Yates with the shared generator, so every copy shuffles alike.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  for (const c of pool.slice(0, NEW)) out.push({collection: c, reason: 'new', volume48h: vol(c)})

  return out
}
