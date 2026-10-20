<script setup lang="ts">
// An account: what it holds, what it has listed, the offers it made and the
// ones it could take, the collections it created, and what it has done.
//
// On your own profile the grid becomes a workbench: select any number of items
// and list them with one signature (a bulk listing over a Merkle root), or
// cancel every order you have ever signed with one transaction, which bumps
// your nonce on the exchange and voids them all at once.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {Address} from 'viem'
import {api, type Account, type BidRow, type Listable, type OrderRow} from '../core/api'
import {endpoint, explorerUrl, hasMarket} from '../core/endpoint'
import {cachedName, nameOf, znsLink} from '@zvm/web/names'
import {wallet} from '../core/wallet'
import {onBlock} from '../core/chain'
import {byAddress} from '../core/catalog'
import {priceOf, same, short, until, whole, usd} from '../core/format'
import {usdOfZnn} from '../core/prices'
import {approvalFor, useMarket} from '../core/market'
import {acceptBidCall, cancelOrdersCall, fetchInput, fromWire, incrementNonceCall} from '../core/orders'
import NftCard from '../components/NftCard.vue'
import NftMedia from '../components/NftMedia.vue'
import Avatar from '../components/Avatar.vue'
import Addr from '../components/Addr.vue'
import Price from '../components/Price.vue'
import Tabs from '../components/Tabs.vue'
import ActivityList from '../components/ActivityList.vue'
import ListDialog from '../components/ListDialog.vue'
import StepRail from '../components/StepRail.vue'
import Icon from '../components/Icon.vue'
import Chip from '@zvm/web/components/Chip.vue'

const route = useRoute()
const address = computed(() => String(route.params.address))
// The account's ZNS primary name, when it has one that points back at it.
const zns = computed(() => cachedName(address.value))
watch(() => [address.value, endpoint.chainId] as const, ([a, chainId]) => nameOf(chainId, a), {immediate: true})
const account = ref<Account | null>(null)
const loading = ref(true)
const error = ref('')
const tab = ref<'collected' | 'listings' | 'offers-made' | 'offers-received' | 'created' | 'activity'>('collected')
const selecting = ref(false)
const selected = ref<Set<string>>(new Set())
const listing_ = ref(false)
const q = ref('')
const copied = ref(false)

const market = useMarket()
const mine = computed(() => same(address.value, wallet.address))

async function load(quiet = false) {
  if (!hasMarket.value) return
  if (!quiet) loading.value = true
  try {
    account.value = await api.account(address.value)
    error.value = ''
  } catch (err: any) {
    if (!quiet) error.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

let off: (() => void) | undefined
onMounted(() => {
  void load()
  off = onBlock(() => !market.busy.value && void load(true))
})
onUnmounted(() => off?.())
watch(address, () => {
  selected.value = new Set()
  selecting.value = false
  void load()
})
watch(hasMarket, (v) => v && void load())

const owned = computed(() => {
  const s = q.value.trim().toLowerCase()
  return (account.value?.owned ?? []).filter((o) => !s || o.name.toLowerCase().includes(s) || o.collectionName.toLowerCase().includes(s) || o.tokenId === s)
})

// What the holdings are worth at each collection's floor: the number a
// portfolio page leads with, and an honest one only because it says "at floor".
const floorValue = computed(() => {
  let sum = 0
  for (const o of account.value?.owned ?? []) sum += byAddress(o.collection)?.floor ?? 0
  return sum
})

const keyOf = (o: {collection: string; tokenId: string}) => `${o.collection.toLowerCase()}:${o.tokenId}`

function pick(o: {collection: string; tokenId: string}) {
  const k = keyOf(o)
  const next = new Set(selected.value)
  next.has(k) ? next.delete(k) : next.add(k)
  selected.value = next
}

function selectAll() {
  selected.value = new Set(owned.value.filter((o) => !o.listing).map(keyOf))
}

const toList = computed<Listable[]>(() =>
  (account.value?.owned ?? [])
    .filter((o) => selected.value.has(keyOf(o)))
    .map((o) => ({collection: o.collection, collectionName: o.collectionName, tokenId: o.tokenId, name: o.name || `#${o.tokenId}`, image: o.image})),
)

const listFloor = computed(() => {
  const cs = new Set(toList.value.map((i) => i.collection.toLowerCase()))
  return cs.size === 1 ? byAddress([...cs][0])?.floor ?? null : null
})

async function afterList() {
  selected.value = new Set()
  selecting.value = false
  await load(true)
}

async function cancel(o: OrderRow | BidRow) {
  await market.run(async () => [cancelOrdersCall([(await fetchInput(o.hash)).order], 'Cancel the order')], {success: 'Cancelled.', after: () => load(true)})
}

async function cancelAllListed() {
  // Cancelling the listed ones by name, rather than bumping the nonce, leaves
  // any offers standing.
  const rows = account.value?.listings ?? []
  if (!rows.length) return
  await market.run(
    async () => {
      const orders = await Promise.all(rows.map(async (r) => fromWire((await api.order(r.hash)).input.order)))
      return [cancelOrdersCall(orders, `Cancel ${rows.length} listing${rows.length === 1 ? '' : 's'}`)]
    },
    {success: 'Listings cancelled.', after: () => load(true)},
  )
}

async function cancelEverything() {
  await market.run(() => [incrementNonceCall()], {success: 'Every order you had signed is void.', after: () => load(true)})
}

async function accept(o: BidRow) {
  const owner = wallet.address as Address
  const held = (account.value?.owned ?? []).filter((t) => same(t.collection, o.collection))
  const token = o.tokenId ? held.find((t) => t.tokenId === o.tokenId) : held.find((t) => !t.listing) ?? held[0]
  if (!token) return
  await market.run(
    async () => {
      const input = await fetchInput(o.hash)
      return [
        ...(await approvalFor(o.collection as Address, owner, token.collectionName || 'this collection')),
        acceptBidCall(input, BigInt(token.tokenId), `Sell ${token.name || `#${token.tokenId}`} for ${priceOf(o.price, o.paymentToken)} ZNN`),
      ]
    },
    {success: `Sold ${token.name || `#${token.tokenId}`}.`, after: () => load(true)},
  )
}

async function copy() {
  try {
    await navigator.clipboard.writeText(address.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    /* the address is on screen to select */
  }
}

const tabs = computed(() => [
  {id: 'collected', label: 'Collected', count: account.value?.owned.length ?? null},
  {id: 'listings', label: 'Listings', count: account.value?.listings.length ?? null},
  {id: 'offers-made', label: 'Offers made', count: account.value?.offersMade.length ?? null},
  {id: 'offers-received', label: 'Offers received', count: account.value?.offersReceived.length ?? null},
  {id: 'created', label: 'Created', count: account.value?.created.length ?? null},
  {id: 'activity', label: 'Activity'},
])

const images = computed(() =>
  Object.fromEntries([...(account.value?.owned ?? []), ...(account.value?.listings ?? [])].map((o: any) => [`${o.collection.toLowerCase()}:${o.tokenId}`, o.image])),
)
</script>

<template>
  <div class="grid gap-6">
    <!-- No banner: a profile has nothing a person can set, so a banner would
         be decoration pretending to be theirs. The header is the face the
         address draws, who it is, and what it holds. -->
    <section class="card p-5 md:p-6 flex flex-wrap items-center gap-x-8 gap-y-5">
      <div class="flex items-center gap-4 min-w-0 grow">
        <Avatar :seed="address" :size="88" class="ring-1 ring-line-strong shadow-lg" />
        <div class="min-w-0 grid gap-1.5">
          <h1 class="text-[24px] md:text-[30px] font-semibold tracking-[-0.03em] leading-tight flex items-center gap-2">
            <span class="truncate" :title="address">{{ zns ?? (mine ? 'Your profile' : short(address, 6, 4)) }}</span>
            <button class="icon-btn !w-8 !h-8 text-dim hover:text-fg" :title="copied ? 'Copied' : 'Copy address'" @click="copy">
              <Icon :name="copied ? 'check' : 'copy'" :size="15" />
            </button>
            <Chip v-if="mine" tone="l2" dot>you</Chip>
          </h1>
          <a v-if="zns && endpoint.chainId && znsLink(endpoint.chainId, zns)" class="link text-[12.5px] justify-self-start" :href="znsLink(endpoint.chainId, zns)!" target="_blank" rel="noopener">Its ZNS name</a>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-soft">
            <span v-if="mine" class="mono text-[12.5px]">{{ short(address, 6, 4) }}</span>
            <a v-if="explorerUrl(`/address/${address}`)" class="link inline-flex items-center gap-1" :href="explorerUrl(`/address/${address}`)!" target="_blank" rel="noreferrer noopener">
              Explorer <Icon name="external" :size="11" />
            </a>
          </div>
        </div>
      </div>

      <dl v-if="account" class="grid grid-cols-2 sm:grid-cols-5 gap-x-7 gap-y-3 w-full lg:w-auto">
        <div class="stat rise-in" style="--i: 0"><dt class="ledger">Items</dt><dd><b>{{ account.owned.length }}</b></dd></div>
        <div class="stat rise-in" style="--i: 1">
          <dt class="ledger">Value at floor</dt>
          <dd><b>{{ whole(floorValue) }}</b> <span class="text-[11.5px] text-dim">ZNN</span>
            <span v-if="usdOfZnn(floorValue)" class="block text-[11.5px] text-dim">{{ usd(usdOfZnn(floorValue), {compact: true}) }}</span></dd>
        </div>
        <div class="stat rise-in" style="--i: 2"><dt class="ledger">Listed</dt><dd><b>{{ account.listings.length }}</b></dd></div>
        <div class="stat rise-in" style="--i: 3"><dt class="ledger">Offers made</dt><dd><b>{{ account.offersMade.length }}</b></dd></div>
        <div class="stat rise-in" style="--i: 4"><dt class="ledger">Collections</dt><dd><b>{{ new Set(account.owned.map((o) => o.collection)).size }}</b></dd></div>
      </dl>
      <div v-else-if="loading" class="grid grid-cols-5 gap-7 w-full lg:w-auto">
        <div v-for="n in 5" :key="n" class="grid gap-1.5"><div class="skeleton h-3 w-14" /><div class="skeleton h-5 w-10" /></div>
      </div>
    </section>

    <p v-if="error" class="text-[13px]" style="color: var(--danger)">{{ error }}</p>

    <Tabs v-model="tab" :tabs="tabs" />

    <StepRail :steps="market.steps.value" />

    <!-- Collected -->
    <section v-if="tab === 'collected'" class="grid gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative grow max-w-[360px]">
          <Icon name="search" :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input v-model="q" class="input !pl-8 !rounded-full" placeholder="Filter by name or collection" />
        </div>
        <span class="grow" />
        <template v-if="mine">
          <button v-if="selecting" class="btn btn-sm btn-quiet" @click="selectAll">Select all unlisted</button>
          <button class="btn btn-sm" @click="selecting = !selecting; selected = new Set()">
            <Icon :name="selecting ? 'x' : 'check'" :size="13" /> {{ selecting ? 'Done' : 'Select to list' }}
          </button>
        </template>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <template v-if="loading">
          <div v-for="n in 12" :key="n" class="grid gap-2"><div class="skeleton aspect-square !rounded-[10px]" /><div class="skeleton h-4 w-2/3" /></div>
        </template>
        <NftCard
          v-for="(o, i) in owned"
          :key="keyOf(o)"
          :collection="o.collection"
          :token-id="o.tokenId"
          :name="o.name"
          :image="o.image"
          :collection-name="o.collectionName"
          :owner="address"
          :listing="o.listing"
          :selectable="selecting"
          :selected="selected.has(keyOf(o))"
          :index="i"
          @select="pick(o)"
        />
      </div>
      <div v-if="!loading && !owned.length" class="card p-10 text-center grid gap-2 justify-items-center">
        <Icon name="image" :size="22" class="text-dim" />
        <p class="text-[14px]">{{ mine ? 'You hold nothing on this chain yet.' : 'Nothing held on this chain.' }}</p>
        <router-link v-if="mine" to="/collections" class="btn btn-sm mt-1">Browse collections</router-link>
      </div>

      <!-- The bulk bar rises from the bottom while items are selected. -->
      <Transition name="toast">
        <div v-if="selecting && selected.size" class="fixed z-40 bottom-5 left-1/2 -translate-x-1/2 pop flex items-center gap-3 px-4 py-3 w-[min(560px,calc(100vw-24px))]">
          <span class="num font-semibold">{{ selected.size }}</span>
          <span class="text-[13px] text-soft grow">selected. Listing them all is one signature.</span>
          <button class="btn btn-sm btn-quiet" @click="selected = new Set()">Clear</button>
          <button class="btn btn-sm btn-plasma" @click="listing_ = true"><Icon name="tag" :size="13" /> List {{ selected.size }}</button>
        </div>
      </Transition>
    </section>

    <!-- Listings -->
    <section v-if="tab === 'listings'" class="grid gap-3">
      <div v-if="mine && account?.listings.length" class="flex flex-wrap justify-end gap-2">
        <button class="btn btn-sm" :disabled="market.busy.value" @click="cancelAllListed">Cancel these listings</button>
      </div>
      <div class="panel overflow-x-auto">
        <table class="w-full min-w-[560px] border-collapse text-[13.5px]">
          <thead><tr><th class="th">Item</th><th class="th">Price</th><th class="th">Expires</th><th class="th" /></tr></thead>
          <tbody>
            <tr v-for="l in account?.listings ?? []" :key="l.hash">
              <td class="td">
                <router-link :to="`/item/${l.collection}/${l.tokenId}`" class="flex items-center gap-2.5">
                  <span class="w-9 h-9 rounded-[6px] overflow-hidden"><NftMedia :src="l.image" :seed="`${l.collection}:${l.tokenId}`" /></span>
                  <span class="min-w-0"><span class="block truncate font-medium">{{ l.name || `#${l.tokenId}` }}</span><span class="block text-[11.5px] text-dim truncate">{{ l.collectionName }}</span></span>
                </router-link>
              </td>
              <td class="td"><Price :raw="l.price" :currency="l.paymentToken" size="sm" show-usd /></td>
              <td class="td text-dim">in {{ until(l.expiry) }}</td>
              <td class="td text-right"><button v-if="mine" class="btn btn-sm" :disabled="market.busy.value" @click="cancel(l)">Cancel</button></td>
            </tr>
            <tr v-if="!account?.listings.length"><td colspan="4" class="td text-center text-dim py-10">No listings.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Offers made / received -->
    <section v-if="tab === 'offers-made' || tab === 'offers-received'" class="grid gap-3">
      <div class="panel overflow-x-auto">
        <table class="w-full min-w-[600px] border-collapse text-[13.5px]">
          <thead><tr><th class="th">On</th><th class="th">Price</th><th class="th">{{ tab === 'offers-made' ? 'Left' : 'From' }}</th><th class="th">Expires</th><th class="th" /></tr></thead>
          <tbody>
            <tr v-for="o in tab === 'offers-made' ? account?.offersMade ?? [] : account?.offersReceived ?? []" :key="o.hash">
              <td class="td">
                <router-link :to="o.tokenId ? `/item/${o.collection}/${o.tokenId}` : `/collection/${o.collection}`" class="flex items-center gap-2.5">
                  <span class="w-9 h-9 rounded-[6px] overflow-hidden"><NftMedia :src="o.tokenId ? images[`${o.collection.toLowerCase()}:${o.tokenId}`] : byAddress(o.collection)?.meta?.image" :seed="`${o.collection}:${o.tokenId ?? ''}`" /></span>
                  <span class="min-w-0">
                    <span class="block truncate font-medium">{{ o.tokenId ? `#${o.tokenId}` : 'Any item' }}</span>
                    <span class="block text-[11.5px] text-dim truncate">{{ byAddress(o.collection)?.name ?? short(o.collection) }}</span>
                  </span>
                </router-link>
              </td>
              <td class="td"><Price :raw="o.price" :currency="o.paymentToken" size="sm" show-usd /></td>
              <td class="td">
                <span v-if="tab === 'offers-made'" class="num">{{ o.quantity - o.filled }} of {{ o.quantity }}</span>
                <Addr v-else :address="o.bidder" />
              </td>
              <td class="td text-dim">in {{ until(o.expiry) }}</td>
              <td class="td text-right">
                <template v-if="mine">
                  <button v-if="tab === 'offers-made'" class="btn btn-sm" :disabled="market.busy.value" @click="cancel(o)">Withdraw</button>
                  <button v-else class="btn btn-sm btn-plasma" :disabled="market.busy.value" @click="accept(o)">Accept</button>
                </template>
              </td>
            </tr>
            <tr v-if="!(tab === 'offers-made' ? account?.offersMade.length : account?.offersReceived.length)">
              <td colspan="5" class="td text-center text-dim py-10">None.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Created -->
    <section v-if="tab === 'created'" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <router-link v-for="(c, i) in account?.created ?? []" :key="c.address" :to="`/collection/${c.address}`" class="nft-card rise-in" :style="{'--i': i}">
        <div class="art aspect-[16/9] overflow-hidden"><NftMedia :src="c.meta?.image" :seed="c.address" /></div>
        <div class="p-3 flex items-center justify-between gap-2">
          <span class="font-medium truncate">{{ c.name }}</span>
          <span class="text-[12px] text-dim num">{{ c.items }} items · floor {{ whole(c.floor) }}</span>
        </div>
      </router-link>
      <p v-if="!account?.created.length" class="text-[13px] text-dim col-span-full py-8 text-center">
        No collections created. <router-link v-if="mine" to="/create" class="link">Create one</router-link>
      </p>
    </section>

    <ActivityList v-if="tab === 'activity'" :rows="account?.activity ?? []" :images="images" :loading="loading" />

    <!-- The escape hatch, on your own profile only. -->
    <section v-if="mine && account?.openOrders.length" class="card p-4 flex flex-wrap items-center gap-3 border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">
      <Icon name="alert" :size="16" style="color: var(--danger)" />
      <p class="text-[13px] text-soft grow min-w-[240px]">
        You have {{ account.openOrders.length }} signed order{{ account.openOrders.length === 1 ? '' : 's' }} open. One transaction voids every order you
        have ever signed on this exchange, listings and offers alike.
      </p>
      <button class="btn btn-sm" style="color: var(--danger)" :disabled="market.busy.value" @click="cancelEverything">Cancel all orders</button>
    </section>

    <ListDialog :open="listing_" :items="toList" :floor="listFloor" @close="listing_ = false" @done="afterList" />
  </div>
</template>
