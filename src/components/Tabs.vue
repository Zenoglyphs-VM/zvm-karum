<script setup lang="ts">
// An underline tab bar whose ink slides to the tab that is on. The ink is
// measured from the button rather than computed from an index, so tabs of
// different widths and a count beside a label all land exactly.
import {nextTick, onMounted, onUnmounted, ref, watch} from 'vue'

const props = defineProps<{tabs: {id: string; label: string; count?: number | null}[]; modelValue: string}>()
const emit = defineEmits<{(e: 'update:modelValue', v: string): void}>()

const bar = ref<HTMLElement | null>(null)
const ink = ref({x: 0, w: 0})

function measure() {
  const el = bar.value?.querySelector<HTMLElement>(`[data-tab="${props.modelValue}"]`)
  if (el) ink.value = {x: el.offsetLeft, w: el.offsetWidth}
}

watch(() => [props.modelValue, props.tabs.map((t) => t.count).join()], () => nextTick(measure))
onMounted(() => {
  nextTick(measure)
  window.addEventListener('resize', measure)
  // Fonts arrive after first paint and change every label's width.
  document.fonts?.ready.then(measure)
})
onUnmounted(() => window.removeEventListener('resize', measure))
</script>

<template>
  <div ref="bar" class="tabbar" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.id"
      :data-tab="t.id"
      role="tab"
      :aria-selected="t.id === modelValue"
      :class="{on: t.id === modelValue}"
      @click="emit('update:modelValue', t.id)"
    >
      {{ t.label }}<span v-if="t.count !== undefined && t.count !== null" class="count">{{ t.count.toLocaleString('en-US') }}</span>
    </button>
    <span class="ink" :style="{width: `${ink.w}px`, transform: `translateX(${ink.x}px)`}" />
  </div>
</template>
