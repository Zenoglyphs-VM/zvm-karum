<script setup lang="ts">
import Icon from '../components/Icon.vue'
import KarumMark from '../components/KarumMark.vue'
</script>

<template>
  <div class="grid place-items-center py-24 text-center">
    <div class="grid gap-3 justify-items-center">
      <span class="opacity-60"><KarumMark :size="56" /></span>
      <h1 class="text-[28px] font-semibold tracking-[-0.03em]">Nothing at this address</h1>
      <p class="text-[14px] text-dim max-w-[44ch]">The page you asked for is not part of Karum. If it was an item, check the collection and the number.</p>
      <router-link to="/" class="btn btn-plasma mt-2"><Icon name="left" :size="14" /> Back to the market</router-link>
    </div>
  </div>
</template>
