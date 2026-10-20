<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {endpoint, check, hasMarket} from './core/endpoint'
import {chain, startChainPolling} from './core/chain'
import {startPrices} from './core/prices'
import {startCatalog} from './core/catalog'
import {restoreWallet, wallet} from './core/wallet'
import {cart, cartCount} from './core/cart'
import {watchCount} from './core/watchlist'
import {number} from './core/format'
import MomentumPulse from './components/MomentumPulse.vue'
import LatticeBackground from '@zvm/web/components/LatticeBackground.vue'
import KarumMark from './components/KarumMark.vue'
import ConnectButton from './components/ConnectButton.vue'
import NodePicker from './components/NodePicker.vue'
import SearchPalette from './components/SearchPalette.vue'
import CartDrawer from './components/CartDrawer.vue'
import Toasts from './components/Toasts.vue'
import Icon from './components/Icon.vue'

const nav = [
  {to: '/collections', label: 'Collections'},
  {to: '/activity', label: 'Activity'},
  {to: '/drops', label: 'Drops'},
  {to: '/create', label: 'Create'},
]

const route = useRoute()
const menuOpen = ref(false)
watch(() => route.fullPath, () => (menuOpen.value = false))

const theme = ref(document.documentElement.getAttribute('data-theme') ?? 'dark')
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  try {
    localStorage.setItem('karum.theme', theme.value)
  } catch {
    /* storage can be blocked; the theme still applies for this tab */
  }
}

// The cart count bumps once when something lands in it.
const bumped = ref(false)
watch(cartCount, (n, was) => {
  if (n <= was) return
  bumped.value = false
  requestAnimationFrame(() => (bumped.value = true))
})

const offline = computed(() => endpoint.health === 'error')
const noMarket = computed(() => endpoint.health === 'ok' && !hasMarket.value)

onMounted(async () => {
  await check()
  startChainPolling()
  startPrices()
  startCatalog()
  await restoreWallet()
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <LatticeBackground />

    <header class="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
      <div class="mx-auto max-w-[1400px] px-4 py-2.5 flex items-center gap-3">
        <router-link to="/" class="flex items-center gap-2.5 shrink-0 group" title="Karum">
          <span class="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-skew-x-6"><KarumMark :size="26" /></span>
          <span class="font-semibold tracking-[-0.02em] text-[16.5px] hidden sm:block">Karum</span>
        </router-link>

        <nav class="hidden lg:flex items-center gap-1 ml-2">
          <router-link v-for="item in nav" :key="item.to" :to="item.to" class="tab" active-class="tab-on">{{ item.label }}</router-link>
        </nav>

        <div class="grow min-w-0 max-w-[460px] mx-auto hidden md:block"><SearchPalette /></div>
        <span class="grow md:hidden" />

        <div class="flex items-center gap-1">
          <router-link to="/watchlist" class="btn btn-sm btn-quiet px-2 relative hidden sm:inline-flex" title="Watchlist">
            <Icon name="heart" :size="15" />
            <span v-if="watchCount" class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] mono grid place-items-center" style="background: var(--new); color: #fff">{{ watchCount }}</span>
            <span class="sr-only">Watchlist</span>
          </router-link>

          <button class="btn btn-sm btn-quiet px-2 relative" title="Cart" data-testid="cart" @click="cart.open = true">
            <Icon name="cart" :size="16" />
            <span
              v-if="cartCount"
              class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] mono font-semibold grid place-items-center"
              :class="bumped ? 'bump' : ''"
              style="background: var(--znn); color: #04140a"
              >{{ cartCount }}</span
            >
            <span class="sr-only">Cart</span>
          </button>

          <router-link to="/about" class="btn btn-sm btn-quiet px-2" title="How this market works">
            <Icon name="info" :size="15" />
            <span class="sr-only">How this market works</span>
          </router-link>

          <button class="btn btn-sm btn-quiet px-2" :title="`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme`" @click="toggleTheme">
            <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
            <span class="sr-only">Switch theme</span>
          </button>
        </div>

        <div class="hidden sm:block"><NodePicker /></div>
        <ConnectButton />

        <button class="btn btn-sm btn-quiet px-2 lg:hidden" title="Menu" @click="menuOpen = !menuOpen">
          <Icon :name="menuOpen ? 'x' : 'menu'" :size="16" />
          <span class="sr-only">Menu</span>
        </button>
      </div>

      <!-- The chain's beat. One momentum orders one block, and this fills
           across the gap between them. -->
      <MomentumPulse />

      <Transition name="fade">
        <div v-if="menuOpen" class="lg:hidden border-t border-line px-4 py-3 grid gap-3 bg-surface">
          <div class="md:hidden"><SearchPalette /></div>
          <div class="grid gap-1">
            <router-link
              v-for="item in [...nav, {to: '/watchlist', label: 'Watchlist'}, {to: '/about', label: 'About'}]"
              :key="item.to"
              :to="item.to"
              class="px-3 py-2 rounded text-[14px] text-dim hover:bg-raised transition-colors"
              active-class="!text-fg bg-raised"
            >
              {{ item.label }}
            </router-link>
          </div>
          <div class="sm:hidden"><NodePicker /></div>
        </div>
      </Transition>
    </header>

    <!-- One banner, not one per failed read: when the node is unreachable,
         every page below is empty for the same reason. -->
    <div
      v-if="offline || noMarket"
      class="border-b"
      :style="{
        borderColor: `color-mix(in srgb, ${offline ? 'var(--danger)' : 'var(--warn)'} 35%, transparent)`,
        background: `color-mix(in srgb, ${offline ? 'var(--danger)' : 'var(--warn)'} 9%, transparent)`,
      }"
    >
      <div class="mx-auto max-w-[1400px] px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <Icon name="alert" :size="15" :style="{color: offline ? 'var(--danger)' : 'var(--warn)'}" />
        <template v-if="offline">
          <span>{{ endpoint.error }}</span>
          <span v-if="endpoint.hint" class="text-dim">{{ endpoint.hint }}</span>
        </template>
        <template v-else>
          <span>This node answers, but serves no NFT market.</span>
          <span class="text-dim">Choose a ZVM node whose API has an exchange deployed, from the node menu.</span>
        </template>
        <button class="btn btn-sm ml-auto" @click="check()"><Icon name="refresh" :size="13" /> Try again</button>
      </div>
    </div>

    <main class="mx-auto w-full max-w-[1400px] px-4 py-6 flex-1">
      <p v-if="wallet.error" class="card px-4 py-2.5 mb-4 text-[13px]" style="color: var(--danger)">{{ wallet.error }}</p>
      <router-view v-slot="{Component, route: r}">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="r.path" />
        </Transition>
      </router-view>
    </main>

    <footer class="border-t border-line mt-10 bg-bg/80 backdrop-blur-md">
      <div class="mx-auto max-w-[1400px] px-4 py-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-dim">
        <span class="flex items-center gap-2 text-soft"><KarumMark :size="16" /> Karum</span>
        <span class="mono break-all">{{ endpoint.rpc }}</span>
        <span v-if="endpoint.chainId !== null" class="mono">chain {{ endpoint.chainId }}</span>
        <span v-if="chain.head !== null" class="mono sm:ml-auto flex items-center gap-1.5">
          <span class="dot live-dot" style="background: var(--znn-ink)" /> block {{ number(chain.head) }}
        </span>
      </div>
    </footer>

    <CartDrawer />
    <Toasts />
  </div>
</template>
