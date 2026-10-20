<script setup lang="ts">
import InfoTip from './InfoTip.vue'

defineProps<{title?: string; subtitle?: string}>()
</script>

<template>
  <section class="panel overflow-hidden">
    <header
      v-if="title || $slots.actions"
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-line"
    >
      <h2 class="ledger min-w-0 flex items-center gap-1">{{ title }} <InfoTip v-if="subtitle" :text="subtitle" /></h2>
      <div class="flex items-center gap-2"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
