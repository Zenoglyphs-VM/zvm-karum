<script setup lang="ts">
// Search, as a command palette: Ctrl K or / anywhere, arrows to move, Enter to
// go. It searches what is already loaded (the catalogue of collections) and
// recognises the three things people paste: a collection's address, an
// account's address, and an item written as a collection plus a number.
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {catalog} from '../core/catalog'
import {endpoint} from '../core/endpoint'
import {addressOf, isName} from '@zvm/web/names'
import {whole} from '../core/format'
import NftMedia from './NftMedia.vue'
import Icon from './Icon.vue'

const router = useRouter()
const open = ref(false)
const q = ref('')
const at = ref(0)
const input = ref<HTMLInputElement | null>(null)

interface Hit {
  kind: 'collection' | 'account' | 'item' | 'page'
  title: string
  sub: string
  to: string
  image?: string
  seed?: string
}

const PAGES: Hit[] = [
  {kind: 'page', title: 'Collections', sub: 'Every collection, ranked', to: '/collections'},
  {kind: 'page', title: 'Activity', sub: 'Sales, listings and offers as they happen', to: '/activity'},
  {kind: 'page', title: 'Drops', sub: 'Public mints, live and upcoming', to: '/drops'},
  {kind: 'page', title: 'Create', sub: 'A collection, an item, or a drop', to: '/create'},
  {kind: 'page', title: 'Watchlist', sub: 'What you have starred', to: '/watchlist'},
]

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const hits = computed<Hit[]>(() => {
  const s = q.value.trim()
  const low = s.toLowerCase()
  const out: Hit[] = []
  if (!s) {
    return [
      ...catalog.collections.slice(0, 5).map(toHit),
      ...PAGES,
    ]
  }
  // collection/id, collection #id, or Name #id
  const itemMatch = s.match(/^(0x[0-9a-fA-F]{40})\s*[/#: ]\s*(\d+)$/) ?? s.match(/^(.+?)\s*#\s*(\d+)$/)
  if (itemMatch) {
    const [, left, id] = itemMatch
    const c = ADDRESS.test(left) ? {address: left, name: left} : catalog.collections.find((x) => x.name.toLowerCase() === left.toLowerCase().trim())
    if (c) out.push({kind: 'item', title: `${c.name.startsWith('0x') ? 'Item' : c.name} #${id}`, sub: 'Open the item', to: `/item/${c.address}/${id}`, seed: `${c.address}:${id}`})
  }
  // A ZNS name, opened as the account it points at.
  if (isName(s)) out.push({kind: 'account', title: low, sub: 'Open the account this name points at', to: `name:${low}`, seed: low})
  if (ADDRESS.test(s)) {
    const c = catalog.collections.find((x) => x.address.toLowerCase() === low)
    if (c) out.push(toHit(c))
    else out.push({kind: 'account', title: s, sub: 'Open this account', to: `/account/${s}`, seed: s})
  }
  const named = catalog.collections
    .map((c) => ({c, score: score(c.name.toLowerCase(), c.symbol.toLowerCase(), c.address.toLowerCase(), low)}))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => toHit(x.c))
  out.push(...named.filter((h) => !out.some((o) => o.to === h.to)))
  out.push(...PAGES.filter((p) => p.title.toLowerCase().includes(low)))
  return out
})

function score(name: string, symbol: string, address: string, q: string): number {
  if (name === q || symbol === q) return 100
  if (name.startsWith(q)) return 80
  if (symbol.startsWith(q)) return 70
  if (name.includes(q)) return 50
  if (address.startsWith(q)) return 40
  // Letters in order, anywhere: "zmom" finds "Zenon Momentums".
  let i = 0
  for (const ch of name) if (ch === q[i]) i++
  return i === q.length ? 20 : 0
}

function toHit(c: (typeof catalog.collections)[number]): Hit {
  return {
    kind: 'collection',
    title: c.name || c.address,
    sub: `${c.items.toLocaleString('en-US')} items · floor ${whole(c.floor)} ZNN`,
    to: `/collection/${c.address}`,
    image: c.meta?.image,
    seed: c.address,
  }
}

watch(hits, () => (at.value = 0))

function show() {
  open.value = true
  q.value = ''
  nextTick(() => input.value?.focus())
}

async function go(h?: Hit) {
  const hit = h ?? hits.value[at.value]
  if (!hit) return
  open.value = false
  if (hit.to.startsWith('name:')) {
    const a = await addressOf(endpoint.chainId, hit.to.slice(5))
    router.push(a ? `/account/${a}` : '/not-found')
    return
  }
  router.push(hit.to)
}

function onKey(e: KeyboardEvent) {
  const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !open.value)) {
    e.preventDefault()
    open.value ? (open.value = false) : show()
  } else if (open.value && e.key === 'Escape') {
    open.value = false
  }
}

function nav(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    at.value = Math.min(hits.value.length - 1, at.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    at.value = Math.max(0, at.value - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    go()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

defineExpose({show})

const kindIcon = {collection: 'layers', account: 'user', item: 'image', page: 'arrow'} as const
</script>

<template>
  <button
    class="flex items-center gap-2 w-full h-[34px] px-3 rounded-full border border-line bg-sunk text-dim text-[13px] hover:border-line-strong transition-colors"
    data-testid="search"
    @click="show"
  >
    <Icon name="search" :size="15" />
    <span class="grow text-left truncate">Search collections, items, accounts</span>
    <span class="kbd hidden lg:inline">Ctrl K</span>
  </button>

  <Teleport to="body">
    <Transition name="scrim">
      <div v-if="open" class="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[3px]" @click="open = false" />
    </Transition>
    <Transition name="toast">
      <div v-if="open" class="fixed z-[61] left-1/2 top-[10vh] -translate-x-1/2 w-[min(640px,calc(100vw-24px))] pop overflow-hidden" role="dialog" aria-label="Search">
        <div class="flex items-center gap-3 px-4 border-b border-line">
          <Icon name="search" :size="17" class="text-dim" />
          <input
            ref="input"
            v-model="q"
            class="w-full bg-transparent outline-none py-4 text-[15px] placeholder:text-dim"
            placeholder="A collection, an address, or Name #12"
            spellcheck="false"
            autocomplete="off"
            @keydown="nav"
          />
          <span class="kbd">Esc</span>
        </div>
        <ul class="max-h-[60vh] overflow-y-auto p-2">
          <li v-for="(h, i) in hits" :key="h.to + i">
            <button
              class="w-full flex items-center gap-3 px-2.5 py-2 rounded-[8px] text-left transition-colors"
              :class="i === at ? 'bg-surface' : ''"
              @mouseenter="at = i"
              @click="go(h)"
            >
              <span class="w-9 h-9 rounded-[6px] overflow-hidden shrink-0 grid place-items-center bg-sunk border border-line">
                <NftMedia v-if="h.kind === 'collection' || h.kind === 'item'" :src="h.image" :seed="h.seed" />
                <Icon v-else :name="kindIcon[h.kind]" :size="15" class="text-dim" />
              </span>
              <span class="min-w-0 grow">
                <span class="block text-[14px] truncate">{{ h.title }}</span>
                <span class="block text-[12px] text-dim truncate">{{ h.sub }}</span>
              </span>
              <span class="ledger shrink-0">{{ h.kind }}</span>
            </button>
          </li>
          <li v-if="!hits.length" class="px-3 py-8 text-center text-[13px] text-dim">Nothing matches. Try a collection's name or paste an address.</li>
        </ul>
      </div>
    </Transition>
  </Teleport>
</template>
