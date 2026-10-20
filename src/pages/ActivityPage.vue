<script setup lang="ts">
// The whole market as it happens: sales and fresh listings from every
// collection, refreshed on every block, with offers alongside.
//
// The node has no market-wide activity feed, only per collection and per
// account, so this is the recent sales and the recent listings merged by time.
// That is the part of activity a person watches live; the rest is on each
// collection's own page.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {api, type Activity, type OrderRow, type Sale} from '../core/api'
import {hasMarket} from '../core/endpoint'
import {onBlock} from '../core/chain'
import ActivityList from '../components/ActivityList.vue'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'

const sales = ref<Sale[]>([])
const listings = ref<OrderRow[]>([])
const loading = ref(true)
const live = ref(true)
const updated = ref<number | null>(null)

async function load() {
  if (!hasMarket.value) return
  try {
    const [s, l] = await Promise.all([api.sales({limit: 100}), api.listings({limit: 100})])
    sales.value = s
    listings.value = l
    updated.value = Date.now()
  } catch {
    /* the next block tries again */
  } finally {
    loading.value = false
  }
}

let off: (() => void) | undefined
onMounted(() => {
  void load()
  off = onBlock(() => live.value && void load())
})
onUnmounted(() => off?.())
watch(hasMarket, (v) => v && void load())

const rows = computed<Activity[]>(() =>
  [
    ...sales.value.map((s) => ({
      kind: (s.acceptedBid ? 'bid-accepted' : 'sale') as Activity['kind'],
      block: s.block,
      timestamp: s.timestamp,
      collection: s.collection,
      tokenId: s.tokenId,
      from: s.seller,
      to: s.buyer,
      price: s.price,
      currency: s.currency,
      tx: s.tx,
    })),
    ...listings.value.map((l) => ({
      kind: 'list' as const,
      block: l.block,
      timestamp: l.timestamp,
      collection: l.collection,
      tokenId: l.tokenId ?? '',
      from: l.trader,
      to: '',
      price: l.price,
      currency: l.paymentToken,
      order: l.hash,
    })),
  ].sort((a, b) => b.block - a.block || b.timestamp - a.timestamp),
)

const images = computed(() =>
  Object.fromEntries([...sales.value, ...listings.value].map((r: any) => [`${r.collection.toLowerCase()}:${r.tokenId}`, r.image])),
)
</script>

<template>
  <div class="shelf grid gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-[28px] font-semibold tracking-[-0.03em] flex items-center gap-2.5">
        Activity
        <InfoTip text="Sales and listings across every collection, updated on every block." />
        <span v-if="live" class="chip" style="color: var(--znn-ink); background: color-mix(in srgb, var(--znn) 12%, transparent)">
          <span class="dot live-dot" style="background: var(--znn-ink)" /> Live
        </span>
      </h1>
      <button class="btn btn-sm" @click="live = !live">
        <Icon :name="live ? 'clock' : 'refresh'" :size="13" /> {{ live ? 'Pause' : 'Resume' }}
      </button>
    </div>
    <ActivityList :rows="rows" :images="images" :loading="loading" />
  </div>
</template>
