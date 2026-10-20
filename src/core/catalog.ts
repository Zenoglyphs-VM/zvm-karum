// Every collection the node knows, held once for the whole app.
//
// The header's search, the drops page and every card that names a collection
// read from here, so switching pages does not refetch a list that changes a
// few times a day. It reloads when the node changes, and on a slow timer.

import {reactive, watch} from 'vue'
import type {Address} from 'viem'
import {api, type Collection} from './api'
import {endpoint, hasMarket} from './endpoint'
import {publicClient} from '@zvm/web/evm'
import {collectionAbi} from './nft'

/** Multicall3, at its canonical address on every chain that has it. */
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11' as Address

export interface Drop {
  collection: Address
  /** Wei of ZNN per token. */
  price: bigint
  maxSupply: number
  maxPerWallet: number
  start: number
  end: number
  minted: number
}

export const catalog = reactive<{
  collections: Collection[]
  loaded: boolean
  error: string
  drops: Drop[]
  dropsLoaded: boolean
}>({collections: [], loaded: false, error: '', drops: [], dropsLoaded: false})

export async function loadCatalog() {
  if (!hasMarket.value) {
    catalog.collections = []
    catalog.loaded = true
    return
  }
  try {
    catalog.collections = await api.collections({limit: 200})
    catalog.error = ''
  } catch (err: any) {
    catalog.error = err?.message ?? String(err)
  } finally {
    catalog.loaded = true
  }
}

export const byAddress = (addr: string | null | undefined) =>
  addr ? catalog.collections.find((c) => c.address.toLowerCase() === addr.toLowerCase()) ?? null : null

/**
 * Which collections have a public drop configured, read straight from the
 * contracts. The index does not track drops, and a drop is two storage reads
 * per collection, so one multicall over the catalogue answers it.
 */
export async function loadDrops() {
  if (endpoint.chainId === null || !catalog.collections.length) {
    catalog.drops = []
    catalog.dropsLoaded = true
    return
  }
  const client = publicClient(endpoint.chainId)
  const targets = catalog.collections.filter((c) => c.factory).map((c) => c.address as Address)
  try {
    const [drops, minted] = await Promise.all([
      client.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: true,
        contracts: targets.map((address) => ({address, abi: collectionAbi, functionName: 'drop' as const})),
      }),
      client.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: true,
        contracts: targets.map((address) => ({address, abi: collectionAbi, functionName: 'nextTokenId' as const})),
      }),
    ])
    const out: Drop[] = []
    drops.forEach((r, i) => {
      if (r.status !== 'success') return
      const [price, maxSupply, maxPerWallet, start, end] = r.result as readonly [bigint, number, number, number, number]
      if (!start) return
      const next = minted[i].status === 'success' ? Number(minted[i].result as bigint) : 1
      out.push({collection: targets[i], price, maxSupply, maxPerWallet, start, end, minted: Math.max(0, next - 1)})
    })
    catalog.drops = out
  } catch {
    catalog.drops = []
  } finally {
    catalog.dropsLoaded = true
  }
}

export type DropPhase = 'upcoming' | 'live' | 'ended' | 'sold-out'

export function dropPhase(d: Drop, now = Date.now() / 1000): DropPhase {
  if (d.maxSupply && d.minted >= d.maxSupply) return 'sold-out'
  if (now < d.start) return 'upcoming'
  if (d.end && now >= d.end) return 'ended'
  return 'live'
}

let timer: number | undefined

export function startCatalog() {
  if (timer) return
  void loadCatalog().then(loadDrops)
  // Skipped while the tab is hidden, like the chain poll: 200 collections and
  // two multicalls a minute for a background tab is the heaviest read here.
  timer = window.setInterval(() => {
    if (!document.hidden) void loadCatalog().then(loadDrops)
  }, 60_000)
}

watch(
  () => [endpoint.apiBase, endpoint.chainId],
  () => {
    catalog.loaded = false
    catalog.dropsLoaded = false
    catalog.collections = []
    catalog.drops = []
    void loadCatalog().then(loadDrops)
  },
)
