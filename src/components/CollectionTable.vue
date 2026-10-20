<script setup lang="ts">
// Collections ranked, as a table: the view a trader reads, where the columns
// line up and the numbers are the point. Every column header sorts.
//
// Two windows only, the last day and all time, because those are what the
// node aggregates. A 7-day column would have to be summed here from every sale
// the collection ever had, and a figure computed differently from its
// neighbours is worse than no figure.
import {computed, ref} from 'vue'
import {useRouter} from 'vue-router'
import type {Collection} from '../core/api'
import {whole, percent, usd} from '../core/format'
import {usdOfZnn} from '../core/prices'
import {isWatched, toggleWatch} from '../core/watchlist'
import NftMedia from './NftMedia.vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{rows: Collection[]; loading?: boolean; limit?: number; window?: '24h' | 'all'}>(), {
  loading: false,
  limit: 0,
  window: 'all',
})

type Key = 'volume' | 'floor' | 'topBid' | 'sales' | 'owners' | 'items' | 'listed'
const key = ref<Key>('volume')
const desc = ref(true)

function sortBy(k: Key) {
  if (key.value === k) desc.value = !desc.value
  else {
    key.value = k
    desc.value = k !== 'floor'
  }
}

const value = (c: Collection, k: Key): number | null => {
  switch (k) {
    case 'volume':
      return props.window === '24h' ? c.volume24h : c.volume
    case 'sales':
      return props.window === '24h' ? c.sales24h : c.sales
    case 'listed':
      return c.items ? c.listed / c.items : 0
    default:
      return c[k] as number | null
  }
}

const sorted = computed(() => {
  const rows = [...props.rows].sort((a, b) => {
    const va = value(a, key.value)
    const vb = value(b, key.value)
    // Nothing sorts last whichever way the column runs.
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    return desc.value ? vb - va : va - vb
  })
  return props.limit ? rows.slice(0, props.limit) : rows
})

const router = useRouter()
const cols: {k: Key; label: string; cls?: string}[] = [
  {k: 'floor', label: 'Floor'},
  {k: 'topBid', label: 'Top offer', cls: 'hidden md:table-cell'},
  {k: 'volume', label: 'Volume'},
  {k: 'sales', label: 'Sales', cls: 'hidden sm:table-cell'},
  {k: 'owners', label: 'Owners', cls: 'hidden lg:table-cell'},
  {k: 'items', label: 'Items', cls: 'hidden lg:table-cell'},
  {k: 'listed', label: 'Listed', cls: 'hidden md:table-cell'},
]
</script>

<template>
  <div class="panel overflow-x-auto">
    <table class="w-full border-collapse text-[13.5px]">
      <thead>
        <tr>
          <th class="th w-10 text-center hidden sm:table-cell">#</th>
          <th class="th">Collection</th>
          <th v-for="c in cols" :key="c.k" class="th text-right" :class="c.cls">
            <button class="inline-flex items-center gap-1 hover:text-fg transition-colors" :class="key === c.k ? 'text-fg' : ''" @click="sortBy(c.k)">
              {{ c.label }}
              <Icon v-if="key === c.k" :name="desc ? 'down' : 'up'" :size="11" />
            </button>
          </th>
          <th class="th w-10 hidden sm:table-cell" />
        </tr>
      </thead>
      <tbody>
        <template v-if="loading && !rows.length">
          <tr v-for="n in limit || 8" :key="n">
            <td v-for="m in 10" :key="m" class="td"><div class="skeleton h-5" /></td>
          </tr>
        </template>
        <tr
          v-for="(c, i) in sorted"
          :key="c.address"
          class="cursor-pointer rise-in"
          :style="{'--i': i}"
          @click="router.push(`/collection/${c.address}`)"
        >
          <td class="td text-center text-dim num hidden sm:table-cell">{{ i + 1 }}</td>
          <td class="td">
            <span class="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <span class="w-9 h-9 sm:w-10 sm:h-10 rounded-[8px] overflow-hidden shrink-0 ring-1 ring-line"><NftMedia :src="c.meta?.image" :seed="c.address" /></span>
              <span class="min-w-0">
                <span class="block font-medium truncate max-w-[12ch] sm:max-w-[26ch]">{{ c.name || c.address }}</span>
                <span class="block text-[11.5px] text-dim mono">{{ c.symbol }}</span>
              </span>
            </span>
          </td>
          <td class="td text-right num whitespace-nowrap">
            {{ whole(c.floor) }} <span v-if="c.floor !== null" class="text-dim text-[11px] hidden sm:inline">ZNN</span>
          </td>
          <td class="td text-right num whitespace-nowrap hidden md:table-cell">{{ whole(c.topBid) }}</td>
          <td class="td text-right whitespace-nowrap">
            <span class="num">{{ whole(window === '24h' ? c.volume24h : c.volume) }}</span>
            <span v-if="usdOfZnn(window === '24h' ? c.volume24h : c.volume)" class="block text-[11px] text-dim num">
              {{ usd(usdOfZnn(window === '24h' ? c.volume24h : c.volume), {compact: true}) }}
            </span>
          </td>
          <td class="td text-right num hidden sm:table-cell">{{ (window === '24h' ? c.sales24h : c.sales).toLocaleString('en-US') }}</td>
          <td class="td text-right num hidden lg:table-cell">{{ c.owners.toLocaleString('en-US') }}</td>
          <td class="td text-right num hidden lg:table-cell">{{ c.items.toLocaleString('en-US') }}</td>
          <td class="td text-right hidden md:table-cell">
            <span class="inline-flex items-center gap-2 justify-end">
              <span class="w-12 h-1 rounded-full bg-sunk overflow-hidden">
                <span class="block h-full rounded-full" :style="{width: `${Math.min(100, c.items ? (c.listed / c.items) * 100 : 0)}%`, background: 'var(--plasma)'}" />
              </span>
              <span class="num text-[12px] text-soft w-12">{{ c.items ? percent(c.listed / c.items) : '-' }}</span>
            </span>
          </td>
          <td class="td text-center hidden sm:table-cell" @click.stop>
            <button class="icon-btn !w-7 !h-7" :title="isWatched(c.address) ? 'Unwatch' : 'Watch'" @click="toggleWatch(c.address)">
              <Icon name="heart" :size="14" :style="isWatched(c.address) ? 'color: var(--new-ink); fill: var(--new-ink)' : 'color: var(--dim)'" />
            </button>
          </td>
        </tr>
        <tr v-if="!loading && !rows.length">
          <td colspan="10" class="td text-center text-dim py-12">No collections on this node yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
