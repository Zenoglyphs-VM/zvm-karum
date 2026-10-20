<script setup lang="ts">
// One item in a grid. The whole card links to the item; the controls on it
// (the star, the cart, Buy now) stop the click from also following the link.
//
// Buy now does not send a transaction from the card. It puts the listing in
// the cart and opens it, so there is one checkout on the site, and it is the
// one place that shows the total, the fee and what the wallet will be asked.
import {computed, ref} from 'vue'
import type {BestListing} from '../core/api'
import {wallet} from '../core/wallet'
import {same} from '../core/format'
import {addToCart, cart, inCart, toggleCart} from '../core/cart'
import {isWatched, toggleWatch} from '../core/watchlist'
import {tier} from '../core/rarity'
import NftMedia from './NftMedia.vue'
import Price from './Price.vue'
import Icon from './Icon.vue'
import Chip from '@zvm/web/components/Chip.vue'

const props = withDefaults(
  defineProps<{
    collection: string
    tokenId: string
    name?: string
    image?: string
    collectionName?: string
    owner?: string
    listing?: BestListing | null
    rank?: number
    total?: number
    selectable?: boolean
    selected?: boolean
    compact?: boolean
    index?: number
  }>(),
  {name: '', image: '', collectionName: '', owner: '', listing: null, selectable: false, selected: false, compact: false, index: 0},
)

const emit = defineEmits<{(e: 'select'): void}>()

const title = computed(() => props.name || `#${props.tokenId}`)
const mine = computed(() => same(props.owner || props.listing?.seller, wallet.address))
const carted = computed(() => inCart(props.listing?.hash))
const watched = computed(() => isWatched(props.collection, props.tokenId))
const rarity = computed(() => (props.total ? tier(props.rank, props.total) : null))
const popped = ref(false)

function cartItem() {
  const l = props.listing!
  return {
    hash: l.hash,
    collection: props.collection,
    collectionName: props.collectionName,
    tokenId: props.tokenId,
    name: title.value,
    image: props.image,
    price: l.price,
    currency: l.currency,
  }
}

function onCart() {
  if (!props.listing) return
  toggleCart(cartItem())
}

function buyNow() {
  if (!props.listing) return
  addToCart(cartItem())
  cart.open = true
}

function star() {
  popped.value = false
  if (toggleWatch(props.collection, props.tokenId)) requestAnimationFrame(() => (popped.value = true))
}

function onClick(e: MouseEvent) {
  if (!props.selectable) return
  e.preventDefault()
  emit('select')
}
</script>

<template>
  <router-link
    :to="`/item/${collection}/${tokenId}`"
    class="nft-card group rise-in"
    :class="{picked: selected}"
    :style="{'--i': index}"
    @click="onClick"
  >
    <div class="art relative aspect-square overflow-hidden">
      <NftMedia :src="image" :alt="title" :seed="`${collection}:${tokenId}`" />

      <div class="absolute inset-x-2 top-2 flex items-start justify-between gap-2 pointer-events-none">
        <span class="flex gap-1.5 pointer-events-auto">
          <input
            v-if="selectable"
            type="checkbox"
            class="check shadow"
            :checked="selected"
            :aria-label="`Select ${title}`"
            @click.stop
            @change="emit('select')"
          />
          <Chip v-if="rarity" :tone="rarity.tone" class="glass !border-transparent">{{ rarity.label }}</Chip>
        </span>
        <button
          class="icon-btn glass pointer-events-auto !w-8 !h-8 transition-opacity"
          :class="watched ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
          :title="watched ? 'Remove from watchlist' : 'Add to watchlist'"
          @click.prevent.stop="star"
        >
          <Icon
            name="heart"
            :size="15"
            :class="popped ? 'pop-once' : ''"
            :style="watched ? 'color: var(--new-ink); fill: var(--new-ink)' : ''"
          />
        </button>
      </div>

      <div v-if="rank && !compact" class="absolute left-2 bottom-2 glass rounded-full px-2 py-0.5 mono text-[10.5px] text-soft">
        Rank {{ rank }}
      </div>

      <!-- Rises from under the art on hover. -->
      <div v-if="listing && !mine && !selectable" class="rise absolute inset-x-0 bottom-0 flex">
        <button class="btn btn-plasma flex-1 !rounded-none !py-2.5 text-[13px]" @click.prevent.stop="buyNow">
          <Icon name="bolt" :size="14" /> Buy now
        </button>
        <button
          class="btn !rounded-none !border-0 !py-2.5 !px-3.5 glass"
          :title="carted ? 'Remove from cart' : 'Add to cart'"
          @click.prevent.stop="onCart"
        >
          <Icon :name="carted ? 'check' : 'cart'" :size="15" :style="carted ? 'color: var(--znn-ink)' : ''" />
        </button>
      </div>
    </div>

    <div class="px-3 pt-2.5 pb-3 grid gap-1.5 min-w-0">
      <div class="min-w-0">
        <div v-if="collectionName && !compact" class="text-[11.5px] text-dim truncate">{{ collectionName }}</div>
        <div class="text-[13.5px] font-medium truncate" :title="title">{{ title }}</div>
      </div>
      <div class="flex items-end justify-between gap-2 min-h-[22px]">
        <Price v-if="listing" :raw="listing.price" :currency="listing.currency" size="sm" />
        <span v-else class="text-[12px] text-dim">Not listed</span>
        <span v-if="mine" class="chip" style="color: var(--znn-ink); background: color-mix(in srgb, var(--znn) 12%, transparent)">yours</span>
        <Icon v-else-if="carted" name="cart" :size="13" style="color: var(--znn-ink)" />
      </div>
    </div>
  </router-link>
</template>
