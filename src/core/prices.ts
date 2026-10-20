// Dollars, from the node's /api/prices. The store and the arithmetic are the
// shared module's, so an item is worth the same here as in the explorer.
// Dollars are context and never a price: every order on this market is
// denominated in ZNN or QSR, and a node with -prices=off simply shows none.

import {createPrices} from '@zvm/web/prices'
import {endpoint} from './endpoint'
import {currencyOf} from './format'

const store = createPrices(() => endpoint.apiBase)

export const prices = store.state
export const startPrices = (intervalMs = 30_000) => store.start(intervalMs)
export const refreshPrices = () => store.refresh()

/** What an amount in a currency is worth, or null when it has no price. */
export function usdOf(raw: string | bigint | null | undefined, currency?: string | null): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const c = currencyOf(currency)
  return store.usdValue(raw, c.decimals, c.key)
}

/** The same, for a whole-unit ZNN float such as a floor or a volume. */
export function usdOfZnn(v: number | null | undefined): number | null {
  const unit = store.znnUsd()
  if (unit === null || v === null || v === undefined) return null
  return v * unit
}
