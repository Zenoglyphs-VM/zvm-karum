<script setup lang="ts">
// The home page's featured collections: one at a time, crossfading every few
// seconds, with its own art blurred behind it as the light source.
//
// It pauses under the pointer and while the tab is hidden, because a carousel
// that moves while someone is reading it takes the thing they were reading
// away. The dots are real buttons, and the arrows keys move it when focused.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {api, type Collection, type Item} from '../core/api'
import type {Featured} from '../core/featured'
import {whole} from '../core/format'
import NftMedia from './NftMedia.vue'
import HeroGlow from './HeroGlow.vue'
import Addr from './Addr.vue'
import Icon from './Icon.vue'

const props = defineProps<{featured: Featured[]}>()

const at = ref(0)
/** Which way the last move went: next slides in from the right, previous from the left. */
const dir = ref<1 | -1>(1)
const paused = ref(false)
const previews = ref<Record<string, Item[]>>({})
const INTERVAL = 6500

const slides = computed(() => props.featured.map((f) => f.collection))
const current = computed(() => slides.value[at.value] ?? null)
const why = computed(() => props.featured[at.value] ?? null)

// What the chip on a slide says: why this collection is here.
const REASON = {volume: 'Top volume, 48h', fill: 'Featured', new: 'New'} as const

async function preview(c: Collection | null) {
  if (!c || previews.value[c.address]) return
  try {
    const items = await api.items(c.address, {limit: 3, sort: 'price_asc', listed: 1})
    const more = items.length < 3 ? await api.items(c.address, {limit: 3 - items.length, sort: 'recent'}) : []
    previews.value = {...previews.value, [c.address]: [...items, ...more].slice(0, 3)}
  } catch {
    previews.value = {...previews.value, [c.address]: []}
  }
}

watch(current, preview, {immediate: true})
watch(slides, () => {
  if (at.value >= slides.value.length) at.value = 0
})

let started = Date.now()
const progress = ref(0)
let frame = 0

function tick() {
  frame = requestAnimationFrame(tick)
  if (paused.value || document.hidden || slides.value.length < 2) {
    started = Date.now() - progress.value * INTERVAL
    return
  }
  progress.value = Math.min(1, (Date.now() - started) / INTERVAL)
  if (progress.value >= 1) go(at.value + 1)
}

function go(i: number) {
  const n = slides.value.length
  if (!n) return
  const next = ((i % n) + n) % n
  if (next === at.value) return
  // Wrapping from the last slide to the first is still "next".
  dir.value = i > at.value ? 1 : -1
  at.value = next
  started = Date.now()
  progress.value = 0
}

onMounted(() => (frame = requestAnimationFrame(tick)))
onUnmounted(() => {
  cancelAnimationFrame(frame)
})
</script>

<template>
  <section
    v-if="current"
    class="relative overflow-hidden rounded-[14px] border border-line min-h-[360px] md:min-h-[400px]"
    tabindex="0"
    aria-roledescription="carousel"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
    @keydown.left="go(at - 1)"
    @keydown.right="go(at + 1)"
  >
    <!-- The light: soft glows taken from this collection's art. -->
    <Transition name="xfade">
      <div :key="current.address" class="absolute inset-0">
        <HeroGlow :src="current.meta?.image" :seed="current.address" />
      </div>
    </Transition>
    <div class="absolute inset-0" style="background: linear-gradient(90deg, var(--bg) 8%, color-mix(in srgb, var(--bg) 70%, transparent) 55%, color-mix(in srgb, var(--bg) 35%, transparent))" />
    <div class="absolute inset-0" style="background: linear-gradient(0deg, var(--bg), transparent 45%)" />

    <div class="relative grid md:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-6 p-6 md:p-10 h-full items-center">
      <Transition :name="dir > 0 ? 'hero-next' : 'hero-prev'" mode="out-in">
        <div :key="current.address" class="grid gap-4 content-center">
          <span class="chip justify-self-start glass !border-transparent text-soft">
            <Icon :name="why?.reason === 'new' ? 'sparkles' : 'flame'" :size="11" :style="{color: why?.reason === 'new' ? 'var(--znn-ink)' : 'var(--new-ink)'}" />
            {{ why ? REASON[why.reason] : 'Featured' }}
            <template v-if="why?.reason === 'volume'"> · {{ whole(why.volume48h) }} ZNN</template>
          </span>
          <div class="flex items-center gap-3">
            <span class="w-14 h-14 rounded-[12px] overflow-hidden ring-2 ring-white/10 shrink-0">
              <NftMedia :src="current.meta?.image" :seed="current.address" eager />
            </span>
            <div class="min-w-0">
              <h2 class="text-[28px] md:text-[38px] font-semibold tracking-[-0.03em] leading-[1.05] truncate">{{ current.name }}</h2>
              <div class="text-[13px] text-soft flex items-center gap-1.5">by <Addr :address="current.creator" /></div>
            </div>
          </div>
          <p v-if="current.meta?.description" class="text-[14.5px] text-soft max-w-[52ch] line-clamp-2">{{ current.meta.description }}</p>
          <dl class="flex flex-wrap gap-x-7 gap-y-2">
            <div class="stat"><dt class="ledger">Floor</dt><dd><b>{{ whole(current.floor) }}</b> <span v-if="current.floor !== null" class="text-dim text-[12px]">ZNN</span></dd></div>
            <div class="stat"><dt class="ledger">Volume</dt><dd><b>{{ whole(current.volume) }}</b> <span class="text-dim text-[12px]">ZNN</span></dd></div>
            <div class="stat"><dt class="ledger">Items</dt><dd><b>{{ current.items.toLocaleString('en-US') }}</b></dd></div>
            <div class="stat"><dt class="ledger">Owners</dt><dd><b>{{ current.owners.toLocaleString('en-US') }}</b></dd></div>
          </dl>
          <div class="flex gap-2 pt-1">
            <router-link :to="`/collection/${current.address}`" class="btn btn-plasma !px-5 !py-2.5 text-[14px]">View collection <Icon name="arrow" :size="15" /></router-link>
          </div>
        </div>
      </Transition>

      <Transition :name="dir > 0 ? 'hero-next' : 'hero-prev'" mode="out-in">
        <div :key="current.address" class="hidden md:grid grid-cols-3 gap-3">
          <router-link
            v-for="(it, i) in previews[current.address] ?? []"
            :key="it.tokenId"
            :to="`/item/${current.address}/${it.tokenId}`"
            class="nft-card rise-in"
            :class="i === 1 ? '-translate-y-4' : ''"
            :style="{'--i': i + 2}"
          >
            <div class="art aspect-square overflow-hidden"><NftMedia :src="it.image" :seed="`${current.address}:${it.tokenId}`" eager /></div>
            <div class="px-2.5 py-2 text-[12px] truncate">{{ it.name || `#${it.tokenId}` }}</div>
          </router-link>
          <template v-if="!previews[current.address]">
            <div v-for="n in 3" :key="n" class="skeleton aspect-square !rounded-[10px]" />
          </template>
        </div>
      </Transition>
    </div>

    <div v-if="slides.length > 1" class="absolute bottom-4 left-6 md:left-10 flex items-center gap-2">
      <button
        v-for="(c, i) in slides"
        :key="c.address"
        class="relative h-1.5 rounded-full overflow-hidden transition-all duration-300"
        :class="i === at ? 'w-10' : 'w-4 hover:w-6'"
        style="background: color-mix(in srgb, var(--fg) 22%, transparent)"
        :aria-label="`Show ${c.name}`"
        @click="go(i)"
      >
        <span v-if="i === at" class="absolute inset-y-0 left-0" :style="{width: `${progress * 100}%`, background: 'var(--plasma)'}" />
      </button>
    </div>
    <div v-if="slides.length > 1" class="absolute bottom-3 right-4 flex gap-1.5">
      <button class="icon-btn glass" aria-label="Previous" @click="go(at - 1)"><Icon name="left" :size="15" /></button>
      <button class="icon-btn glass" aria-label="Next" @click="go(at + 1)"><Icon name="right" :size="15" /></button>
    </div>
  </section>
  <div v-else class="skeleton h-[360px] md:h-[400px] !rounded-[14px]" />
</template>
