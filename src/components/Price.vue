<script setup lang="ts">
// A price: the amount in its own currency, and what that is worth in dollars
// when the node knows. The currency is always written out; a bare number on a
// market that takes two currencies is a guess.
import {computed} from 'vue'
import {currencyOf, priceOf, whole, usd} from '../core/format'
import {usdOf, usdOfZnn} from '../core/prices'

const props = withDefaults(
  defineProps<{
    /** Base units, with `currency`. */
    raw?: string | bigint | null
    currency?: string | null
    /** Or a whole-ZNN float, as the node's aggregates carry them. */
    znn?: number | null
    showUsd?: boolean
    size?: 'sm' | 'md' | 'lg' | 'xl'
  }>(),
  {raw: null, currency: null, znn: undefined, showUsd: false, size: 'md'},
)

const text = computed(() => (props.znn !== undefined ? whole(props.znn) : priceOf(props.raw, props.currency)))
const symbol = computed(() => (props.znn !== undefined ? 'ZNN' : currencyOf(props.currency).symbol))
const empty = computed(() => text.value === '-')
const dollars = computed(() => {
  if (!props.showUsd || empty.value) return null
  const v = props.znn !== undefined ? usdOfZnn(props.znn) : usdOf(props.raw, props.currency)
  return v === null ? null : usd(v, {compact: true})
})

const sizes = {sm: 'text-[12.5px]', md: 'text-[14px]', lg: 'text-[18px]', xl: 'text-[28px] leading-none'}
</script>

<template>
  <span class="inline-flex items-baseline gap-1.5 whitespace-nowrap">
    <span class="num font-semibold" :class="sizes[size]">{{ text }}</span>
    <span v-if="!empty" class="text-dim font-medium" :class="size === 'xl' ? 'text-[15px]' : 'text-[11.5px]'">{{ symbol }}</span>
    <span v-if="dollars" class="text-dim num" :class="size === 'xl' ? 'text-[14px]' : 'text-[11.5px]'">{{ dollars }}</span>
  </span>
</template>
