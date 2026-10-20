<script setup lang="ts">
// Public mints: collections whose owner has opened a drop.
//
// A drop is set on the collection contract itself (setDrop: a price, a supply
// cap, a per-wallet cap and a window), and minting pays the owner directly.
// Nothing here goes through the exchange or the node's book, so a drop is read
// straight from the contracts with one multicall, and the mint is one
// transaction to the collection.
import {computed, onMounted, onUnmounted, ref} from 'vue'
import type {Address} from 'viem'
import {catalog, dropPhase, loadDrops, type Drop} from '../core/catalog'
import {useMarket} from '../core/market'
import {publicMintCall} from '../core/nft'
import {onBlock} from '../core/chain'
import {until, units} from '../core/format'
import {burst} from '../core/burst'
import NftMedia from '../components/NftMedia.vue'
import Price from '../components/Price.vue'
import StepRail from '../components/StepRail.vue'
import Icon from '../components/Icon.vue'
import Chip from '@zvm/web/components/Chip.vue'
import InfoTip from '../components/InfoTip.vue'

const market = useMarket()
const qty = ref<Record<string, number>>({})
const minting = ref<string | null>(null)
const now = ref(Date.now() / 1000)
const filter = ref<'live' | 'upcoming' | 'past'>('live')

let tick = 0
let off: (() => void) | undefined
onMounted(() => {
  tick = window.setInterval(() => (now.value = Date.now() / 1000), 1000)
  off = onBlock(() => !market.busy.value && void loadDrops())
})
onUnmounted(() => {
  clearInterval(tick)
  off?.()
})

const info = (d: Drop) => catalog.collections.find((c) => c.address.toLowerCase() === d.collection.toLowerCase())
const phase = (d: Drop) => {
  void now.value
  return dropPhase(d, now.value)
}

const shown = computed(() =>
  catalog.drops.filter((d) => {
    const p = phase(d)
    if (filter.value === 'live') return p === 'live'
    if (filter.value === 'upcoming') return p === 'upcoming'
    return p === 'ended' || p === 'sold-out'
  }),
)
const counts = computed(() => ({
  live: catalog.drops.filter((d) => phase(d) === 'live').length,
  upcoming: catalog.drops.filter((d) => phase(d) === 'upcoming').length,
  past: catalog.drops.filter((d) => ['ended', 'sold-out'].includes(phase(d))).length,
}))

const maxQty = (d: Drop) => {
  const left = d.maxSupply ? d.maxSupply - d.minted : 20
  return Math.max(1, Math.min(20, left, d.maxPerWallet || 20))
}

async function mint(d: Drop, el: EventTarget | null) {
  const n = qty.value[d.collection] ?? 1
  minting.value = d.collection
  const name = info(d)?.name ?? 'the drop'
  await market.run(() => [publicMintCall(d.collection as Address, n, d.price, `Mint ${n} from ${name}`)], {
    success: `Minted ${n} from ${name}.`,
    after: async () => {
      burst(el as Element)
      await loadDrops()
    },
  })
}
</script>

<template>
  <div class="shelf grid gap-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-[28px] font-semibold tracking-[-0.03em] flex items-center gap-2">
        Drops
        <InfoTip text="Mint straight from the collection's contract. The price goes to the creator; there is no marketplace fee on a mint." />
      </h1>
      <div class="seg">
        <button :class="{on: filter === 'live'}" @click="filter = 'live'">Live <span class="mono text-[11px] text-dim">{{ counts.live }}</span></button>
        <button :class="{on: filter === 'upcoming'}" @click="filter = 'upcoming'">Upcoming <span class="mono text-[11px] text-dim">{{ counts.upcoming }}</span></button>
        <button :class="{on: filter === 'past'}" @click="filter = 'past'">Past <span class="mono text-[11px] text-dim">{{ counts.past }}</span></button>
      </div>
    </div>

    <StepRail v-if="market.steps.value.length" :steps="market.steps.value" />

    <div v-if="!catalog.dropsLoaded" class="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
      <div v-for="n in 3" :key="n" class="skeleton h-[420px] !rounded-[12px]" />
    </div>

    <div v-else-if="shown.length" class="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
      <article
        v-for="(d, i) in shown"
        :key="d.collection"
        class="nft-card rise-in !rounded-[12px]"
        :class="phase(d) === 'live' ? 'ring-live' : ''"
        :style="{'--i': i}"
      >
        <router-link :to="`/collection/${d.collection}`" class="art relative aspect-[4/3] overflow-hidden block">
          <NftMedia :src="info(d)?.meta?.image" :seed="d.collection" />
          <span class="absolute top-3 left-3">
            <Chip :tone="phase(d) === 'live' ? 'l2' : phase(d) === 'upcoming' ? 'l1' : 'plain'" dot class="glass !border-transparent">
              {{ phase(d) === 'live' ? 'Minting now' : phase(d) === 'upcoming' ? `Starts in ${until(d.start)}` : phase(d) === 'sold-out' ? 'Sold out' : 'Ended' }}
            </Chip>
          </span>
        </router-link>
        <div class="p-4 grid gap-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-[17px] font-semibold truncate">{{ info(d)?.name ?? d.collection }}</h2>
              <p v-if="info(d)?.meta?.description" class="text-[12.5px] text-dim line-clamp-2">{{ info(d)?.meta?.description }}</p>
            </div>
            <Price :raw="d.price" :currency="null" size="lg" />
          </div>

          <div class="grid gap-1.5">
            <div class="flex justify-between text-[12px] text-dim">
              <span><span class="num text-fg">{{ d.minted.toLocaleString('en-US') }}</span> minted</span>
              <span v-if="d.maxSupply">of <span class="num">{{ d.maxSupply.toLocaleString('en-US') }}</span></span>
              <span v-else>open edition</span>
            </div>
            <div class="h-2 rounded-full bg-sunk overflow-hidden">
              <div
                class="h-full rounded-full transition-[width] duration-1000"
                :style="{width: d.maxSupply ? `${Math.min(100, (d.minted / d.maxSupply) * 100)}%` : '100%', background: 'var(--plasma)', opacity: d.maxSupply ? 1 : 0.25}"
              />
            </div>
            <div class="flex justify-between text-[11.5px] text-dim">
              <span v-if="d.maxPerWallet">Up to {{ d.maxPerWallet }} per wallet</span><span v-else>No wallet limit</span>
              <span v-if="d.end && phase(d) === 'live'">Ends in {{ until(d.end) }}</span>
            </div>
          </div>

          <div v-if="phase(d) === 'live'" class="flex items-center gap-2">
            <div class="flex items-center rounded-[6px] border border-line bg-sunk">
              <button class="px-2.5 py-2 text-dim hover:text-fg" :disabled="(qty[d.collection] ?? 1) <= 1" @click="qty[d.collection] = Math.max(1, (qty[d.collection] ?? 1) - 1)"><Icon name="minus" :size="13" /></button>
              <span class="num w-8 text-center">{{ qty[d.collection] ?? 1 }}</span>
              <button class="px-2.5 py-2 text-dim hover:text-fg" :disabled="(qty[d.collection] ?? 1) >= maxQty(d)" @click="qty[d.collection] = Math.min(maxQty(d), (qty[d.collection] ?? 1) + 1)"><Icon name="plus" :size="13" /></button>
            </div>
            <button class="btn btn-plasma grow !py-2.5" :disabled="market.busy.value" @click="mint(d, $event.currentTarget)">
              <Icon v-if="market.busy.value && minting === d.collection" name="refresh" :size="14" class="spin" />
              <Icon v-else name="sparkles" :size="14" />
              Mint for {{ units(d.price * BigInt(qty[d.collection] ?? 1), 18, 4) }} ZNN
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="card p-12 text-center grid gap-2 justify-items-center">
      <Icon name="rocket" :size="24" class="text-dim" />
      <p class="text-[14.5px]">No {{ filter === 'past' ? 'past' : filter }} drops on this node.</p>
      <p class="text-[13px] text-dim">A collection's owner opens one from the Create page.</p>
      <router-link to="/create?tab=drop" class="btn btn-sm mt-1">Open a drop</router-link>
    </div>
  </div>
</template>
