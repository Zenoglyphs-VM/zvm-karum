<script setup lang="ts">
// What happened, newest first: sales, accepted offers, listings, offers and
// transfers, with a filter chip per kind.
//
// A sale is also a Transfer in the same transaction, and the node reports
// both. Showing both reads as the item moving twice, so a transfer sharing a
// transaction with a sale is folded into the sale.
import {computed, ref} from 'vue'
import type {Activity, ActivityKind} from '../core/api'
import {catalog} from '../core/catalog'
import {ago, isZero} from '../core/format'
import {explorerUrl} from '../core/endpoint'
import Addr from './Addr.vue'
import Price from './Price.vue'
import Icon from './Icon.vue'
import NftMedia from './NftMedia.vue'
import Chip from '@zvm/web/components/Chip.vue'

const props = withDefaults(defineProps<{rows: Activity[]; showCollection?: boolean; images?: Record<string, string>; loading?: boolean}>(), {
  showCollection: true,
  images: () => ({}),
  loading: false,
})

type Filter = 'all' | 'sale' | 'list' | 'offer' | 'transfer'
const filter = ref<Filter>('all')

const LABEL: Record<ActivityKind, string> = {
  sale: 'Sale',
  'bid-accepted': 'Offer taken',
  list: 'Listing',
  offer: 'Offer',
  transfer: 'Transfer',
}
const TONE: Record<ActivityKind, 'l2' | 'new' | 'l1' | 'plain'> = {sale: 'l2', 'bid-accepted': 'l2', list: 'l1', offer: 'new', transfer: 'plain'}
const ICON: Record<ActivityKind, 'cart' | 'hand' | 'tag' | 'send'> = {sale: 'cart', 'bid-accepted': 'hand', list: 'tag', offer: 'hand', transfer: 'send'}

const rows = computed(() => {
  const saleTx = new Set(props.rows.filter((r) => r.kind === 'sale' || r.kind === 'bid-accepted').map((r) => r.tx))
  return props.rows
    .filter((r) => !(r.kind === 'transfer' && r.tx && saleTx.has(r.tx)))
    .filter((r) => {
      if (filter.value === 'all') return true
      if (filter.value === 'sale') return r.kind === 'sale' || r.kind === 'bid-accepted'
      return r.kind === filter.value
    })
})

const nameOf = (addr: string) => catalog.collections.find((c) => c.address.toLowerCase() === addr.toLowerCase())?.name ?? ''
const kindLabel = (r: Activity) => (r.kind === 'transfer' && isZero(r.from) ? 'Mint' : LABEL[r.kind])
const link = (r: Activity) => (r.tx ? explorerUrl(`/tx/${r.tx}`) : null)
</script>

<template>
  <div class="grid gap-3">
    <div class="seg justify-self-start overflow-x-auto no-scrollbar max-w-full">
      <button v-for="f in (['all', 'sale', 'list', 'offer', 'transfer'] as Filter[])" :key="f" :class="{on: filter === f}" @click="filter = f">
        {{ f === 'all' ? 'All' : f === 'sale' ? 'Sales' : f === 'list' ? 'Listings' : f === 'offer' ? 'Offers' : 'Transfers' }}
      </button>
    </div>

    <div class="panel overflow-x-auto">
      <table class="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th class="th">Event</th>
            <th class="th">Item</th>
            <th class="th">Price</th>
            <th class="th">From</th>
            <th class="th">To</th>
            <th class="th text-right">When</th>
          </tr>
        </thead>
        <TransitionGroup tag="tbody" name="list">
          <tr v-if="loading && !rows.length" key="loading">
            <td v-for="n in 6" :key="n" class="td"><div class="skeleton h-4 w-full" /></td>
          </tr>
          <tr v-for="r in rows" :key="`${r.kind}:${r.tx ?? r.order}:${r.tokenId}`">
            <td class="td whitespace-nowrap">
              <Chip :tone="TONE[r.kind]" dot>
                <Icon :name="ICON[r.kind]" :size="11" />
                {{ kindLabel(r) }}
              </Chip>
            </td>
            <td class="td">
              <router-link
                v-if="r.tokenId"
                :to="`/item/${r.collection}/${r.tokenId}`"
                class="flex items-center gap-2.5 min-w-0 hover:text-fg"
              >
                <span class="w-8 h-8 rounded-[5px] overflow-hidden shrink-0">
                  <NftMedia :src="images[`${r.collection.toLowerCase()}:${r.tokenId}`]" :seed="`${r.collection}:${r.tokenId}`" />
                </span>
                <span class="min-w-0">
                  <span class="block truncate font-medium">#{{ r.tokenId }}</span>
                  <span v-if="showCollection" class="block truncate text-[11.5px] text-dim">{{ nameOf(r.collection) }}</span>
                </span>
              </router-link>
              <router-link v-else :to="`/collection/${r.collection}`" class="flex items-center gap-2.5">
                <span class="w-8 h-8 rounded-[5px] grid place-items-center bg-sunk border border-line"><Icon name="layers" :size="14" class="text-dim" /></span>
                <span class="min-w-0">
                  <span class="block truncate font-medium">Any item</span>
                  <span v-if="showCollection" class="block truncate text-[11.5px] text-dim">{{ nameOf(r.collection) }}</span>
                </span>
              </router-link>
            </td>
            <td class="td"><Price v-if="r.price" :raw="r.price" :currency="r.currency" size="sm" /><span v-else class="text-dim">-</span></td>
            <td class="td"><Addr :address="r.from" /></td>
            <td class="td"><Addr v-if="r.to" :address="r.to" /><span v-else class="text-dim">-</span></td>
            <td class="td text-right whitespace-nowrap text-dim">
              <a v-if="link(r)" :href="link(r)!" target="_blank" rel="noreferrer noopener" class="link inline-flex items-center gap-1">
                {{ ago(r.timestamp) }} <Icon name="external" :size="11" />
              </a>
              <span v-else>{{ ago(r.timestamp) }}</span>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length" key="empty">
            <td colspan="6" class="td text-center text-dim py-10">Nothing here yet.</td>
          </tr>
        </TransitionGroup>
      </table>
    </div>
  </div>
</template>
