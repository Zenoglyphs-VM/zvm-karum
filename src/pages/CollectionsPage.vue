<script setup lang="ts">
// Every collection the node knows, ranked, with a filter box.
import {computed, ref} from 'vue'
import {catalog, loadCatalog} from '../core/catalog'
import CollectionTable from '../components/CollectionTable.vue'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'

const window_ = ref<'24h' | 'all'>('all')
const q = ref('')
const hideEmpty = ref(true)

const rows = computed(() => {
  const s = q.value.trim().toLowerCase()
  return catalog.collections.filter(
    (c) =>
      (!hideEmpty.value || c.items > 0) &&
      (!s || c.name.toLowerCase().includes(s) || c.symbol.toLowerCase().includes(s) || c.address.toLowerCase().startsWith(s)),
  )
})
</script>

<template>
  <div class="shelf grid gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-[28px] font-semibold tracking-[-0.03em] flex items-center gap-2">
        Collections <InfoTip text="Every collection this node has indexed, ranked by volume." />
      </h1>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-[13px] text-soft cursor-pointer">
          <input v-model="hideEmpty" type="checkbox" class="check" /> Hide empty
        </label>
        <div class="relative">
          <Icon name="search" :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input v-model="q" class="input !pl-8 !rounded-full w-[220px]" placeholder="Filter by name" />
        </div>
        <div class="seg">
          <button :class="{on: window_ === '24h'}" @click="window_ = '24h'">24h</button>
          <button :class="{on: window_ === 'all'}" @click="window_ = 'all'">All time</button>
        </div>
        <button class="btn btn-sm btn-quiet px-2" title="Refresh" @click="loadCatalog"><Icon name="refresh" :size="14" /></button>
      </div>
    </div>
    <CollectionTable :rows="rows" :loading="!catalog.loaded" :window="window_" />
    <p v-if="catalog.error" class="text-[13px]" style="color: var(--danger)">{{ catalog.error }}</p>
  </div>
</template>
