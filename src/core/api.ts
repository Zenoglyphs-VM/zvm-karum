// The ZVM node's market API, as this page reads it.
//
// The shapes are the node's (zvm-node/market/nft.go), written out so a page can
// be type-checked against them. Every path is built from the configured
// endpoint rather than a leading slash, because this bundle has no node of its
// own: a leading slash would ask GitHub Pages for the order book.

import {base} from './endpoint'
import {curate} from './curated'

export interface ChainInfo {
  l1: {chainId: number; frontier: number; rpc: string; inbox: string; explorer?: string}
  l2: {chainId: number; rpc: string; head: number; finalized: number; evm: string}
  /** Present when the node was given a deployment written by `zvm apps setup`. */
  apps?: {
    /** Settles signed orders (D28). */
    exchange: string
    /** What bids are paid in: nothing is escrowed, so a bid is an allowance. */
    wrappedZnn?: string
    collectionFactory: string
    collectionImplementation: string
    /** Wrapped QSR, a predeploy; listings may be priced in it. */
    rewardToken: string
    collections?: string[]
    mediaUrl?: string
  }
  /** Present when this node stores NFT images and metadata. */
  media?: {
    publicUrl: string
    loadUrl: string
    cdn: boolean
    host: string
    maxImageBytes: number
    maxJsonBytes: number
    uploads: boolean
  }
  prices?: {enabled: boolean; source: string; updatedAt: number; stale: boolean}
}

export interface Meta {
  name?: string
  description?: string
  image?: string
  banner?: string
  external_url?: string
  attributes?: {trait_type?: string; value?: unknown; display_type?: string}[]
}

export interface Collection {
  address: string
  name: string
  symbol: string
  creator?: string
  factory?: string
  contractUri?: string
  meta?: Meta | null
  firstBlock: number
  items: number
  owners: number
  sales: number
  sales24h: number
  /** Whole ZNN, summed over sales paid in ZNN. */
  volume: number
  volume24h: number
  /** The cheapest fillable ZNN listing, in whole ZNN. */
  floor: number | null
  listed: number
  /** The most a collection bid would pay for any one item. */
  topBid: number | null
}

/** The cheapest fillable listing on an item, as the item rows carry it. */
export interface BestListing {
  hash: string
  exchange: string
  /** Base units of `currency`. */
  price: string
  priceNum: number
  currency: string
  expiry?: number | string
  seller?: string
  kind?: number
}

export interface Item {
  tokenId: string
  owner: string
  uri: string
  name: string
  image: string
  meta: Meta | null
  mintedBlock: number
  listing?: BestListing
}

export interface OrderRow {
  hash: string
  exchange: string
  trader: string
  side: 'sell' | 'buy'
  collection: string
  collectionName: string
  tokenId: string | null
  isCollection: boolean
  amount: number
  filled: number
  paymentToken: string
  price: string
  priceNum: number
  listingTime: number | string
  expiry: number | string
  kind: number
  status: string
  code: number
  reason?: string
  block: number
  timestamp: number
  name: string
  image: string
  currency: string
  seller?: string
  bidder?: string
}

export interface BidRow {
  hash: string
  exchange: string
  collection: string
  tokenId: string | null
  bidder: string
  paymentToken: string
  price: string
  priceNum: number
  quantity: number
  filled: number
  expiry: number | string
  status: string
  block: number
  timestamp: number
  isCollection: boolean
}

export interface Sale {
  tx: string
  index: number
  block: number
  timestamp: number
  collection: string
  collectionName: string
  tokenId: string
  seller: string
  buyer: string
  currency: string
  paidIn: string
  price: string
  priceNum: number
  royalty: string
  fee: string
  name: string
  image: string
  order: string
  acceptedBid: boolean
}

export type ActivityKind = 'sale' | 'bid-accepted' | 'list' | 'offer' | 'transfer'

export interface Activity {
  kind: ActivityKind
  block: number
  timestamp: number
  collection: string
  tokenId: string
  from: string
  to: string
  price: string
  currency: string
  tx?: string
  order?: string
}

export interface Transfer {
  tx?: string
  block?: number
  timestamp?: number
  from: string
  to: string
  tokenId?: string
  [k: string]: unknown
}

export interface ItemDetail extends Item {
  collection: string
  collectionInfo?: Collection
  offers: BidRow[]
  listings: OrderRow[]
  sales: Sale[]
  transfers: Transfer[]
}

export interface Account {
  address: string
  owned: {collection: string; collectionName: string; tokenId: string; name: string; image: string; listing?: BestListing}[]
  created: Collection[]
  listings: OrderRow[]
  offersMade: BidRow[]
  offersReceived: BidRow[]
  openOrders: OrderRow[]
  activity: Activity[]
}

export interface Overview {
  totals: {collections: number; items: number; sales: number; volume: number | null; volume24h: number | null; listed: number}
  collections: Collection[]
  sales: Sale[]
  listings: OrderRow[]
}

/** Something a person can list: an item they hold, as a dialog needs it. */
export interface Listable {
  collection: string
  collectionName?: string
  tokenId: string
  name: string
  image?: string
}

export interface OrderDetail {
  hash: string
  input: any
  status: string
  code: number
  reason: string
  fillable: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
  }
}

const TIMEOUT_MS = 12_000

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${base()}${path}`
  let res: Response
  try {
    res = await fetch(url, {...init, signal: AbortSignal.timeout(TIMEOUT_MS)})
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new ApiError(`${hostOf(url)} did not answer in time.`)
    // A cross-origin failure reaches JavaScript as a bare TypeError with no
    // detail, so a node that is up but refusing looks exactly like one that is
    // down. The message names both rather than asserting the wrong one.
    throw new ApiError(`${hostOf(url)} did not answer. It may be down, or refusing this page's request.`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
  return body as T
}

const get = <T>(path: string) => request<T>(path, {headers: {accept: 'application/json'}})

const post = <T>(path: string, payload: unknown) =>
  request<T>(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)})

const qs = (params: Record<string, string | number | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  return q ? `?${q}` : ''
}

/**
 * The node is written in Go, where an empty slice marshals as `null`, so an
 * account that created nothing comes back with `created: null`. Every list the
 * pages read is made an array here, once, rather than guarded at each use.
 */
function lists<T extends object>(obj: T, keys: (keyof T)[]): T {
  for (const k of keys) if (!Array.isArray(obj[k])) (obj as any)[k] = []
  return obj
}

export type CollectionSort = 'volume' | 'recent' | 'items' | 'floor'
export type ItemSort = 'price_asc' | 'price_desc' | 'recent' | 'id'

export const api = {
  overview: () =>
    get<Overview>('/api/nft').then((o) => {
      lists(o, ['collections', 'sales', 'listings'])
      o.collections.forEach(curate)
      return o
    }),
  collections: (p: {limit?: number; sort?: CollectionSort} = {}) =>
    get<Collection[]>(`/api/nft/collections${qs(p)}`).then((r) => (r ?? []).map(curate)),
  collection: (addr: string) => get<Collection>(`/api/nft/collections/${addr}`).then(curate),
  items: (addr: string, p: {limit?: number; offset?: number; sort?: ItemSort; listed?: number} = {}) =>
    get<Item[]>(`/api/nft/collections/${addr}/items${qs(p)}`),
  collectionActivity: (addr: string, p: {limit?: number} = {}) => get<Activity[]>(`/api/nft/collections/${addr}/activity${qs(p)}`),
  item: (collection: string, id: string) =>
    get<ItemDetail>(`/api/nft/items/${collection}/${id}`).then((i) => {
      lists(i, ['offers', 'listings', 'sales', 'transfers'])
      curate(i.collectionInfo)
      return i
    }),
  account: (addr: string) =>
    get<Account>(`/api/nft/accounts/${addr}`).then((a) => {
      lists(a, ['owned', 'created', 'listings', 'offersMade', 'offersReceived', 'openOrders', 'activity'])
      a.created.forEach(curate)
      return a
    }),
  sales: (p: {limit?: number; collection?: string} = {}) => get<Sale[]>(`/api/nft/sales${qs(p)}`),
  listings: (p: {limit?: number; collection?: string; sort?: 'price'} = {}) => get<OrderRow[]>(`/api/nft/listings${qs(p)}`),
  offers: (p: {limit?: number; collection?: string; collectionOnly?: number} = {}) => get<BidRow[]>(`/api/nft/offers${qs(p)}`),
  orders: (p: {trader?: string; collection?: string; tokenId?: string; side?: string; all?: number; limit?: number} = {}) =>
    get<OrderRow[]>(`/api/nft/orders${qs(p)}`),
  order: (hash: string) => get<OrderDetail>(`/api/nft/orders/${hash}`),
  submitOrders: (orders: unknown[]) =>
    post<{results: {hash: string; ok: boolean; code: number; reason?: string}[]}>('/api/nft/orders', {orders}),

  // The media store: a signature buys a session, a session uploads bytes.
  mediaChallenge: (address: string) => get<{message: string; expiresAt: number}>(`/api/media/challenge${qs({address})}`),
  mediaSession: (body: {address: string; message: string; signature: string}) =>
    post<{token: string; address: string; expiresAt: number}>('/api/media/session', body),
}
