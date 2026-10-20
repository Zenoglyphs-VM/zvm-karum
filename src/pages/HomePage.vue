<script setup lang="ts">
// The front of the market: what is featured, what the whole market did, what
// is selling right now, and what was just listed.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {api, type Overview, type Sale} from '../core/api'
import {hasMarket} from '../core/endpoint'
import {catalog, dropPhase} from '../core/catalog'
import {pickFeatured} from '../core/featured'
import {onBlock} from '../core/chain'
import {ago, compact, whole, usd} from '../core/format'
import {usdOfZnn} from '../core/prices'
import HeroCarousel from '../components/HeroCarousel.vue'
import CollectionTable from '../components/CollectionTable.vue'
import NftCard from '../components/NftCard.vue'
import NftMedia from '../components/NftMedia.vue'
import CountUp from '../components/CountUp.vue'
import Price from '../components/Price.vue'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'
import Chip from '@zvm/web/components/Chip.vue'

const overview = ref<Overview | null>(null)
const loading = ref(true)
const error = ref('')
const window_ = ref<'24h' | 'all'>('all')
const freshSales = ref(new Set<string>())

async function load() {
  if (!hasMarket.value) {
    loading.value = false
    return
  }
  try {
    const next = await api.overview()
    // A sale that was not here last time flashes once in the ticker.
    if (overview.value) {
      const seen = new Set(overview.value.sales.map((s) => s.tx + s.tokenId))
      freshSales.value = new Set(next.sales.filter((s) => !seen.has(s.tx + s.tokenId)).map((s) => s.tx + s.tokenId))
    }
    overview.value = next
    error.value = ''
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

let off: (() => void) | undefined
onMounted(() => {
  void load()
  void loadWindowSales()
  off = onBlock(() => {
    void load()
    void loadWindowSales()
  })
})
onUnmounted(() => off?.())
watch(hasMarket, () => {
  salesAt = 0
  void load()
  void loadWindowSales()
})

// The featured set is decided by rule, not by this browser (core/featured.ts):
// the same chain gives every copy of Karum the same five. It needs the
// window's sales, which the overview's dozen does not cover, so the last 200
// are fetched separately and at most once a minute; the ranking moves on the
// hour, not on the block.
const windowSales = ref<Sale[]>([])
let salesAt = 0
async function loadWindowSales() {
  if (!hasMarket.value || Date.now() - salesAt < 60_000) return
  salesAt = Date.now()
  windowSales.value = await api.sales({limit: 200}).catch(() => windowSales.value)
}

const featured = computed(() =>
  pickFeatured(catalog.collections.length ? catalog.collections : overview.value?.collections ?? [], windowSales.value),
)

const tableRows = computed(() => (catalog.collections.length ? catalog.collections : overview.value?.collections ?? []))

// The ticker repeats its list once so the loop is seamless: the animation
// moves exactly half its width, and the second half is the first again.
const ticker = computed<Sale[]>(() => {
  const s = overview.value?.sales ?? []
  return s.length ? [...s, ...s] : []
})

const liveDrops = computed(() => catalog.drops.filter((d) => ['live', 'upcoming'].includes(dropPhase(d))).slice(0, 4))
const nameOf = (addr: string) => catalog.collections.find((c) => c.address.toLowerCase() === addr.toLowerCase())
</script>

<template>
  <div class="grid gap-10">
    <HeroCarousel :featured="featured" />

    <!-- The whole market, in six numbers. -->
    <section class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px rounded-[12px] overflow-hidden border border-line bg-line">
      <div v-for="(s, i) in [
        {label: 'All-time volume', v: overview?.totals.volume ?? null, znn: true},
        {label: '24h volume', v: overview?.totals.volume24h ?? 0, znn: true},
        {label: 'Sales', v: overview?.totals.sales ?? null, znn: false},
        {label: 'Collections', v: overview?.totals.collections ?? null, znn: false},
        {label: 'Items', v: overview?.totals.items ?? null, znn: false},
        {label: 'Listed now', v: overview?.totals.listed ?? null, znn: false},
      ]" :key="s.label" class="bg-surface px-4 py-3.5 rise-in" :style="{'--i': i}">
        <div class="ledger">{{ s.label }}</div>
        <div class="text-[20px] font-semibold tracking-[-0.02em] mt-0.5">
          <CountUp :value="s.v" :format="(n: number) => (s.znn ? whole(n) : n >= 10000 ? compact(n) : Math.round(n).toLocaleString('en-US'))" />
          <span v-if="s.znn" class="text-[12px] text-dim font-normal ml-1">ZNN</span>
        </div>
        <div v-if="s.znn && usdOfZnn(s.v)" class="text-[11.5px] text-dim num">{{ usd(usdOfZnn(s.v), {compact: true}) }}</div>
      </div>
    </section>

    <!-- Just sold, moving past. -->
    <!-- The ends fade with a mask on the track itself, not with overlays on
         top of it: an overlay caught the clicks, so a chip sliding under
         either end could be seen and not pressed. -->
    <section v-if="ticker.length" class="relative -mx-4 overflow-hidden border-y border-line bg-surface/60 py-2.5" style="--marquee-s: 70s">
      <div class="ticker-track">
      <div class="marquee gap-3 pl-4">
        <router-link
          v-for="(s, i) in ticker"
          :key="i"
          :to="`/item/${s.collection}/${s.tokenId}`"
          class="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full border border-line bg-bg hover:border-line-strong transition-colors shrink-0"
          :class="freshSales.has(s.tx + s.tokenId) ? 'ring-1 ring-[var(--new-ink)]' : ''"
        >
          <span class="w-7 h-7 rounded-full overflow-hidden"><NftMedia :src="s.image" :seed="`${s.collection}:${s.tokenId}`" /></span>
          <span class="text-[12.5px] max-w-[18ch] truncate">{{ s.name || `#${s.tokenId}` }}</span>
          <Price :raw="s.price" :currency="s.currency" size="sm" />
          <span class="text-[11px] text-dim">{{ ago(s.timestamp) }}</span>
        </router-link>
      </div>
      </div>
    </section>

    <!-- Top collections. -->
    <section class="shelf grid gap-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 class="text-[22px] font-semibold tracking-[-0.02em] flex items-center gap-2">
          <Icon name="trophy" :size="20" style="color: var(--warn)" /> Top collections
          <InfoTip text="Ranked by volume traded in ZNN on this chain." />
        </h2>
        <div class="flex items-center gap-2">
          <div class="seg">
            <button :class="{on: window_ === '24h'}" @click="window_ = '24h'">24h</button>
            <button :class="{on: window_ === 'all'}" @click="window_ = 'all'">All time</button>
          </div>
          <router-link to="/collections" class="btn btn-sm">View all <Icon name="arrow" :size="13" /></router-link>
        </div>
      </div>
      <CollectionTable :rows="tableRows" :loading="loading || !catalog.loaded" :limit="8" :window="window_" />
    </section>

    <!-- Drops, when there are any. -->
    <section v-if="liveDrops.length" class="shelf grid gap-4">
      <div class="flex items-end justify-between gap-3">
        <h2 class="text-[22px] font-semibold tracking-[-0.02em] flex items-center gap-2"><Icon name="rocket" :size="20" style="color: var(--nom-ink)" /> Drops</h2>
        <router-link to="/drops" class="btn btn-sm">All drops <Icon name="arrow" :size="13" /></router-link>
      </div>
      <!-- Two across even on a phone: one drop per row made four of them a
           screen and a half of artwork before the next shelf. -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <router-link
          v-for="(d, i) in liveDrops"
          :key="d.collection"
          to="/drops"
          class="nft-card rise-in"
          :class="dropPhase(d) === 'live' ? 'ring-live' : ''"
          :style="{'--i': i}"
        >
          <div class="art aspect-[4/3] overflow-hidden"><NftMedia :src="nameOf(d.collection)?.meta?.image" :seed="d.collection" /></div>
          <div class="p-3 grid gap-1.5">
            <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
              <span class="font-medium truncate min-w-0">{{ nameOf(d.collection)?.name ?? d.collection }}</span>
              <Chip :tone="dropPhase(d) === 'live' ? 'l2' : 'l1'" dot>{{ dropPhase(d) === 'live' ? 'Minting' : 'Soon' }}</Chip>
            </div>
            <Price :raw="d.price" :currency="null" size="sm" />
          </div>
        </router-link>
      </div>
    </section>

    <!-- Just listed. The rail bleeds to the shelf's edge, so the shelf clips it. -->
    <section class="shelf overflow-hidden grid gap-4">
      <div class="flex items-end justify-between gap-3">
        <h2 class="text-[22px] font-semibold tracking-[-0.02em] flex items-center gap-2">
          <Icon name="sparkles" :size="20" style="color: var(--znn-ink)" /> Fresh listings
          <InfoTip text="Signed in the last few momentums. Listing here costs nothing, so the book moves fast." />
        </h2>
        <router-link to="/activity" class="btn btn-sm">Live activity <Icon name="arrow" :size="13" /></router-link>
      </div>
      <div class="flex gap-4 overflow-x-auto pb-2 snap-rail no-scrollbar -mx-4 px-4">
        <template v-if="loading">
          <div v-for="n in 6" :key="n" class="w-[210px] shrink-0 grid gap-2"><div class="skeleton aspect-square !rounded-[10px]" /><div class="skeleton h-4 w-2/3" /></div>
        </template>
        <div v-for="(l, i) in overview?.listings ?? []" :key="l.hash" class="w-[210px] shrink-0">
          <NftCard
            :collection="l.collection"
            :token-id="l.tokenId ?? ''"
            :name="l.name"
            :image="l.image"
            :collection-name="l.collectionName"
            :owner="l.trader"
            :listing="{hash: l.hash, exchange: l.exchange, price: l.price, priceNum: l.priceNum, currency: l.paymentToken, seller: l.trader}"
            :index="i"
          />
        </div>
        <p v-if="!loading && !overview?.listings.length" class="text-[13px] text-dim py-8">Nothing is listed on this node right now.</p>
      </div>
    </section>

    <!-- What is different here, said once. -->
    <section class="grid md:grid-cols-3 gap-4">
      <div v-for="(f, i) in [
        {icon: 'tag', title: 'Listing is free', body: 'A listing is a signature, not a transaction. List one item or fifty with a single wallet prompt, and pay nothing until it sells.'},
        {icon: 'cart', title: 'One momentum per cart', body: 'Everything in your cart is bought in one transaction. Zenon orders it into the next momentum, and the ZVM executes it in the one after.'},
        {icon: 'layers', title: 'No public mempool', body: 'A relayer posts your purchase straight to Zenon, and a momentum fixes its order. There is no pool of pending transactions for a bot to read and jump.'},
      ]" :key="f.title" class="card p-5 grid gap-2 rise-in" :style="{'--i': i}">
        <span class="w-9 h-9 grid place-items-center rounded-[8px]" style="background: color-mix(in srgb, var(--znn) 12%, transparent); color: var(--znn-ink)"><Icon :name="(f.icon as any)" :size="17" /></span>
        <h3 class="text-[15px] font-semibold">{{ f.title }}</h3>
        <p class="text-[13px] text-soft">{{ f.body }}</p>
      </div>
    </section>

    <p v-if="error" class="text-[13px]" style="color: var(--danger)">{{ error }}</p>
  </div>
</template>
