// Every number a person reads comes from the shared formatter, so this app and
// the explorer round, group and truncate identically. What is this app's is the
// currency: a price here is always a price in something.

import * as base from '@zvm/web/format'
import {endpoint} from './endpoint'
import {orderCountdown, type OrderTime} from './order-time'

export {ago, amount, compact, number, percent, plain, short, units, usd, timestamp} from '@zvm/web/format'

export const ZERO = '0x0000000000000000000000000000000000000000'

export const isZero = (a: string | null | undefined) => !a || /^0x0{40}$/i.test(a)

export const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export interface Currency {
  symbol: string
  decimals: number
  /** The key /api/prices uses: 'znn' for the native coin, the address otherwise. */
  key: string
}

/**
 * What a price is denominated in. ZNN is the zero address. Bids are paid in
 * wrapped ZNN, which is the same asset, so it reads as ZNN. Listings may also
 * be priced in wrapped QSR, a predeploy with 8 decimals.
 */
export function currencyOf(address: string | null | undefined): Currency {
  const apps = endpoint.info?.apps
  if (isZero(address) || same(address, apps?.wrappedZnn)) return {symbol: 'ZNN', decimals: 18, key: 'znn'}
  if (same(address, apps?.rewardToken)) return {symbol: 'QSR', decimals: 8, key: address!.toLowerCase()}
  return {symbol: 'TOKEN', decimals: 18, key: (address ?? '').toLowerCase()}
}

/** A price from its base units and currency, at a precision a person can read. */
export function priceOf(raw: string | bigint | null | undefined, currency?: string | null, maxFrac = 4): string {
  if (raw === null || raw === undefined || raw === '') return '-'
  return base.units(raw, currencyOf(currency).decimals, maxFrac, '-')
}

/** A whole-unit float, as the node's aggregates (floor, volume) carry them. */
export function whole(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '-'
  if (v === 0) return '0'
  if (v >= 1000) return base.compact(v)
  return base.price(v, '-')
}

/** Seconds to a short countdown: 3d 4h, 5h 12m, 42s. */
export function until(ts: OrderTime | null | undefined): string {
  return orderCountdown(ts)
}
