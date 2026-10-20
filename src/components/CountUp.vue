<script setup lang="ts">
// A number that counts up to its value when it first appears and eases to a
// new value when it changes, so a stat that moved is noticed.
import {onMounted, ref, watch} from 'vue'

const props = withDefaults(defineProps<{value: number | null | undefined; format?: (n: number) => string; ms?: number}>(), {
  format: (n: number) => Math.round(n).toLocaleString('en-US'),
  ms: 900,
})

const shown = ref(0)
let frame = 0

function animate(to: number) {
  cancelAnimationFrame(frame)
  const from = shown.value
  const start = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / props.ms)
    const eased = 1 - Math.pow(1 - p, 3)
    shown.value = from + (to - from) * eased
    if (p < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}

onMounted(() => animate(props.value ?? 0))
watch(() => props.value, (v) => animate(v ?? 0))
</script>

<template>
  <span class="num">{{ value === null || value === undefined ? '-' : format(shown) }}</span>
</template>
