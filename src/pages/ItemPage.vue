<script setup lang="ts">
// One item: what it is, who holds it, what it costs, and every way to trade it.
//
// Listing and offering are signatures handed to the node (D28): no
// transaction, nothing spent. Buying, accepting an offer and cancelling are
// transactions, and cancelling is one because a signature cannot be taken back
// any other way.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {isAddress, type Address} from 'viem'
import {api, type BidRow, type Item, type ItemDetail} from '../core/api'
import {endpoint, explorerUrl, hasMarket} from '../core/endpoint'
import {wallet, askToConnect} from '../core/wallet'
import {onBlock} from '../core/chain'
import {ago, isZero, priceOf, same, short, until} from '../core/format'
import {mediaURL} from '../core/media'
import {computeRarity, traitsOf} from '../core/rarity'
import {addToCart, cart, inCart, removeFromCart} from '../core/cart'
import {isWatched, toggleWatch} from '../core/watchlist'
import {approvalFor, royaltyBps, useMarket} from '../core/market'
import {acceptBidCall, buyCall, cancelOrdersCall, fetchInput, tokenApproval} from '../core/orders'
import {transferCall} from '../core/nft'
import {addressOf, isName} from '@zvm/web/names'
import {burst} from '../core/burst'
import NftMedia from '../components/NftMedia.vue'
import NftCard from '../components/NftCard.vue'
import Addr from '../components/Addr.vue'
import Price from '../components/Price.vue'
import StepRail from '../components/StepRail.vue'
import SalesChart from '../components/SalesChart.vue'
import ListDialog from '../components/ListDialog.vue'
import OfferDialog from '../components/OfferDialog.vue'
import Modal from '../components/Modal.vue'
import Icon from '../components/Icon.vue'
import Chip from '@zvm/web/components/Chip.vue'

const route = useRoute()
const collection = computed(() => String(route.params.collection))
const tokenId = computed(() => String(route.params.id))
let alive = true
let requestGeneration = 0
const current = (addr: string, id: string, generation: number) =>
  alive && collection.value === addr && tokenId.value === id && requestGeneration === generation


const item = ref<ItemDetail | null>(null)
const siblings = ref<Item[]>([])
const loading = ref(true)
const error = ref('')
const royalty = ref<number | null>(null)
const listing_ = ref(false)
const offering = ref(false)
const sending = ref(false)
const sendTo = ref('')
const zoom = ref(false)
const buyBtn = ref<HTMLElement | null>(null)

const market = useMarket()

async function load(quiet = false) {
  const addr = collection.value, id = tokenId.value, generation = requestGeneration
  if (!hasMarket.value || !current(addr, id, generation)) return
  if (!isAddress(addr) || !/^\d+$/.test(id)) {
    item.value = null
    siblings.value = []
    royalty.value = null
    loading.value = false
    error.value = 'Invalid item address or token id.'
    return
  }
  if (!quiet) loading.value = true
  try {
    const next = await api.item(addr, id)
    if (!current(addr, id, generation)) return
    item.value = next
    error.value = ''
  } catch (err: any) {
    if (current(addr, id, generation) && !quiet) error.value = err?.status === 404 ? 'This node has no such item.' : err?.message ?? String(err)
  } finally {
    if (current(addr, id, generation)) loading.value = false
  }
}

async function loadSiblings() {
  const addr = collection.value, id = tokenId.value, generation = requestGeneration
  if (!current(addr, id, generation) || !isAddress(addr)) return
  const c = item.value?.collectionInfo
  const limit = c && c.items <= 1000 ? 200 : 60
  try {
    let all: Item[] = []
    for (let offset = 0; offset < (c && c.items <= 1000 ? c.items : limit); offset += 200) {
      const page = await api.items(addr, {limit, offset, sort: 'id'})
      if (!current(addr, id, generation)) return
      all = [...all, ...page]
      if (page.length < limit) break
    }
    if (current(addr, id, generation)) siblings.value = all
  } catch {
    if (current(addr, id, generation)) siblings.value = []
  }
}

async function initializeItem() {
  const addr = collection.value, id = tokenId.value, generation = requestGeneration
  await load()
  if (!current(addr, id, generation) || !item.value || error.value) return
  try {
    const bps = await royaltyBps(addr as Address)
    if (!current(addr, id, generation)) return
    royalty.value = bps
  } catch {
    if (current(addr, id, generation)) royalty.value = null
  }
  if (current(addr, id, generation)) void loadSiblings()
}

let off: (() => void) | undefined
onMounted(() => {
  // Subscribe before awaiting data so unmount can always detach the listener.
  off = onBlock(() => {
    if (alive && !market.busy.value) {
      if (item.value) void load(true)
      else void initializeItem()
    }
  })
  void initializeItem()
})
onUnmounted(() => {
  alive = false
  requestGeneration++
  off?.()
})
watch(
  () => route.fullPath,
  () => {
    if (!alive) return
    requestGeneration++
    item.value = null
    siblings.value = []
    royalty.value = null
    market.reset()
    void initializeItem()
  },
)

const meta = computed(() => item.value?.meta ?? null)
const name = computed(() => item.value?.name || meta.value?.name || `#${tokenId.value}`)
const info = computed(() => item.value?.collectionInfo ?? null)
const listing = computed(() => item.value?.listing ?? null)
const isOwner = computed(() => same(item.value?.owner, wallet.address))

// ?list=1 opens the listing form, once, for the holder: another app's "Sell on
// Karum" (ZNS's) lands here with it. The wallet reconnects after the item
// loads, so this waits for both rather than checking on mount.
let listAsked = route.query.list === '1'
watch(
  isOwner,
  (owns) => {
    if (!listAsked || !owns) return
    listAsked = false
    listing_.value = true
  },
  {immediate: true},
)
const offers = computed<BidRow[]>(() => item.value?.offers ?? [])
const bestOffer = computed(() => offers.value[0] ?? null)
const carted = computed(() => inCart(listing.value?.hash))
const watched = computed(() => isWatched(collection.value, tokenId.value))

const rarity = computed(() => (siblings.value.length ? computeRarity(siblings.value) : null))
const rank = computed(() => rarity.value?.rank.get(tokenId.value) ?? null)
const traits = computed(() =>
  traitsOf({meta: meta.value}).map((t) => {
    const share = rarity.value?.traits.find((x) => x.type === t.type)?.values.find((v) => v.value === t.value)?.share ?? null
    return {...t, share}
  }),
)
const more = computed(() =>
  [...siblings.value]
    .filter((s) => s.tokenId !== tokenId.value)
    .sort((a, b) => (a.listing ? 0 : 1) - (b.listing ? 0 : 1))
    .slice(0, 12),
)

const salePoints = computed(() => (item.value?.sales ?? []).filter((s) => s.priceNum > 0).map((s) => ({t: s.timestamp, price: s.priceNum})))

const history = computed(() => {
  const rows: {kind: string; from: string; to: string; price?: string; currency?: string; timestamp?: number; tx?: string}[] = []
  // A sale is also a Transfer, and the item endpoint's transfers carry no
  // transaction hash to match on, so a transfer is folded into the sale that
  // moved the item between the same two accounts.
  const sales = [...(item.value?.sales ?? [])]
  for (const s of sales) rows.push({kind: s.acceptedBid ? 'Offer taken' : 'Sale', from: s.seller, to: s.buyer, price: s.price, currency: s.currency, timestamp: s.timestamp, tx: s.tx})
  for (const t of item.value?.transfers ?? []) {
    const i = sales.findIndex((s) => (t.tx ? s.tx === t.tx : same(s.seller, t.from) && same(s.buyer, t.to)))
    if (i >= 0) {
      sales.splice(i, 1)
      continue
    }
    rows.push({kind: isZero(t.from) ? 'Minted' : 'Transfer', from: t.from, to: t.to, timestamp: t.timestamp as number | undefined, tx: t.tx as string | undefined})
  }
  return rows
})

// --- actions -----------------------------------------------------------------

function cartItem() {
  return {
    hash: listing.value!.hash,
    collection: collection.value,
    collectionName: info.value?.name ?? '',
    tokenId: tokenId.value,
    name: name.value,
    image: item.value?.image ?? '',
    price: listing.value!.price,
    currency: listing.value!.currency,
  }
}

async function buy() {
  if (!listing.value) return
  if (!wallet.address) return askToConnect()
  const buyer = wallet.address as Address
  await market.run(
    async () => {
      const input = await fetchInput(listing.value!.hash)
      const pay = isZero(input.order.paymentToken) ? [] : await tokenApproval(input.order.paymentToken, buyer, input.order.price, 'QSR')
      return [...pay, buyCall(input, `Buy ${name.value}`)]
    },
    {
      success: `${name.value} is yours.`,
      after: async () => {
        burst(buyBtn.value)
        if (listing.value) removeFromCart(listing.value.hash)
        await load(true)
      },
    },
  )
}

function toggleCartItem() {
  if (!listing.value) return
  if (carted.value) removeFromCart(listing.value.hash)
  else {
    addToCart(cartItem())
    cart.open = true
  }
}

async function cancelListing() {
  if (!listing.value) return
  await market.run(async () => [cancelOrdersCall([(await fetchInput(listing.value!.hash)).order], `Take ${name.value} off sale`)], {
    success: 'Listing cancelled.',
    after: () => load(true),
  })
}

async function accept(o: BidRow) {
  const owner = wallet.address as Address
  await market.run(
    async () => {
      const input = await fetchInput(o.hash)
      return [
        ...(await approvalFor(collection.value as Address, owner, info.value?.name ?? 'this collection')),
        acceptBidCall(input, BigInt(tokenId.value), `Sell ${name.value} for ${priceOf(o.price, o.paymentToken)} ZNN`),
      ]
    },
    {success: `Sold ${name.value}.`, after: () => load(true)},
  )
}

async function withdraw(o: BidRow) {
  await market.run(async () => [cancelOrdersCall([(await fetchInput(o.hash)).order], 'Withdraw the offer')], {
    success: 'Offer withdrawn.',
    after: () => load(true),
  })
}

// The send field takes an address or a ZNS name; a name is shown with the
// address it points at before anything is signed.
const sendResolved = ref<Address | null>(null)
const sendNote = ref('')
watch(sendTo, async (raw) => {
  const s = raw.trim()
  sendResolved.value = null
  sendNote.value = ''
  if (isAddress(s)) return (sendResolved.value = s as Address)
  if (!isName(s)) return
  sendNote.value = `Looking up ${s.toLowerCase()}`
  const a = await addressOf(endpoint.chainId, s)
  if (sendTo.value.trim() !== s) return
  sendResolved.value = a
  sendNote.value = a ? `${s.toLowerCase()} → ${a}` : `${s.toLowerCase()} does not point at an address`
})

async function send() {
  const to = sendResolved.value
  if (!to || !wallet.address) return
  await market.run(() => [transferCall(collection.value as Address, wallet.address as Address, to, BigInt(tokenId.value), `Send ${name.value} to ${short(to)}`)], {
    success: `Sent ${name.value}.`,
    after: async () => {
      sending.value = false
      sendTo.value = ''
      await load(true)
    },
  })
}

const copied = ref(false)
async function share() {
  try {
    const url = new URL(location.href)
    url.searchParams.set('rpc', endpoint.rpc)
    await navigator.clipboard.writeText(url.toString())
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    /* the address bar has it */
  }
}
</script>

<template>
  <div v-if="error" class="card p-10 text-center grid gap-2 justify-items-center">
    <Icon name="alert" :size="22" style="color: var(--warn)" />
    <p>{{ error }}</p>
    <router-link :to="`/collection/${collection}`" class="btn btn-sm mt-2">Back to the collection</router-link>
  </div>

  <div v-else class="grid gap-10">
    <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
      <!-- The art. -->
      <div class="grid gap-3 lg:sticky lg:top-[80px]">
        <div class="card overflow-hidden group relative">
          <button class="block w-full aspect-square cursor-zoom-in" :disabled="!item" @click="zoom = true">
            <NftMedia v-if="item" :src="item.image" :alt="name" :seed="`${collection}:${tokenId}`" contain eager />
            <div v-else class="skeleton w-full h-full !rounded-none" />
          </button>
          <div class="absolute top-3 right-3 flex gap-1.5">
            <button class="icon-btn glass" :title="watched ? 'Remove from watchlist' : 'Add to watchlist'" @click="toggleWatch(collection, tokenId)">
              <Icon name="heart" :size="15" :style="watched ? 'color: var(--new-ink); fill: var(--new-ink)' : ''" />
            </button>
            <button class="icon-btn glass" :title="copied ? 'Link copied' : 'Copy a link, with this node'" @click="share">
              <Icon :name="copied ? 'check' : 'share'" :size="15" />
            </button>
            <button class="icon-btn glass" title="View full size" @click="zoom = true"><Icon name="expand" :size="15" /></button>
          </div>
        </div>
        <details v-if="meta?.description" class="card px-4 py-3 group" open>
          <summary class="ledger cursor-pointer list-none flex items-center justify-between">Description <Icon name="down" :size="13" /></summary>
          <p class="text-[13.5px] text-soft mt-2 whitespace-pre-line">{{ meta.description }}</p>
        </details>
      </div>

      <!-- What it is, and what it costs. -->
      <div class="grid gap-5 min-w-0">
        <div class="grid gap-2">
          <router-link :to="`/collection/${collection}`" class="link text-[14px] inline-flex items-center gap-1.5 justify-self-start">
            <span class="w-5 h-5 rounded-[5px] overflow-hidden"><NftMedia :src="info?.meta?.image" :seed="collection" /></span>
            {{ info?.name ?? short(collection) }}
          </router-link>
          <h1 v-if="item" class="text-[30px] md:text-[38px] font-semibold tracking-[-0.03em] leading-[1.1] break-words">{{ name }}</h1>
          <div v-else class="skeleton h-10 w-2/3" />
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-soft">
            <span v-if="item" class="flex items-center gap-1.5">Owned by <Addr :address="item.owner" avatar /></span>
            <Chip v-if="rank && rarity" tone="new" :title="`Over ${rarity.sample} items`"><Icon name="sparkles" :size="11" /> Rank {{ rank }} of {{ rarity.sample }}</Chip>
            <span class="mono text-dim">#{{ tokenId }}</span>
          </div>
        </div>

        <!-- The price card. -->
        <section class="panel overflow-hidden">
          <div v-if="listing" class="px-4 py-2.5 border-b border-line text-[12.5px] text-dim flex items-center gap-2">
            <Icon name="clock" :size="13" /> Sale ends in {{ until(listing.expiry) }}
          </div>
          <div class="p-4 grid gap-4">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div class="ledger">{{ listing ? 'Price' : bestOffer ? 'Best offer' : 'Not listed' }}</div>
                <Price v-if="listing" :raw="listing.price" :currency="listing.currency" size="xl" show-usd />
                <Price v-else-if="bestOffer" :raw="bestOffer.price" :currency="bestOffer.paymentToken" size="xl" show-usd />
                <div v-else class="text-[15px] text-soft mt-1">Make the first offer.</div>
              </div>
              <div v-if="listing && info?.floor" class="text-right text-[12px] text-dim">
                Floor {{ info.floor }} ZNN
              </div>
            </div>

            <!-- A buyer's buttons. -->
            <div v-if="!isOwner" class="grid grid-cols-[1fr_auto] gap-2">
              <template v-if="listing">
                <button ref="buyBtn" class="btn btn-plasma !py-3 text-[15px]" :disabled="market.busy.value" data-testid="buy" @click="buy">
                  <Icon v-if="market.busy.value" name="refresh" :size="15" class="spin" />
                  <Icon v-else name="bolt" :size="15" />
                  {{ wallet.address ? 'Buy now' : 'Connect wallet to buy' }}
                </button>
                <button class="btn !py-3 !px-4" :title="carted ? 'Remove from cart' : 'Add to cart'" @click="toggleCartItem">
                  <Icon :name="carted ? 'check' : 'cart'" :size="16" :style="carted ? 'color: var(--znn-ink)' : ''" />
                </button>
              </template>
              <button class="btn !py-3 text-[14.5px]" :class="listing ? 'col-span-2' : 'col-span-2 btn-plasma'" :disabled="market.busy.value" @click="wallet.address ? (offering = true) : askToConnect()">
                <Icon name="hand" :size="15" /> Make offer
              </button>
            </div>

            <!-- An owner's buttons. -->
            <div v-else class="grid grid-cols-2 gap-2">
              <button class="btn btn-plasma !py-3 text-[15px] col-span-2" :disabled="market.busy.value" data-testid="list" @click="listing_ = true">
                <Icon name="tag" :size="15" /> {{ listing ? 'Change the price' : 'List for sale' }}
              </button>
              <button v-if="listing" class="btn" :disabled="market.busy.value" @click="cancelListing"><Icon name="x" :size="14" /> Cancel listing</button>
              <button class="btn" :class="listing ? '' : 'col-span-2'" :disabled="market.busy.value" @click="sending = true"><Icon name="send" :size="14" /> Transfer</button>
              <button v-if="bestOffer" class="btn col-span-2" :disabled="market.busy.value" @click="accept(bestOffer)">
                <Icon name="hand" :size="14" /> Accept the best offer, {{ priceOf(bestOffer.price, bestOffer.paymentToken) }} ZNN
              </button>
            </div>

            <StepRail :steps="market.steps.value" />
          </div>
        </section>

        <!-- Price history. -->
        <section class="panel p-4 grid gap-2">
          <h2 class="ledger flex items-center gap-2"><Icon name="chart" :size="13" /> Price history</h2>
          <SalesChart :points="salePoints" :height="180" :window="3" />
        </section>

        <!-- Offers. -->
        <section class="panel overflow-hidden">
          <h2 class="ledger px-4 py-3 border-b border-line flex items-center gap-2"><Icon name="hand" :size="13" /> Offers <span class="text-dim">{{ offers.length }}</span></h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[480px] border-collapse text-[13px]">
              <thead><tr><th class="th">Price</th><th class="th">Kind</th><th class="th">From</th><th class="th">Expires</th><th class="th" /></tr></thead>
              <tbody>
                <tr v-for="o in offers" :key="o.hash">
                  <td class="td"><Price :raw="o.price" :currency="o.paymentToken" size="sm" show-usd /></td>
                  <td class="td"><Chip :tone="o.isCollection ? 'l1' : 'plain'">{{ o.isCollection ? 'Collection' : 'This item' }}</Chip></td>
                  <td class="td"><Addr :address="o.bidder" /></td>
                  <td class="td text-dim">in {{ until(o.expiry) }}</td>
                  <td class="td text-right">
                    <button v-if="isOwner" class="btn btn-sm btn-plasma" :disabled="market.busy.value" @click="accept(o)">Accept</button>
                    <button v-else-if="same(o.bidder, wallet.address)" class="btn btn-sm" :disabled="market.busy.value" @click="withdraw(o)">Withdraw</button>
                  </td>
                </tr>
                <tr v-if="!offers.length"><td colspan="5" class="td text-center text-dim py-6">No offers yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Traits. -->
        <section v-if="traits.length" class="grid gap-2">
          <h2 class="ledger">Traits</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <router-link
              v-for="(t, i) in traits"
              :key="t.type"
              :to="`/collection/${collection}`"
              class="rounded-[8px] border border-line bg-sunk px-3 py-2.5 hover:border-[color-mix(in_srgb,var(--znn)_45%,transparent)] transition-colors rise-in"
              :style="{'--i': i}"
            >
              <div class="ledger truncate">{{ t.type }}</div>
              <div class="text-[14px] font-medium truncate">{{ t.value }}</div>
              <div v-if="t.share !== null" class="text-[11.5px] text-dim">{{ (t.share * 100).toFixed(t.share < 0.1 ? 1 : 0) }}% have this</div>
            </router-link>
          </div>
        </section>

        <!-- History. -->
        <section class="panel overflow-hidden">
          <h2 class="ledger px-4 py-3 border-b border-line flex items-center gap-2"><Icon name="history" :size="13" /> Item activity</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[480px] border-collapse text-[13px]">
              <thead><tr><th class="th">Event</th><th class="th">Price</th><th class="th">From</th><th class="th">To</th><th class="th text-right">When</th></tr></thead>
              <tbody>
                <tr v-for="(h, i) in history" :key="i">
                  <td class="td"><Chip :tone="h.kind === 'Sale' || h.kind === 'Offer taken' ? 'l2' : h.kind === 'Minted' ? 'new' : 'plain'" dot>{{ h.kind }}</Chip></td>
                  <td class="td"><Price v-if="h.price" :raw="h.price" :currency="h.currency" size="sm" /><span v-else class="text-dim">-</span></td>
                  <td class="td"><Addr :address="h.from" /></td>
                  <td class="td"><Addr :address="h.to" /></td>
                  <td class="td text-right text-dim whitespace-nowrap">
                    <a v-if="h.tx && explorerUrl(`/tx/${h.tx}`)" class="link inline-flex items-center gap-1" :href="explorerUrl(`/tx/${h.tx}`)!" target="_blank" rel="noreferrer noopener">
                      {{ h.timestamp ? ago(h.timestamp) : 'view' }} <Icon name="external" :size="11" />
                    </a>
                    <span v-else>{{ h.timestamp ? ago(h.timestamp) : '' }}</span>
                  </td>
                </tr>
                <tr v-if="!history.length"><td colspan="5" class="td text-center text-dim py-6">Nothing yet.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Details. -->
        <section class="panel">
          <h2 class="ledger px-4 py-3 border-b border-line">Details</h2>
          <dl class="p-4 grid gap-2 text-[13px]">
            <div class="flex justify-between gap-3"><dt class="text-dim">Contract</dt><dd>
              <a v-if="explorerUrl(`/address/${collection}`)" class="link mono" :href="explorerUrl(`/address/${collection}`)!" target="_blank" rel="noreferrer noopener">{{ short(collection, 8, 6) }}</a>
              <span v-else class="mono">{{ short(collection, 8, 6) }}</span>
            </dd></div>
            <div class="flex justify-between gap-3"><dt class="text-dim">Token id</dt><dd class="mono">{{ tokenId }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-dim">Standard</dt><dd class="mono">ERC-721</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-dim">Chain</dt><dd class="mono">ZVM {{ endpoint.chainId }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-dim">Creator royalty</dt><dd class="mono">{{ royalty === null ? '-' : `${(royalty / 100).toFixed(2)}%` }}</dd></div>
            <div v-if="item?.uri" class="flex justify-between gap-3"><dt class="text-dim">Metadata</dt><dd>
              <a class="link mono" :href="mediaURL(item.uri)" target="_blank" rel="noreferrer noopener">{{ short(item.uri.split('/').pop(), 10, 8) }}</a>
            </dd></div>
          </dl>
        </section>
      </div>
    </div>

    <!-- More from this collection. -->
    <section v-if="more.length" class="grid gap-4">
      <div class="flex items-end justify-between gap-3">
        <h2 class="text-[20px] font-semibold tracking-[-0.02em]">More from {{ info?.name ?? 'this collection' }}</h2>
        <router-link :to="`/collection/${collection}`" class="btn btn-sm">View collection <Icon name="arrow" :size="13" /></router-link>
      </div>
      <div class="flex gap-4 overflow-x-auto pb-2 snap-rail no-scrollbar -mx-4 px-4">
        <div v-for="(s, i) in more" :key="s.tokenId" class="w-[200px] shrink-0">
          <NftCard
            :collection="collection"
            :token-id="s.tokenId"
            :name="s.name"
            :image="s.image"
            :owner="s.owner"
            :listing="s.listing"
            :rank="rarity?.rank.get(s.tokenId)"
            :total="rarity?.sample"
            compact
            :index="i"
          />
        </div>
      </div>
    </section>

    <ListDialog
      :open="listing_"
      :items="[{collection, collectionName: info?.name, tokenId, name, image: item?.image}]"
      :floor="info?.floor"
      :current="listing ? priceOf(listing.price, listing.currency).replace(/,/g, '') : null"
      @close="listing_ = false"
      @done="load(true)"
    />
    <OfferDialog
      :open="offering"
      :collection="collection"
      :collection-name="info?.name"
      :token-id="tokenId"
      :name="name"
      :image="item?.image"
      :floor="info?.floor"
      :top-bid="bestOffer?.priceNum"
      @close="offering = false"
      @done="load(true)"
    />

    <Modal :open="sending" title="Transfer" :width="440" @close="sending = false">
      <div class="p-4 grid gap-3">
        <p class="text-[13px] text-soft">Send {{ name }} to another address. This is a transaction, and it cannot be undone.</p>
        <input v-model="sendTo" class="input" placeholder="0x… or name.znn" spellcheck="false" />
        <p v-if="sendNote" class="text-[12.5px] mono break-all" :style="{color: sendResolved ? 'var(--dim)' : 'var(--danger)'}">{{ sendNote }}</p>
        <p v-else-if="sendTo && !sendResolved && !isName(sendTo.trim())" class="text-[12.5px]" style="color: var(--danger)">That is not an EVM address or a .znn name.</p>
        <p v-if="listing" class="text-[12.5px]" style="color: var(--warn)">It is listed. The listing stops being fillable once the item leaves your wallet.</p>
        <StepRail :steps="market.steps.value" />
        <button class="btn btn-plasma w-full !py-2.5" :disabled="!sendResolved || market.busy.value" @click="send"><Icon name="send" :size="14" /> Send</button>
      </div>
    </Modal>

    <!-- Full size, on a dark stage. -->
    <Teleport to="body">
      <Transition name="scrim">
        <div v-if="zoom && item" class="fixed inset-0 z-[65] bg-black/90 backdrop-blur grid place-items-center p-4 cursor-zoom-out" @click="zoom = false" @keydown.esc="zoom = false">
          <img :src="mediaURL(item.image)" :alt="name" class="max-w-full max-h-full object-contain rounded-[8px] fade-in" />
          <button class="absolute top-4 right-4 icon-btn glass" title="Close"><Icon name="x" :size="16" /></button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
