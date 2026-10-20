<script setup lang="ts">
// An address, linking to its profile, and reading as its ZNS primary name when
// it has one (a name that points back at it; the resolver checks). The
// connected wallet reads as "you", which is the one thing a person scanning
// an activity list looks for.
import {computed, watch} from 'vue'
import {endpoint} from '../core/endpoint'
import {cachedName, nameOf} from '@zvm/web/names'
import {wallet} from '../core/wallet'
import {isZero, same, short} from '../core/format'
import Avatar from './Avatar.vue'

const props = withDefaults(defineProps<{address?: string | null; avatar?: boolean; head?: number; tail?: number}>(), {
  address: '',
  avatar: false,
  head: 6,
  tail: 4,
})

const you = computed(() => same(props.address, wallet.address))
const mint = computed(() => isZero(props.address))
const name = computed(() => cachedName(props.address))
watch(
  () => [props.address, endpoint.chainId] as const,
  ([a, chainId]) => a && !isZero(a) && nameOf(chainId, a),
  {immediate: true},
)
</script>

<template>
  <span v-if="mint" class="text-dim text-[13px]">Minted</span>
  <router-link v-else-if="address" :to="`/account/${address}`" class="link inline-flex items-center gap-1.5 min-w-0" :title="address">
    <Avatar v-if="avatar" :seed="address" :size="18" />
    <span v-if="name" class="text-[13px] truncate">{{ name }}<span v-if="you" class="text-dim"> (you)</span></span>
    <span v-else class="mono text-[12.5px] truncate">{{ you ? 'you' : short(address, head, tail) }}</span>
  </router-link>
  <span v-else class="text-dim">-</span>
</template>
