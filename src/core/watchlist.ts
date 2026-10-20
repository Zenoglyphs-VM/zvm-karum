// Collections and items a person has starred. Local to this browser and to the
// chain, like the cart: a watchlist is a bookmark, not a claim anyone else has
// to see.

import {computed, reactive, watch} from 'vue'
import {endpoint} from './endpoint'

const KEY = 'karum.watch'

interface Watched {
  collections: string[]
  /** collection:tokenId */
  items: string[]
}

type Store = Record<string, Watched>

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

const state = reactive<{all: Store}>({all: read()})

watch(
  () => state.all,
  (all) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      /* storage can be blocked; the stars still hold for this tab */
    }
  },
  {deep: true},
)

const mine = computed<Watched>(() => state.all[String(endpoint.chainId ?? 'none')] ?? {collections: [], items: []})

function put(next: Watched) {
  state.all = {...state.all, [String(endpoint.chainId ?? 'none')]: next}
}

const itemKey = (collection: string, tokenId: string) => `${collection.toLowerCase()}:${tokenId}`

export const watchedCollections = computed(() => mine.value.collections)
export const watchedItems = computed(() => mine.value.items.map((k) => {
  const [collection, tokenId] = k.split(':')
  return {collection, tokenId}
}))

export const isWatched = (collection: string, tokenId?: string) =>
  tokenId === undefined ? mine.value.collections.includes(collection.toLowerCase()) : mine.value.items.includes(itemKey(collection, tokenId))

/** Stars or unstars; returns the new state. */
export function toggleWatch(collection: string, tokenId?: string): boolean {
  const m = mine.value
  if (tokenId === undefined) {
    const c = collection.toLowerCase()
    const on = !m.collections.includes(c)
    put({...m, collections: on ? [c, ...m.collections] : m.collections.filter((x) => x !== c)})
    return on
  }
  const k = itemKey(collection, tokenId)
  const on = !m.items.includes(k)
  put({...m, items: on ? [k, ...m.items] : m.items.filter((x) => x !== k)})
  return on
}

export const watchCount = computed(() => mine.value.collections.length + mine.value.items.length)
