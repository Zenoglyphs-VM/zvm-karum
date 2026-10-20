// The cart: listings picked from anywhere on the site, bought in one
// transaction.
//
// One transaction is not a convenience here, it is the chain's shape: every
// transaction waits for a momentum, so ten separate purchases would be ten
// round trips through NoM where one buyMany is one. The exchange skips any
// input it can no longer fill and refunds its price, so a cart holding an item
// someone else bought a moment ago still goes through for the rest.
//
// Kept per chain, in this browser only: an order hash means nothing on another
// chain, and a cart is not worth a server.

import {computed, reactive, watch} from 'vue'
import type {Address} from 'viem'
import {endpoint} from './endpoint'
import {currencyOf, isZero} from './format'

export interface CartItem {
  /** The listing's order hash, which is what a fill needs. */
  hash: string
  collection: string
  collectionName: string
  tokenId: string
  name: string
  image: string
  /** Base units of `currency`. */
  price: string
  currency: string
}

const KEY = 'karum.cart'
const MAX = 50

type Store = Record<string, CartItem[]>

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

const state = reactive<{all: Store; open: boolean}>({all: read(), open: false})

const chainKey = () => String(endpoint.chainId ?? 'none')

export const cart = reactive({
  get items(): CartItem[] {
    return state.all[chainKey()] ?? []
  },
  get open() {
    return state.open
  },
  set open(v: boolean) {
    state.open = v
  },
})

watch(
  () => state.all,
  (all) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      /* storage can be blocked; the cart still holds for this tab */
    }
  },
  {deep: true},
)

function set(items: CartItem[]) {
  state.all = {...state.all, [chainKey()]: items}
}

export const inCart = (hash: string | null | undefined) => !!hash && cart.items.some((i) => i.hash === hash)

export function addToCart(item: CartItem): boolean {
  if (inCart(item.hash)) return false
  if (cart.items.length >= MAX) return false
  // One listing per token: two orders for one item cannot both fill.
  set([...cart.items.filter((i) => !(i.collection.toLowerCase() === item.collection.toLowerCase() && i.tokenId === item.tokenId)), item])
  return true
}

export function removeFromCart(hash: string) {
  set(cart.items.filter((i) => i.hash !== hash))
}

export function toggleCart(item: CartItem): boolean {
  if (inCart(item.hash)) {
    removeFromCart(item.hash)
    return false
  }
  return addToCart(item)
}

export function clearCart() {
  set([])
}

/** What the cart costs, per currency, in base units. */
export const cartTotals = computed(() => {
  const out = new Map<string, {symbol: string; decimals: number; key: string; currency: Address; total: bigint}>()
  for (const i of cart.items) {
    const c = currencyOf(i.currency)
    const k = isZero(i.currency) ? 'znn' : i.currency.toLowerCase()
    const row = out.get(k) ?? {...c, currency: i.currency as Address, total: 0n}
    row.total += BigInt(i.price)
    out.set(k, row)
  }
  return [...out.values()]
})

export const cartCount = computed(() => cart.items.length)
