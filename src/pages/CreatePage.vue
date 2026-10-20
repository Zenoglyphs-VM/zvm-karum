<script setup lang="ts">
// Making something: a collection, an item in one you own, or a public drop.
//
// The picture and the metadata are stored by the node under the hash of their
// own bytes, and what goes on chain is that address. Storing asks the wallet
// for one sign-in signature per session (not a transaction, nothing spent) so
// the node knows whose upload it is (D31). A collection is a clone of one
// contract, which is why creating one costs about a third of a million gas
// rather than several million.
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {parseUnits, type Address} from 'viem'
import {api, type Collection} from '../core/api'
import {endpoint, hasMarket} from '../core/endpoint'
import {wallet, askToConnect} from '../core/wallet'
import {publicClient} from '@zvm/web/evm'
import {lastHash} from '../core/tx'
import {IMAGE_TYPES, maxImageBytes, uploadBytes, uploadJSON} from '../core/media'
import {collectionFromLogs, createCollectionCall, metadataDoc, mintCall, mintedTokenId, setDropCall} from '../core/nft'
import {useMarket} from '../core/market'
import {loadCatalog, loadDrops} from '../core/catalog'
import StepRail from '../components/StepRail.vue'
import NftMedia from '../components/NftMedia.vue'
import InfoTip from '../components/InfoTip.vue'
import Icon from '../components/Icon.vue'

const route = useRoute()
const router = useRouter()
const market = useMarket()
const tab = ref<'collection' | 'item' | 'drop'>((route.query.tab as any) || 'collection')

const name = ref('')
const symbol = ref('')
const description = ref('')
const royalty = ref(5)
const file = ref<File | null>(null)
const preview = ref('')
const dragging = ref(false)
const uploading = ref('')
const problem = ref('')

const mine = ref<Collection[]>([])
const target = ref('')
const traits = ref<{trait_type: string; value: string}[]>([{trait_type: '', value: ''}])

const dropPrice = ref('')
const dropSupply = ref(100)
const dropPerWallet = ref(5)
const dropStart = ref('')
const dropEnd = ref('')

const factory = computed(() => (endpoint.info?.apps?.collectionFactory ?? null) as Address | null)
const canUpload = computed(() => !!endpoint.info?.media?.uploads)

async function loadMine() {
  if (!wallet.address || !hasMarket.value) {
    mine.value = []
    return
  }
  const profile = await api.account(wallet.address).catch(() => null)
  mine.value = profile?.created ?? []
  if (!target.value && mine.value.length) target.value = mine.value[0].address
}
onMounted(loadMine)
watch(() => [wallet.address, hasMarket.value], loadMine)
watch(tab, () => {
  problem.value = ''
  market.reset()
})

function take(chosen: File | null | undefined) {
  problem.value = ''
  if (!chosen) return
  if (!IMAGE_TYPES.split(',').includes(chosen.type)) {
    problem.value = 'That is not an image the node stores. Use PNG, JPEG, GIF, WebP, AVIF or SVG.'
    return
  }
  if (chosen.size > maxImageBytes()) {
    problem.value = `That image is ${(chosen.size / 1048576).toFixed(1)} MB; this node stores up to ${(maxImageBytes() / 1048576).toFixed(0)} MB.`
    return
  }
  file.value = chosen
  preview.value = URL.createObjectURL(chosen)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  take(e.dataTransfer?.files?.[0])
}

async function store(doc: (image: string) => unknown): Promise<string | null> {
  try {
    uploading.value = 'Storing the image'
    const image = file.value ? await uploadBytes(file.value, file.value.type) : null
    uploading.value = 'Storing the metadata'
    return (await uploadJSON(doc(image?.url ?? ''))).url
  } catch (err: any) {
    problem.value = err?.message ?? String(err)
    return null
  } finally {
    uploading.value = ''
  }
}

async function receiptLogs() {
  const hash = lastHash(market.steps.value)
  if (!hash || endpoint.chainId === null) return null
  return (await publicClient(endpoint.chainId).getTransactionReceipt({hash})).logs as any
}

async function createCollection() {
  if (!wallet.address) return askToConnect()
  const to = factory.value
  if (!to || !name.value || !symbol.value) return
  const uri = await store((image) => ({name: name.value, description: description.value, image}))
  if (uri === null) return
  const ok = await market.run(() => [createCollectionCall(to, name.value, symbol.value.toUpperCase(), uri, Math.round(royalty.value * 100))], {
    success: `${name.value} exists. Mint its first item next.`,
  })
  if (!ok) return
  const created = collectionFromLogs((await receiptLogs()) ?? [], to)
  void loadCatalog()
  if (created) router.push(`/collection/${created}`)
}

async function mint() {
  if (!wallet.address) return askToConnect()
  const collection = target.value as Address
  if (!collection || !name.value) return
  const uri = await store((image) => metadataDoc(name.value, description.value, image, traits.value))
  if (uri === null) return
  const ok = await market.run(() => [mintCall(collection, wallet.address as Address, uri, `Mint ${name.value}`)], {success: `Minted ${name.value}.`})
  if (!ok) return
  const id = mintedTokenId((await receiptLogs()) ?? [], collection)
  if (id !== null) router.push(`/item/${collection}/${id}`)
}

async function openDrop() {
  if (!wallet.address) return askToConnect()
  const collection = target.value as Address
  let price: bigint
  try {
    price = parseUnits(dropPrice.value || '0', 18)
  } catch {
    problem.value = 'That price is not a number.'
    return
  }
  const start = dropStart.value ? Math.floor(new Date(dropStart.value).getTime() / 1000) : Math.floor(Date.now() / 1000) - 60
  const end = dropEnd.value ? Math.floor(new Date(dropEnd.value).getTime() / 1000) : 0
  if (end && end <= start) {
    problem.value = 'The drop has to end after it starts.'
    return
  }
  await market.run(() => [setDropCall(collection, {price, maxSupply: dropSupply.value, maxPerWallet: dropPerWallet.value, start, end})], {
    success: 'The drop is set.',
    after: async () => {
      await loadDrops()
      router.push('/drops')
    },
  })
}

const busy = computed(() => !!uploading.value || market.busy.value)
const targetInfo = computed(() => mine.value.find((c) => c.address === target.value) ?? null)
</script>

<template>
  <div class="shelf grid gap-6 max-w-[1100px] mx-auto w-full">
    <h1 class="text-[28px] font-semibold tracking-[-0.03em] flex items-center gap-2">
      Create <InfoTip text="A collection, an item in one of yours, or a public drop anyone can mint from." />
    </h1>

    <div class="seg justify-self-start">
      <button :class="{on: tab === 'collection'}" @click="tab = 'collection'"><Icon name="layers" :size="13" /> Collection</button>
      <button :class="{on: tab === 'item'}" @click="tab = 'item'"><Icon name="image" :size="13" /> Item</button>
      <button :class="{on: tab === 'drop'}" @click="tab = 'drop'"><Icon name="rocket" :size="13" /> Drop</button>
    </div>

    <p v-if="!wallet.address" class="card px-4 py-3 text-[13.5px] flex items-center gap-3">
      <Icon name="wallet" :size="16" class="text-dim" /> Connect a wallet to create. Everything you make is owned by it.
      <button class="btn btn-sm btn-plasma ml-auto" @click="askToConnect()">Connect</button>
    </p>

    <div class="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
      <!-- The form. -->
      <form class="grid gap-5" @submit.prevent="tab === 'collection' ? createCollection() : tab === 'item' ? mint() : openDrop()">
        <div v-if="tab !== 'collection'" class="grid gap-1.5">
          <label class="ledger" for="target">Collection</label>
          <select id="target" v-model="target" class="input cursor-pointer" :disabled="!mine.length">
            <option v-if="!mine.length" value="">You have not created a collection yet</option>
            <option v-for="c in mine" :key="c.address" :value="c.address">{{ c.name }} ({{ c.symbol }})</option>
          </select>
          <p v-if="!mine.length && wallet.address" class="text-[12.5px] text-dim">
            Only a collection's owner can mint into it or open its drop. <button type="button" class="link" @click="tab = 'collection'">Create one first.</button>
          </p>
        </div>

        <template v-if="tab !== 'drop'">
          <div class="grid gap-1.5">
            <span class="ledger">{{ tab === 'collection' ? 'Collection image' : 'Artwork' }}</span>
            <label
              class="relative grid place-items-center aspect-[16/9] rounded-[12px] border-2 border-dashed cursor-pointer overflow-hidden transition-colors"
              :class="dragging ? 'border-[var(--znn-ink)] bg-[color-mix(in_srgb,var(--znn)_8%,transparent)]' : 'border-line-strong hover:border-dim bg-sunk'"
              @dragover.prevent="dragging = true"
              @dragleave="dragging = false"
              @drop.prevent="onDrop"
            >
              <img v-if="preview" :src="preview" alt="" class="absolute inset-0 w-full h-full object-contain fade-in" />
              <span v-else class="grid gap-2 justify-items-center text-center px-6">
                <span class="w-12 h-12 rounded-full grid place-items-center bg-raised border border-line"><Icon name="upload" :size="20" class="text-dim" /></span>
                <span class="text-[14px]">Drop an image here, or click to choose</span>
                <span class="text-[12px] text-dim">PNG, JPEG, GIF, WebP, AVIF or SVG, up to {{ (maxImageBytes() / 1048576).toFixed(0) }} MB</span>
              </span>
              <input type="file" class="sr-only" :accept="IMAGE_TYPES" @change="take(($event.target as HTMLInputElement).files?.[0])" />
            </label>
            <p v-if="!canUpload && hasMarket" class="text-[12.5px]" style="color: var(--warn)">This node does not take uploads, so the item will have no image.</p>
          </div>

          <div class="grid sm:grid-cols-[1fr_160px] gap-3">
            <div class="grid gap-1.5">
              <label class="ledger" for="name">Name</label>
              <input id="name" v-model="name" class="input" :placeholder="tab === 'collection' ? 'Zenon Momentums' : 'Momentum #1'" required />
            </div>
            <div v-if="tab === 'collection'" class="grid gap-1.5">
              <label class="ledger" for="symbol">Symbol</label>
              <input id="symbol" v-model="symbol" class="input uppercase" placeholder="MOM" maxlength="11" required />
            </div>
          </div>

          <div class="grid gap-1.5">
            <label class="ledger" for="desc">Description</label>
            <textarea id="desc" v-model="description" class="input min-h-[90px] !font-sans" placeholder="What it is, and why it exists." />
          </div>

          <div v-if="tab === 'collection'" class="grid gap-2">
            <div class="flex justify-between"><span class="ledger">Creator royalty</span><span class="num text-[13px]">{{ royalty.toFixed(1) }}%</span></div>
            <input v-model.number="royalty" type="range" min="0" max="10" step="0.5" class="range" :style="{'--fill': `${royalty * 10}%`}" />
            <p class="text-[12px] text-dim">Paid to you out of every resale, through ERC-2981. The contract caps it at 10%.</p>
          </div>

          <div v-if="tab === 'item'" class="grid gap-2">
            <span class="ledger">Traits</span>
            <TransitionGroup name="list" tag="div" class="grid gap-2">
              <div v-for="(t, i) in traits" :key="i" class="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input v-model="t.trait_type" class="input" placeholder="Type, e.g. Palette" />
                <input v-model="t.value" class="input" placeholder="Value, e.g. Plasma" />
                <button type="button" class="btn px-2.5" :disabled="traits.length === 1" title="Remove" @click="traits.splice(i, 1)"><Icon name="trash" :size="13" /></button>
              </div>
            </TransitionGroup>
            <button type="button" class="btn btn-sm justify-self-start" @click="traits.push({trait_type: '', value: ''})"><Icon name="plus" :size="13" /> Add a trait</button>
          </div>
        </template>

        <template v-else>
          <div class="grid sm:grid-cols-3 gap-3">
            <div class="grid gap-1.5">
              <label class="ledger" for="dprice">Price, ZNN</label>
              <input id="dprice" v-model="dropPrice" class="input" inputmode="decimal" placeholder="0 for a free mint" />
            </div>
            <div class="grid gap-1.5">
              <label class="ledger" for="dsupply">Supply</label>
              <input id="dsupply" v-model.number="dropSupply" type="number" min="0" class="input" />
            </div>
            <div class="grid gap-1.5">
              <label class="ledger" for="dwallet">Per wallet</label>
              <input id="dwallet" v-model.number="dropPerWallet" type="number" min="0" class="input" />
            </div>
          </div>
          <div class="grid sm:grid-cols-2 gap-3">
            <div class="grid gap-1.5">
              <label class="ledger" for="dstart">Starts</label>
              <input id="dstart" v-model="dropStart" type="datetime-local" class="input" />
              <span class="text-[11.5px] text-dim">Empty opens it now.</span>
            </div>
            <div class="grid gap-1.5">
              <label class="ledger" for="dend">Ends</label>
              <input id="dend" v-model="dropEnd" type="datetime-local" class="input" />
              <span class="text-[11.5px] text-dim">Empty never closes it. 0 supply or 0 per wallet means no cap.</span>
            </div>
          </div>
          <p class="text-[12.5px] text-dim">
            A drop mints items with no metadata of their own; they read the collection's base URI. Each mint pays you directly.
          </p>
        </template>

        <p v-if="problem" class="text-[13px]" style="color: var(--danger)">{{ problem }}</p>
        <StepRail :steps="market.steps.value" />

        <button
          type="submit"
          class="btn btn-plasma !py-3 text-[15px]"
          :disabled="busy || !hasMarket || (tab === 'collection' ? !name || !symbol || !factory : !target || (tab === 'item' && !name))"
        >
          <Icon v-if="busy" name="refresh" :size="15" class="spin" />
          <Icon v-else :name="tab === 'drop' ? 'rocket' : 'sparkles'" :size="15" />
          {{ uploading || (tab === 'collection' ? 'Create collection' : tab === 'item' ? 'Mint item' : 'Open the drop') }}
        </button>
      </form>

      <!-- What it will look like. -->
      <aside class="grid gap-2 lg:sticky lg:top-[80px]">
        <span class="ledger">Preview</span>
        <div class="nft-card pointer-events-none">
          <div class="art aspect-square overflow-hidden">
            <img v-if="preview && tab !== 'drop'" :src="preview" alt="" class="w-full h-full object-cover" />
            <NftMedia v-else :src="tab === 'drop' ? targetInfo?.meta?.image : ''" :seed="name || target || 'karum'" />
          </div>
          <div class="px-3 pt-2.5 pb-3 grid gap-1">
            <div class="text-[11.5px] text-dim truncate">{{ tab === 'collection' ? symbol.toUpperCase() || 'SYMBOL' : targetInfo?.name ?? 'Your collection' }}</div>
            <div class="text-[14px] font-medium truncate">{{ tab === 'drop' ? targetInfo?.name ?? 'Your drop' : name || 'Untitled' }}</div>
            <div class="text-[12px] text-dim">{{ tab === 'drop' ? `${dropPrice || '0'} ZNN to mint` : 'Not listed' }}</div>
          </div>
        </div>
        <p class="text-[12px] text-dim">
          Images are stored by the node under the hash of their bytes, so the address written on chain is the image and nothing else can
          be swapped in behind it.
        </p>
      </aside>
    </div>
  </div>
</template>
