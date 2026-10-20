<script setup lang="ts">
// Listing one item or many.
//
// A listing is an EIP-712 signature, not a transaction (D28): it costs nothing,
// it is instant, and the node holds it until someone buys. Many items are
// listed with one signature over a Merkle root of their orders, as on Blur, so
// listing twenty is one wallet prompt rather than twenty. The only transaction
// is the once-per-collection approval that lets the exchange move the item
// when it sells, and it is skipped when it is already in place.
import {computed, ref, watch} from 'vue'
import {parseUnits, type Address} from 'viem'
import {endpoint} from '../core/endpoint'
import {wallet} from '../core/wallet'
import {publicClient} from '@zvm/web/evm'
import {whole, units, usd} from '../core/format'
import {usdOf} from '../core/prices'
import {exchange, exchangeAbi, newOrder, SELL, signOrders, submitOrders} from '../core/orders'
import {approvalFor, royaltyBps, useMarket} from '../core/market'
import {burst} from '../core/burst'
import Modal from './Modal.vue'
import NftMedia from './NftMedia.vue'
import StepRail from './StepRail.vue'
import Icon from './Icon.vue'
import type {Listable} from '../core/api'

const props = defineProps<{open: boolean; items: Listable[]; floor?: number | null; current?: string | null}>()
const emit = defineEmits<{(e: 'close'): void; (e: 'done'): void}>()

const market = useMarket()
const price = ref('')
const currency = ref<'znn' | 'qsr'>('znn')
const days = ref(30)
const feeBps = ref<number | null>(null)
const royalty = ref<number | null>(null)
const button = ref<HTMLElement | null>(null)

const DURATIONS = [
  {d: 1 / 24, label: '1 hour'},
  {d: 1, label: '1 day'},
  {d: 7, label: '7 days'},
  {d: 30, label: '30 days'},
  {d: 180, label: '6 months'},
]

const qsr = computed(() => endpoint.info?.apps?.rewardToken ?? null)
const decimals = computed(() => (currency.value === 'qsr' ? 8 : 18))
const symbol = computed(() => currency.value.toUpperCase())
const many = computed(() => props.items.length > 1)
const collections = computed(() => [...new Map(props.items.map((i) => [i.collection.toLowerCase(), i])).values()])

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    market.reset()
    price.value = props.current ?? ''
    const ex = exchange()
    if (!ex || endpoint.chainId === null) return
    const first = props.items[0]
    const [fee, roy] = await Promise.all([
      publicClient(endpoint.chainId).readContract({address: ex.address, abi: exchangeAbi, functionName: 'feeBps'}).then(Number).catch(() => null),
      first ? royaltyBps(first.collection as Address) : Promise.resolve(null),
    ])
    feeBps.value = fee
    royalty.value = roy
  },
)

const amount = computed(() => {
  try {
    const v = parseUnits((price.value || '0').replace(/,/g, ''), decimals.value)
    return v > 0n ? v : null
  } catch {
    return null
  }
})

const proceeds = computed(() => {
  if (amount.value === null) return null
  const cut = BigInt((feeBps.value ?? 0) + (royalty.value ?? 0))
  return amount.value - (amount.value * cut) / 10_000n
})

const belowFloor = computed(() => {
  if (currency.value !== 'znn' || !props.floor || amount.value === null) return false
  return Number(units(amount.value, 18, 8).replace(/,/g, '')) < props.floor * 0.8
})

function setFloor() {
  if (props.floor) price.value = String(props.floor)
}

async function list() {
  const owner = wallet.address as Address
  const pay = amount.value
  if (!owner || pay === null) return
  const paymentToken = (currency.value === 'qsr' && qsr.value ? qsr.value : '0x0000000000000000000000000000000000000000') as Address
  const n = props.items.length
  await market.run(
    async () => (await Promise.all(collections.value.map((c) => approvalFor(c.collection as Address, owner, c.collectionName || 'this collection')))).flat(),
    {
      sign: {
        label: n === 1 ? `Sign a listing of ${props.items[0].name} for ${price.value} ${symbol.value}` : `Sign one listing for all ${n} items`,
        run: async () => {
          const orders = await Promise.all(
            props.items.map((i) =>
              newOrder({side: SELL, collection: i.collection as Address, tokenId: BigInt(i.tokenId), price: pay, paymentToken}, days.value),
            ),
          )
          await submitOrders(await signOrders(orders))
        },
      },
      success: n === 1 ? `Listed for ${price.value} ${symbol.value}.` : `Listed ${n} items for ${price.value} ${symbol.value} each.`,
      after: () => {
        burst(button.value)
        emit('done')
        emit('close')
      },
    },
  )
}
</script>

<template>
  <Modal :open="open" :title="many ? `List ${items.length} items` : 'List for sale'" :width="480" @close="emit('close')">
    <div class="p-4 grid gap-4">
      <div class="flex items-center gap-3">
        <div class="flex -space-x-3">
          <span
            v-for="(i, n) in items.slice(0, 4)"
            :key="i.collection + i.tokenId"
            class="w-12 h-12 rounded-[8px] overflow-hidden ring-2 ring-[var(--raised)]"
            :style="{zIndex: 10 - n}"
          >
            <NftMedia :src="i.image" :seed="`${i.collection}:${i.tokenId}`" />
          </span>
        </div>
        <div class="min-w-0">
          <div class="text-[14px] font-medium truncate">{{ many ? `${items.length} items` : items[0]?.name }}</div>
          <div class="text-[12px] text-dim truncate">
            {{ collections.length === 1 ? items[0]?.collectionName : `${collections.length} collections` }}
          </div>
        </div>
      </div>

      <div class="grid gap-1.5">
        <div class="flex items-center justify-between">
          <label class="ledger" for="list-price">{{ many ? 'Price each' : 'Price' }}</label>
          <button v-if="floor" class="text-[12px] link" @click="setFloor">Floor {{ whole(floor) }} ZNN</button>
        </div>
        <div class="field flex items-center gap-3">
          <input id="list-price" v-model="price" class="amount" inputmode="decimal" placeholder="0" autocomplete="off" />
          <div class="seg shrink-0">
            <button :class="{on: currency === 'znn'}" @click="currency = 'znn'">ZNN</button>
            <button v-if="qsr" :class="{on: currency === 'qsr'}" @click="currency = 'qsr'">QSR</button>
          </div>
        </div>
        <p v-if="amount !== null && usdOf(amount, currency === 'qsr' ? qsr : null) !== null" class="text-[12px] text-dim num">
          {{ usd(usdOf(amount, currency === 'qsr' ? qsr : null)) }}
        </p>
        <p v-if="belowFloor" class="text-[12.5px]" style="color: var(--warn)">That is more than 20% under the floor. Check the number before signing.</p>
      </div>

      <div class="grid gap-1.5">
        <span class="ledger">Expires after</span>
        <div class="seg justify-self-start flex-wrap">
          <button v-for="o in DURATIONS" :key="o.label" :class="{on: days === o.d}" @click="days = o.d">{{ o.label }}</button>
        </div>
      </div>

      <dl class="grid gap-1.5 text-[13px] rounded-[8px] bg-sunk border border-line p-3">
        <div class="flex justify-between"><dt class="text-dim">Listing price</dt><dd class="num">{{ amount !== null ? units(amount, decimals, 6) : '-' }} {{ symbol }}</dd></div>
        <div class="flex justify-between"><dt class="text-dim">Creator royalty</dt><dd class="num">{{ royalty === null ? '-' : `${(royalty / 100).toFixed(2)}%` }}</dd></div>
        <div class="flex justify-between"><dt class="text-dim">Marketplace fee</dt><dd class="num">{{ feeBps === null ? '-' : `${(feeBps / 100).toFixed(2)}%` }}</dd></div>
        <div class="flex justify-between border-t border-line pt-1.5 mt-0.5 font-semibold">
          <dt>You receive{{ many ? ' each' : '' }}</dt>
          <dd class="num" style="color: var(--znn-ink)">{{ proceeds !== null ? units(proceeds, decimals, 6) : '-' }} {{ symbol }}</dd>
        </div>
      </dl>

      <StepRail :steps="market.steps.value" />

      <button ref="button" class="btn btn-plasma w-full !py-3 text-[14.5px]" :disabled="amount === null || market.busy.value" data-testid="list-submit" @click="list">
        <Icon v-if="market.busy.value" name="refresh" :size="15" class="spin" />
        <Icon v-else name="tag" :size="15" />
        {{ market.busy.value ? 'Listing' : many ? `List ${items.length} items` : 'Complete listing' }}
      </button>
      <p class="text-[12px] text-dim -mt-1.5">
        Listing is a signature and costs nothing. {{ many ? 'All of them are one signature.' : '' }} Cancelling one later is a transaction,
        because a signature cannot be taken back any other way.
      </p>
    </div>
  </Modal>
</template>
