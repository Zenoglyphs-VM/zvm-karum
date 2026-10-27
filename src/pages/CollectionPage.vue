<script setup lang="ts">
// One collection: its items with filters and rarity, a floor sweep, what has
// happened to it, the offers standing against it, and its sales over time.
//
// Items come from the node two hundred at a time. A collection up to a
// thousand items is loaded whole, so trait counts and rarity ranks are exact;
// past that they are computed over what has been loaded, and the page says so
// rather than presenting a sample as the collection.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {isAddress, type Address} from 'viem'
import {api, type Activity, type BidRow, type Collection, type Item, type ItemSort, type OrderRow, type Sale} from '../core/api'
import {explorerUrl, hasMarket} from '../core/endpoint'
import {wallet} from '../core/wallet'
import {onBlock} from '../core/chain'
import {percent, priceOf, same, short, until, whole, usd} from '../core/format'
import {usdOfZnn} from '../core/prices'
import {computeRarity, traitsOf} from '../core/rarity'
import {addToCart, cart} from '../core/cart'
import {isWatched, toggleWatch} from '../core/watchlist'
import {royaltyBps, useMarket, approvalFor} from '../core/market'
import {acceptBidCall, cancelOrdersCall, fetchInput} from '../core/orders'
import {toast} from '../core/toast'
import NftCard from '../components/NftCard.vue'
import NftMedia from '../components/NftMedia.vue'
import Addr from '../components/Addr.vue'
import Price from '../components/Price.vue'
import Tabs from '../components/Tabs.vue'
import ActivityList from '../components/ActivityList.vue'
import SalesChart from '../components/SalesChart.vue'
import OfferDialog from '../components/OfferDialog.vue'
import StepRail from '../components/StepRail.vue'
import Icon from '../components/Icon.vue'
import Chip from '@zvm/web/components/Chip.vue'

const route = useRoute()
const address = computed(() => String(route.params.address))
let alive = true
let requestGeneration = 0
const current = (addr: string, generation: number) =>
  alive && isAddress(addr) && address.value === addr && requestGeneration === generation


const collection = ref<Collection | null>(null)
const items = ref<Item[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const exhausted = ref(false)
const error = ref('')
const royalty = ref<number | null>(null)

const tab = ref<'items' | 'activity' | 'offers' | 'analytics'>((route.query.tab as any) || 'items')
const sort = ref<ItemSort | 'rarity'>('price_asc')
const listedOnly = ref(false)
const q = ref('')
const dense = ref(false)
const filtersOpen = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
const picked = ref<Record<string, string[]>>({})
const minPrice = ref('')
const maxPrice = ref('')
const openTrait = ref<string | null>(null)

const activity = ref<Activity[]>([])
const activityLoading = ref(false)
const offers = ref<BidRow[]>([])
const sales = ref<Sale[]>([])
const floorListings = ref<OrderRow[]>([])
const sweepN = ref(0)
const offering = ref(false)
const descOpen = ref(false)

const PAGE = 200
const WHOLE = 1000

const meta = computed(() => collection.value?.meta ?? null)
const loadedAll = computed(() => exhausted.value || (collection.value !== null && items.value.length >= collection.value.items))
const rarity = computed(() => computeRarity(items.value))
const rarityExact = computed(() => loadedAll.value)

async function loadItems(reset = true) {
  const addr = address.value, generation = requestGeneration
  if (!current(addr, generation)) return
  if (reset) {
    items.value = []
    exhausted.value = false
  }
  loadingMore.value = true
  try {
    const all = (collection.value?.items ?? 0) <= WHOLE
    do {
      const page = await api.items(addr, {limit: PAGE, offset: items.value.length, sort: sort.value === 'rarity' ? 'id' : sort.value, listed: listedOnly.value ? 1 : 0})
      if (!current(addr, generation)) return
      items.value = [...items.value, ...page]
      if (page.length < PAGE) exhausted.value = true
      if (!all) break
    } while (!exhausted.value && items.value.length < WHOLE)
  } catch (err: any) {
    if (current(addr, generation)) error.value = err?.message ?? String(err)
  } finally {
    if (current(addr, generation)) loadingMore.value = false
  }
}

async function load() {
  const addr = address.value, generation = ++requestGeneration
  if (!hasMarket.value || !current(addr, generation)) return
  loading.value = true
  error.value = ''
  try {
    const next = await api.collection(addr)
    if (!current(addr, generation)) return
    collection.value = next
    await loadItems()
    if (!current(addr, generation)) return
    const bps = await royaltyBps(addr as Address)
    if (!current(addr, generation)) return
    royalty.value = bps
    void loadSide()
  } catch (err: any) {
    if (current(addr, generation)) error.value = err?.status === 404 ? 'This node has no collection at that address.' : err?.message ?? String(err)
  } finally {
    if (current(addr, generation)) loading.value = false
  }
}

async function loadSide() {
  const addr = address.value, generation = requestGeneration
  if (!current(addr, generation)) return
  const [l, o] = await Promise.all([
    api.listings({collection: addr, sort: 'price', limit: 50}).catch(() => []),
    api.offers({collection: addr, collectionOnly: 1, limit: 50}).catch(() => []),
  ])
  if (!current(addr, generation)) return
  floorListings.value = l
  offers.value = o
}

async function loadTab() {
  const addr = address.value, generation = requestGeneration, selectedTab = tab.value
  if (!current(addr, generation)) return
  if (selectedTab === 'activity') {
    activityLoading.value = true
    const next = await api.collectionActivity(addr, {limit: 100}).catch(() => [])
    if (!current(addr, generation)) return
    if (tab.value === selectedTab) activity.value = next
    activityLoading.value = false
  }
  if (selectedTab === 'analytics' || selectedTab === 'items') {
    const next = await api.sales({collection: addr, limit: 200}).catch(() => [])
    if (current(addr, generation) && tab.value === selectedTab) sales.value = next
  }
}

async function refresh() {
  const addr = address.value, generation = requestGeneration
  if (!current(addr, generation)) return
  try {
    const next = await api.collection(addr)
    if (!current(addr, generation)) return
    collection.value = next
    void loadSide()
    if (tab.value === 'activity') {
      const nextActivity = await api.collectionActivity(addr, {limit: 100})
      if (current(addr, generation) && tab.value === 'activity') activity.value = nextActivity
    }
  } catch {
    /* the next block tries again */
  }
}

let off: (() => void) | undefined
onMounted(() => {
  void load().then(loadTab)
  off = onBlock(() => {
    if (!market.busy.value) void refresh()
  })
})
onUnmounted(() => {
  alive = false
  requestGeneration++
  off?.()
})
watch(address, () => void load().then(loadTab))
watch([sort, listedOnly], () => void loadItems())
watch(tab, () => void loadTab())
watch(hasMarket, (v) => v && void load())

// --- filtering, all in the browser over what is loaded ---------------------

const priceWhole = (it: Item) => (it.listing ? it.listing.priceNum : null)

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase()
  const min = parseFloat(minPrice.value)
  const max = parseFloat(maxPrice.value)
  const want = Object.entries(picked.value).filter(([, v]) => v.length)
  return items.value.filter((it) => {
    if (s && !(it.name.toLowerCase().includes(s) || it.tokenId === s.replace(/^#/, ''))) return false
    const p = priceWhole(it)
    if (!isNaN(min) && (p === null || p < min)) return false
    if (!isNaN(max) && (p === null || p > max)) return false
    if (want.length) {
      const own = new Map(traitsOf(it).map((t) => [t.type, t.value]))
      for (const [type, values] of want) if (!values.includes(own.get(type) ?? 'none')) return false
    }
    return true
  })
})

const shown = computed(() => {
  if (sort.value !== 'rarity') return filtered.value
  return [...filtered.value].sort((a, b) => (rarity.value.rank.get(a.tokenId) ?? 1e9) - (rarity.value.rank.get(b.tokenId) ?? 1e9))
})

const activeFilters = computed(() => Object.values(picked.value).reduce((n, v) => n + v.length, 0) + (minPrice.value ? 1 : 0) + (maxPrice.value ? 1 : 0))

function toggleTrait(type: string, value: string) {
  const cur = picked.value[type] ?? []
  picked.value = {...picked.value, [type]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]}
}

function clearFilters() {
  picked.value = {}
  minPrice.value = ''
  maxPrice.value = ''
  q.value = ''
}

// Infinite scroll for a collection too large to load whole.
const sentinel = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null
onMounted(() => {
  io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !loadingMore.value && !loadedAll.value && tab.value === 'items') void loadItems(false)
  })
  watch(sentinel, (el, prev) => {
    if (prev) io?.unobserve(prev)
    if (el) io?.observe(el)
  }, {immediate: true})
})
onUnmounted(() => io?.disconnect())

// --- the sweep --------------------------------------------------------------

const sweepable = computed(() => floorListings.value.filter((l) => l.tokenId !== null && !same(l.trader, wallet.address)))
const sweepPick = computed(() => sweepable.value.slice(0, sweepN.value))
const sweepTotal = computed(() => sweepPick.value.reduce((a, l) => a + BigInt(l.price), 0n))
const sweepIds = computed(() => new Set(sweepPick.value.map((l) => l.tokenId)))

function sweep() {
  let added = 0
  for (const l of sweepPick.value) {
    if (
      addToCart({
        hash: l.hash,
        collection: l.collection,
        collectionName: collection.value?.name ?? '',
        tokenId: l.tokenId!,
        name: l.name || `#${l.tokenId}`,
        image: l.image,
        price: l.price,
        currency: l.paymentToken,
      })
    )
      added++
  }
  sweepN.value = 0
  if (added) cart.open = true
  else toast('Those are already in your cart.', 'info')
}

// --- offers -----------------------------------------------------------------

const market = useMarket()
const heldHere = computed(() => items.value.filter((i) => same(i.owner, wallet.address)))

async function acceptCollectionOffer(o: BidRow) {
  const owner = wallet.address as Address
  const token = heldHere.value.find((i) => !i.listing) ?? heldHere.value[0]
  if (!token) return
  await market.run(
    async () => {
      const input = await fetchInput(o.hash)
      return [
        ...(await approvalFor(address.value as Address, owner, collection.value?.name ?? 'this collection')),
        acceptBidCall(input, BigInt(token.tokenId), `Sell ${token.name || `#${token.tokenId}`} for ${priceOf(o.price, o.paymentToken)} ZNN`),
      ]
    },
    {success: `Sold ${token.name || `#${token.tokenId}`}.`, after: load},
  )
}

async function cancelOffer(o: BidRow) {
  await market.run(async () => [cancelOrdersCall([(await fetchInput(o.hash)).order], 'Withdraw the offer')], {
    success: 'Offer withdrawn.',
    after: loadSide,
  })
}

// --- the numbers ------------------------------------------------------------

const salePoints = computed(() =>
  sales.value.filter((s) => s.priceNum > 0 && (s.currency === '0x0000000000000000000000000000000000000000' || s.acceptedBid)).map((s) => ({t: s.timestamp, price: s.priceNum, label: s.name || `#${s.tokenId}`})),
)

const images = computed(() => Object.fromEntries(items.value.map((i) => [`${address.value.toLowerCase()}:${i.tokenId}`, i.image])))

const depth = computed(() => {
  const prices = floorListings.value.map((l) => l.priceNum).filter((p) => p > 0)
  if (!prices.length) return []
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const n = Math.min(12, Math.max(4, prices.length))
  const step = (hi - lo) / n || 1
  const buckets = Array.from({length: n}, (_, i) => ({from: lo + i * step, count: 0}))
  for (const p of prices) buckets[Math.min(n - 1, Math.floor((p - lo) / step))].count++
  return buckets
})
const depthMax = computed(() => Math.max(1, ...depth.value.map((b) => b.count)))

const analytics = computed(() => {
  const p = salePoints.value.map((x) => x.price)
  if (!p.length) return null
  return {avg: p.reduce((a, b) => a + b, 0) / p.length, high: Math.max(...p), low: Math.min(...p), n: p.length}
})

const copied = ref(false)
async function share() {
  try {
    await navigator.clipboard.writeText(location.href)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    /* nothing to do: the address bar has it */
  }
}

const tabs = computed(() => [
  {id: 'items', label: 'Items', count: collection.value?.items ?? null},
  {id: 'activity', label: 'Activity'},
  {id: 'offers', label: 'Offers', count: offers.value.length},
  {id: 'analytics', label: 'Analytics'},
])

const SORTS: {v: string; label: string}[] = [
  {v: 'price_asc', label: 'Price: low to high'},
  {v: 'price_desc', label: 'Price: high to low'},
  {v: 'recent', label: 'Recently minted'},
  {v: 'id', label: 'Token id'},
  {v: 'rarity', label: 'Rarity: rarest first'},
]
</script>

<template>
  <div v-if="error && !collection" class="card p-10 text-center grid gap-2 justify-items-center">
    <Icon name="alert" :size="22" style="color: var(--warn)" />
    <p>{{ error }}</p>
    <router-link to="/collections" class="btn btn-sm mt-2">Browse collections</router-link>
  </div>

  <div v-else class="grid gap-6">
    <!-- Banner, lit by the collection's own art. -->
    <section class="relative -mx-4 -mt-6">
      <div class="relative h-[200px] md:h-[260px] overflow-hidden">
        <div class="absolute inset-0 drift blur-[40px] saturate-150 opacity-80"><NftMedia :src="meta?.banner ?? meta?.image" :seed="address" eager /></div>
        <div class="absolute inset-0" style="background: linear-gradient(0deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 40%, transparent) 60%, transparent)" />
      </div>
      <div class="relative px-4 -mt-16 md:-mt-20 flex flex-wrap items-end gap-4">
        <span class="w-24 h-24 md:w-32 md:h-32 rounded-[18px] overflow-hidden ring-4 ring-[var(--bg)] shadow-2xl shrink-0">
          <NftMedia v-if="collection" :src="meta?.image" :seed="address" eager />
          <div v-else class="skeleton w-full h-full" />
        </span>
        <div class="min-w-0 grow pb-1">
          <div v-if="collection" class="flex flex-wrap items-center gap-2">
            <h1 class="text-[28px] md:text-[36px] font-semibold tracking-[-0.03em] leading-tight">{{ collection.name || short(address) }}</h1>
            <Chip>{{ collection.symbol }}</Chip>
          </div>
          <div v-else class="skeleton h-9 w-72" />
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[13px] text-soft">
            <span v-if="collection?.creator" class="flex items-center gap-1.5">by <Addr :address="collection.creator" avatar /></span>
            <a v-if="explorerUrl(`/address/${address}`)" :href="explorerUrl(`/address/${address}`)!" target="_blank" rel="noreferrer noopener" class="mono link text-[12.5px] inline-flex items-center gap-1">
              {{ short(address, 6, 4) }} <Icon name="external" :size="11" />
            </a>
            <span v-if="royalty !== null" class="text-dim">Royalty {{ (royalty / 100).toFixed(1) }}%</span>
          </div>
        </div>
        <div class="flex items-center gap-1.5 pb-1">
          <button class="icon-btn border border-line bg-surface" :title="isWatched(address) ? 'Unwatch' : 'Watch'" @click="toggleWatch(address)">
            <Icon name="heart" :size="15" :style="isWatched(address) ? 'color: var(--new-ink); fill: var(--new-ink)' : ''" />
          </button>
          <button class="icon-btn border border-line bg-surface" :title="copied ? 'Link copied' : 'Copy link'" @click="share">
            <Icon :name="copied ? 'check' : 'share'" :size="15" />
          </button>
          <button class="btn" @click="offering = true"><Icon name="hand" :size="14" /> Collection offer</button>
        </div>
      </div>
    </section>

    <p v-if="meta?.description" class="text-[14px] text-soft max-w-[80ch] -mt-2 cursor-pointer" :class="descOpen ? '' : 'line-clamp-2'" @click="descOpen = !descOpen">
      {{ meta.description }}
    </p>

    <!-- The numbers a trader checks first. -->
    <dl v-if="collection" class="flex flex-wrap gap-x-8 gap-y-3">
      <div class="stat rise-in" style="--i: 0"><dt class="ledger">Floor</dt><dd><b>{{ whole(collection.floor) }}</b> <span v-if="collection.floor !== null" class="text-[11.5px] text-dim">ZNN</span></dd></div>
      <div class="stat rise-in" style="--i: 1"><dt class="ledger">Top offer</dt><dd><b>{{ whole(collection.topBid) }}</b> <span v-if="collection.topBid !== null" class="text-[11.5px] text-dim">ZNN</span></dd></div>
      <div class="stat rise-in" style="--i: 2">
        <dt class="ledger">Total volume</dt>
        <dd><b>{{ whole(collection.volume) }}</b> <span class="text-[11.5px] text-dim">ZNN</span>
          <span v-if="usdOfZnn(collection.volume)" class="text-[11.5px] text-dim ml-1">{{ usd(usdOfZnn(collection.volume), {compact: true}) }}</span></dd>
      </div>
      <div class="stat rise-in" style="--i: 3"><dt class="ledger">24h volume</dt><dd><b>{{ whole(collection.volume24h) }}</b></dd></div>
      <div class="stat rise-in" style="--i: 4"><dt class="ledger">Sales</dt><dd><b>{{ collection.sales.toLocaleString('en-US') }}</b></dd></div>
      <div class="stat rise-in" style="--i: 5"><dt class="ledger">Listed</dt><dd><b>{{ collection.items ? percent(collection.listed / collection.items) : '-' }}</b></dd></div>
      <div class="stat rise-in" style="--i: 6"><dt class="ledger">Owners</dt><dd><b>{{ collection.owners.toLocaleString('en-US') }}</b> <span class="text-[11.5px] text-dim">{{ collection.items ? percent(collection.owners / collection.items) : '' }} unique</span></dd></div>
      <div class="stat rise-in" style="--i: 7"><dt class="ledger">Items</dt><dd><b>{{ collection.items.toLocaleString('en-US') }}</b></dd></div>
    </dl>

    <Tabs v-model="tab" :tabs="tabs" />

    <!-- Items -->
    <section v-if="tab === 'items'" class="grid gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn" :class="filtersOpen ? '!border-[color-mix(in_srgb,var(--znn)_45%,transparent)]' : ''" @click="filtersOpen = !filtersOpen">
          <Icon name="filter" :size="14" /> Filters
          <span v-if="activeFilters" class="chip" style="background: var(--znn); color: #04140a">{{ activeFilters }}</span>
        </button>
        <div class="relative grow min-w-[160px] max-w-[360px]">
          <Icon name="search" :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input v-model="q" class="input !pl-8 !rounded-full" placeholder="Name or token id" />
        </div>
        <label class="flex items-center gap-2 text-[13px] text-soft cursor-pointer px-2">
          <input v-model="listedOnly" type="checkbox" class="check" /> Listed only
        </label>
        <span class="grow" />
        <select v-model="sort" class="input !w-auto !rounded-full !py-1.5 !font-sans cursor-pointer" aria-label="Sort">
          <option v-for="s in SORTS" :key="s.v" :value="s.v">{{ s.label }}</option>
        </select>
        <div class="seg">
          <button :class="{on: !dense}" title="Large grid" @click="dense = false"><Icon name="grid" :size="14" /></button>
          <button :class="{on: dense}" title="Dense grid" @click="dense = true"><Icon name="gridSmall" :size="14" /></button>
        </div>
      </div>

      <!-- Sweep: Magic Eden's slider, over the cheapest fillable listings. -->
      <div v-if="sweepable.length" class="card px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-2 text-[13.5px] font-medium"><Icon name="broom" :size="16" style="color: var(--znn-ink)" /> Sweep the floor</span>
        <input
          v-model.number="sweepN"
          type="range"
          min="0"
          :max="Math.min(20, sweepable.length)"
          class="range grow min-w-[140px] max-w-[360px]"
          :style="{'--fill': `${(sweepN / Math.min(20, sweepable.length)) * 100}%`}"
          aria-label="How many to sweep"
        />
        <span class="num text-[13px] w-16">{{ sweepN }} item{{ sweepN === 1 ? '' : 's' }}</span>
        <span class="text-[13px]">
          <Price v-if="sweepN" :raw="sweepTotal" :currency="null" size="sm" show-usd />
          <span v-else class="text-dim">Drag to pick the cheapest</span>
        </span>
        <button class="btn btn-plasma btn-sm ml-auto" :disabled="!sweepN" @click="sweep"><Icon name="cart" :size="13" /> Add {{ sweepN || '' }} to cart</button>
      </div>

      <div class="flex gap-5 items-start">
        <!-- Filters -->
        <Transition name="fade">
          <aside v-if="filtersOpen" class="w-[250px] shrink-0 sticky top-[76px] max-h-[calc(100vh-96px)] overflow-y-auto no-scrollbar grid gap-4 pb-6 max-lg:fixed max-lg:inset-0 max-lg:top-0 max-lg:z-50 max-lg:w-full max-lg:max-h-none max-lg:bg-raised max-lg:p-4">
            <div class="flex items-center justify-between lg:hidden">
              <span class="text-[16px] font-semibold">Filters</span>
              <button class="btn btn-sm btn-quiet" @click="filtersOpen = false"><Icon name="x" :size="15" /></button>
            </div>
            <div class="grid gap-2">
              <span class="ledger">Price, ZNN</span>
              <div class="flex items-center gap-2">
                <input v-model="minPrice" class="input" inputmode="decimal" placeholder="Min" />
                <span class="text-dim">to</span>
                <input v-model="maxPrice" class="input" inputmode="decimal" placeholder="Max" />
              </div>
            </div>
            <div v-if="rarity.traits.length" class="grid gap-1">
              <span class="ledger flex items-center justify-between">
                Traits
                <span v-if="!rarityExact" class="normal-case tracking-normal text-[11px]" title="Counts are over the items loaded so far">sample of {{ items.length }}</span>
              </span>
              <div v-for="t in rarity.traits" :key="t.type" class="border-b border-line">
                <button class="w-full flex items-center justify-between py-2.5 text-[13.5px]" @click="openTrait = openTrait === t.type ? null : t.type">
                  <span>{{ t.type }}</span>
                  <span class="flex items-center gap-2 text-dim">
                    <span v-if="picked[t.type]?.length" class="chip" style="background: var(--znn); color: #04140a">{{ picked[t.type].length }}</span>
                    <span class="mono text-[11.5px]">{{ t.values.length }}</span>
                    <Icon :name="openTrait === t.type ? 'up' : 'down'" :size="13" />
                  </span>
                </button>
                <div v-if="openTrait === t.type" class="grid gap-0.5 pb-2 fade-in">
                  <label v-for="v in t.values" :key="v.value" class="flex items-center gap-2.5 px-1.5 py-1.5 rounded hover:bg-surface cursor-pointer text-[13px]">
                    <input type="checkbox" class="check" :checked="picked[t.type]?.includes(v.value)" @change="toggleTrait(t.type, v.value)" />
                    <span class="grow truncate">{{ v.value }}</span>
                    <span class="mono text-[11.5px] text-dim">{{ v.count }}</span>
                    <span class="mono text-[11px] text-dim w-10 text-right">{{ percent(v.share) }}</span>
                  </label>
                </div>
              </div>
            </div>
            <button v-if="activeFilters || q" class="btn btn-sm" @click="clearFilters">Clear all filters</button>
          </aside>
        </Transition>

        <div class="grow min-w-0 grid gap-3">
          <div class="flex items-center justify-between text-[12.5px] text-dim">
            <span>
              <span class="num text-soft">{{ shown.length.toLocaleString('en-US') }}</span> shown
              <template v-if="collection && items.length < collection.items"> of {{ collection.items.toLocaleString('en-US') }}</template>
            </span>
            <span v-if="!rarityExact && rarity.traits.length" class="hidden sm:inline">Rarity ranks are over the {{ items.length }} items loaded.</span>
          </div>

          <div
            class="grid gap-3"
            :class="dense ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5'"
          >
            <template v-if="loading">
              <div v-for="n in 10" :key="n" class="grid gap-2"><div class="skeleton aspect-square !rounded-[10px]" /><div class="skeleton h-4 w-2/3" /></div>
            </template>
            <NftCard
              v-for="(it, i) in shown"
              :key="it.tokenId"
              :collection="address"
              :token-id="it.tokenId"
              :name="it.name"
              :image="it.image"
              :owner="it.owner"
              :listing="it.listing"
              :rank="rarity.traits.length ? rarity.rank.get(it.tokenId) : undefined"
              :total="rarity.sample"
              :compact="dense"
              :index="i"
              :class="sweepIds.has(it.tokenId) ? 'picked' : ''"
            />
          </div>

          <div v-if="!loading && !shown.length" class="card p-10 text-center text-[13.5px] text-dim">
            Nothing matches. <button v-if="activeFilters || q || listedOnly" class="link" @click="clearFilters(); listedOnly = false">Clear the filters</button>
          </div>
          <div ref="sentinel" class="h-10 grid place-items-center">
            <Icon v-if="loadingMore && !loading" name="refresh" :size="16" class="spin text-dim" />
          </div>
        </div>
      </div>
    </section>

    <!-- Activity -->
    <ActivityList v-if="tab === 'activity'" :rows="activity" :show-collection="false" :images="images" :loading="activityLoading" />

    <!-- Offers -->
    <section v-if="tab === 'offers'" class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-[13px] text-dim max-w-[70ch]">
          A collection offer takes any one item. Nothing is escrowed: each is backed by wrapped ZNN and an allowance, which the node checks
          before listing it here.
        </p>
        <button class="btn btn-plasma btn-sm" @click="offering = true"><Icon name="hand" :size="13" /> Make a collection offer</button>
      </div>
      <div class="panel overflow-x-auto">
        <table class="w-full min-w-[560px] border-collapse text-[13.5px]">
          <thead><tr><th class="th">Price each</th><th class="th">Quantity</th><th class="th">From</th><th class="th">Expires</th><th class="th" /></tr></thead>
          <TransitionGroup tag="tbody" name="list">
            <tr v-for="o in offers" :key="o.hash">
              <td class="td"><Price :raw="o.price" :currency="o.paymentToken" show-usd /></td>
              <td class="td num">{{ o.quantity - o.filled }} <span class="text-dim">of {{ o.quantity }}</span></td>
              <td class="td"><Addr :address="o.bidder" avatar /></td>
              <td class="td text-dim">in {{ until(o.expiry) }}</td>
              <td class="td text-right">
                <button v-if="same(o.bidder, wallet.address)" class="btn btn-sm" :disabled="market.busy.value" @click="cancelOffer(o)">Withdraw</button>
                <button v-else-if="heldHere.length" class="btn btn-sm btn-plasma" :disabled="market.busy.value" @click="acceptCollectionOffer(o)">Accept</button>
              </td>
            </tr>
            <tr v-if="!offers.length" key="none"><td colspan="5" class="td text-center text-dim py-10">No collection offers yet. Be the first.</td></tr>
          </TransitionGroup>
        </table>
      </div>
      <StepRail :steps="market.steps.value" />
    </section>

    <!-- Analytics -->
    <section v-if="tab === 'analytics'" class="grid gap-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div v-for="(s, i) in [
          {label: 'Average sale', v: analytics?.avg, plain: false},
          {label: 'Highest sale', v: analytics?.high, plain: false},
          {label: 'Lowest sale', v: analytics?.low, plain: false},
          {label: 'Sales charted', v: analytics?.n, plain: true},
        ]" :key="s.label" class="card px-4 py-3 rise-in" :style="{'--i': i}">
          <div class="ledger">{{ s.label }}</div>
          <div class="text-[20px] font-semibold num">{{ s.v === undefined ? '-' : s.plain ? s.v : whole(s.v) }} <span v-if="!s.plain && s.v !== undefined" class="text-[12px] text-dim font-normal">ZNN</span></div>
        </div>
      </div>
      <div class="panel p-4 grid gap-2">
        <div class="flex items-center justify-between">
          <h3 class="ledger">Sales</h3>
          <span class="text-[12px] text-dim flex items-center gap-3">
            <span class="flex items-center gap-1.5"><span class="dot" style="background: var(--nom-ink)" /> a sale</span>
            <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-0.5" style="background: var(--znn-ink)" /> rolling median of five</span>
          </span>
        </div>
        <SalesChart :points="salePoints" :height="260" />
      </div>
      <div class="panel p-4 grid gap-3">
        <h3 class="ledger">Listings by price</h3>
        <div v-if="depth.length" class="flex items-end gap-1.5 h-[140px]">
          <div v-for="(b, i) in depth" :key="i" class="grow grid gap-1 justify-items-center h-full content-end" :title="`${b.count} listed from ${whole(b.from)} ZNN`">
            <span class="text-[10.5px] mono text-dim">{{ b.count || '' }}</span>
            <span class="w-full rounded-t-[4px] rise-in" :style="{height: `${(b.count / depthMax) * 100}%`, minHeight: b.count ? '4px' : '0', background: 'var(--plasma)', '--i': i}" />
            <span class="text-[10px] mono text-dim whitespace-nowrap">{{ whole(b.from) }}</span>
          </div>
        </div>
        <p v-else class="text-[13px] text-dim py-6 text-center">Nothing is listed.</p>
      </div>
    </section>

    <OfferDialog
      :open="offering"
      :collection="address"
      :collection-name="collection?.name"
      :image="meta?.image"
      :floor="collection?.floor"
      :top-bid="collection?.topBid"
      @close="offering = false"
      @done="loadSide"
    />
  </div>
</template>
