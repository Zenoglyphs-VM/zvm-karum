<script setup lang="ts">
// What this browser has starred: collections, ranked the way the table always
// ranks them, and items with their current price.
import {computed, ref, watch} from 'vue'
import {api, type ItemDetail} from '../core/api'
import {catalog} from '../core/catalog'
import {hasMarket} from '../core/endpoint'
import {watchedCollections, watchedItems} from '../core/watchlist'
import CollectionTable from '../components/CollectionTable.vue'
import NftCard from '../components/NftCard.vue'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'

const items = ref<ItemDetail[]>([])
const loading = ref(false)

const collections = computed(() => catalog.collections.filter((c) => watchedCollections.value.includes(c.address.toLowerCase())))

async function load() {
  if (!hasMarket.value) return
  loading.value = true
  const got = await Promise.allSettled(watchedItems.value.map((w) => api.item(w.collection, w.tokenId)))
  items.value = got.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  loading.value = false
}

watch(() => [watchedItems.value.length, hasMarket.value], load, {immediate: true})
</script>

<template>
  <div class="shelf grid gap-8">
    <h1 class="text-[28px] font-semibold tracking-[-0.03em] flex items-center gap-2.5">
      <Icon name="heart" :size="24" style="color: var(--new-ink)" /> Watchlist <InfoTip text="Kept in this browser only, per chain." />
    </h1>

    <section class="grid gap-3">
      <h2 class="ledger">Collections <span class="text-dim">{{ collections.length }}</span></h2>
      <CollectionTable v-if="collections.length" :rows="collections" />
      <p v-else class="card p-8 text-center text-[13.5px] text-dim">No collections starred. <router-link to="/collections" class="link">Browse them</router-link></p>
    </section>

    <section class="grid gap-3">
      <h2 class="ledger">Items <span class="text-dim">{{ watchedItems.length }}</span></h2>
      <div v-if="items.length || loading" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <template v-if="loading && !items.length">
          <div v-for="n in watchedItems.length" :key="n" class="skeleton aspect-square !rounded-[10px]" />
        </template>
        <NftCard
          v-for="(it, i) in items"
          :key="`${it.collection}:${it.tokenId}`"
          :collection="it.collection"
          :token-id="it.tokenId"
          :name="it.name"
          :image="it.image"
          :owner="it.owner"
          :listing="it.listing"
          :collection-name="it.collectionInfo?.name"
          :index="i"
        />
      </div>
      <p v-else class="card p-8 text-center text-[13.5px] text-dim">No items starred.</p>
    </section>
  </div>
</template>
