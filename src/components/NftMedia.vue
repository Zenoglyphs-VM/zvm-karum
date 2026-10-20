<script setup lang="ts">
// An item's art, in a square frame that never changes size.
//
// Three states, and the frame is the same in all of them so a grid does not
// jump: a shimmer while the bytes are coming, the image, or, when there is no
// image or it will not load, a glyph drawn from the item's own identity. The
// glyph is deterministic, so the same item always gets the same placeholder
// and two broken items in a row are still told apart.
import {computed, ref, watch} from 'vue'
import {mediaURL} from '../core/media'

const props = withDefaults(defineProps<{src?: string | null; alt?: string; seed?: string; contain?: boolean; eager?: boolean}>(), {
  src: '',
  alt: '',
  seed: '',
  contain: false,
  eager: false,
})

const url = computed(() => mediaURL(props.src))
const loaded = ref(false)
const failed = ref(false)

watch(url, () => {
  loaded.value = false
  failed.value = false
})

// FNV-1a over the seed: cheap, stable, and spread well enough for a hue.
const hash = computed(() => {
  let h = 2166136261
  for (const ch of props.seed || props.alt || 'karum') {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
})
const hue = computed(() => 120 + (hash.value % 120))
</script>

<template>
  <div class="relative w-full h-full overflow-hidden bg-sunk">
    <div v-if="url && !loaded && !failed" class="skeleton absolute inset-0 !rounded-none" />
    <img
      v-if="url && !failed"
      :src="url"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      class="absolute inset-0 w-full h-full transition-opacity duration-500"
      :class="[contain ? 'object-contain' : 'object-cover', loaded ? 'opacity-100' : 'opacity-0']"
      @load="loaded = true"
      @error="failed = true"
    />
    <div
      v-if="!url || failed"
      class="absolute inset-0 grid place-items-center"
      :style="{
        background: `radial-gradient(120% 120% at 20% 10%, hsl(${hue} 70% 18%), hsl(${hue + 40} 60% 6%))`,
      }"
    >
      <svg viewBox="0 0 100 100" class="w-1/2 h-1/2 opacity-80" aria-hidden="true">
        <g fill="none" :stroke="`hsl(${hue} 80% 60%)`" stroke-width="3" stroke-linecap="square">
          <path d="M20 20H80L20 80H80" />
          <path d="M38 38L62 62" />
          <circle cx="50" cy="50" r="44" :stroke="`hsl(${hue + 30} 70% 45% / 0.35)`" stroke-width="1.5" />
        </g>
      </svg>
    </div>
  </div>
</template>
