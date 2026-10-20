// Trait counts and rarity, computed in the browser from the items loaded.
//
// Rarity here is the statistical kind OpenSea adopted from OpenRarity: an
// item's score is the sum over its traits of -log2(share of the collection
// that has that value), so a trait one item in a hundred carries is worth far
// more than one half of them carry. A missing trait counts as its own value
// ("none"), otherwise an item with fewer traits would always rank as common.
//
// It is only as good as the sample. The node pages items two hundred at a time
// and a large collection is not loaded whole, so the page says when a rank was
// computed over part of a collection rather than all of it.

import type {Item} from './api'

export interface TraitValue {
  value: string
  count: number
  share: number
}

export interface TraitType {
  type: string
  values: TraitValue[]
}

export interface Rarity {
  traits: TraitType[]
  /** collection-wide rank, 1 = rarest, keyed by token id */
  rank: Map<string, number>
  score: Map<string, number>
  /** How many items the figures were computed over. */
  sample: number
}

const NONE = 'none'

const valueOf = (v: unknown) => (v === null || v === undefined || v === '' ? NONE : String(v))

export function traitsOf(item: Pick<Item, 'meta'>): {type: string; value: string}[] {
  return (item.meta?.attributes ?? [])
    .filter((a) => a && a.trait_type && a.display_type !== 'number')
    .map((a) => ({type: String(a.trait_type), value: valueOf(a.value)}))
}

export function computeRarity(items: Item[]): Rarity {
  const counts = new Map<string, Map<string, number>>()
  for (const it of items) {
    for (const t of traitsOf(it)) {
      const m = counts.get(t.type) ?? new Map<string, number>()
      m.set(t.value, (m.get(t.value) ?? 0) + 1)
      counts.set(t.type, m)
    }
  }
  const n = items.length || 1
  // Items without a trait type carry "none" for it.
  for (const [, m] of counts) {
    const have = [...m.values()].reduce((a, b) => a + b, 0)
    if (have < items.length) m.set(NONE, (m.get(NONE) ?? 0) + items.length - have)
  }

  const traits: TraitType[] = [...counts.entries()]
    .map(([type, m]) => ({
      type,
      values: [...m.entries()].map(([value, count]) => ({value, count, share: count / n})).sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => a.type.localeCompare(b.type))

  const score = new Map<string, number>()
  for (const it of items) {
    const own = new Map(traitsOf(it).map((t) => [t.type, t.value]))
    let s = 0
    for (const [type, m] of counts) {
      const v = own.get(type) ?? NONE
      s += -Math.log2((m.get(v) ?? 1) / n)
    }
    score.set(it.tokenId, s)
  }
  const ordered = [...score.entries()].sort((a, b) => b[1] - a[1])
  const rank = new Map<string, number>()
  ordered.forEach(([id], i) => rank.set(id, i + 1))
  return {traits, rank, score, sample: items.length}
}

/** Top 1%, 10%, 25%, or common: the tiers a card shows. */
export function tier(rank: number | undefined, total: number): {label: string; tone: 'new' | 'l1' | 'l2' | 'plain'} | null {
  if (!rank || total < 8) return null
  const p = rank / total
  if (p <= 0.01) return {label: 'Top 1%', tone: 'new'}
  if (p <= 0.1) return {label: 'Top 10%', tone: 'l1'}
  if (p <= 0.25) return {label: 'Top 25%', tone: 'l2'}
  return null
}
