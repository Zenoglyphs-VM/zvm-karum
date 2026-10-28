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
import {type Address} from 'viem'
import {endpoint} from '../core/endpoint'
import {listingQuote, quotedAmount, quoteAmountText, relistingQuote, quoteContextGuard, guardedQuoteCalls} from '../core/order-quote'
import {wallet} from '../core/wallet'
import {publicClient} from '@zvm/web/evm'
import {whole, units, usd} from '../core/format'
import {usdOf} from '../core/prices'
import {exchange, newOrder, orderDuration, SELL, signOrders, submitOrders} from '../core/orders'
import {approvalFor, useMarket} from '../core/market'
import {burst} from '../core/burst'
import Modal from './Modal.vue'
import NftMedia from './NftMedia.vue'
import StepRail from './StepRail.vue'
import Icon from './Icon.vue'
import type {Listable} from '../core/api'
import {salePreview, type SalePreview, type SaleAmounts} from '../core/sale-proceeds'
import {saleSource} from '../core/sale-proceeds-rpc'

const props = defineProps<{open: boolean; items: Listable[]; floor?: number | null; current?: string | null; currentRaw?: string | null; currentCurrency?: string | null}>()
const emit = defineEmits<{(e: 'close'): void; (e: 'done'): void}>()

const market = useMarket()
const price = ref('')
const currency = ref<'znn' | 'qsr'>('znn')
const days = ref(30)
const proceedsState = ref<SalePreview>({status: 'idle', estimate: null})
const proceedsReader = salePreview(value => {proceedsState.value = value})
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
  (open) => {
    if (!open) return
    market.reset()
    currency.value = 'znn'
    price.value = props.current ?? ''
    if (props.currentRaw !== null && props.currentRaw !== undefined) {
      try {
        const original = relistingQuote(props.currentRaw, props.currentCurrency, qsr.value)
        currency.value = original.currency
        price.value = original.text
      } catch (err: any) {price.value = ''; market.error.value = err?.message ?? 'Review the original listing price.'}
    }

  },
)

const amount = computed(() => {
  try {
    const v = quotedAmount(price.value, decimals.value)
    return v > 0n ? v : null
  } catch {
    return null
  }
})

watch(
  () => [props.open, price.value, currency.value, qsr.value, endpoint.rpc, endpoint.chainId,
    exchange()?.address, props.items.map(item => item.collection.toLowerCase() + ':' + item.tokenId).join(',')],
  (_value, _before, onCleanup) => {
    proceedsReader.clear()
    const ex = exchange(), chainId = endpoint.chainId, quoted = amount.value
    if (!props.open || !ex || chainId === null || quoted === null || !props.items.length) return
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => {disposed = true; clearTimeout(timer); proceedsReader.clear()})
    try {
      listingQuote(price.value, currency.value, qsr.value)
      const client = publicClient(chainId)
      const source = saleSource(request => client.request(request), ex.address)
      const items = props.items.map(item => ({collection: item.collection as Address, tokenId: BigInt(item.tokenId)}))
      const refresh = async () => {
        if (disposed) return
        await proceedsReader.load(source, items, quoted)
        if (!disposed) timer = setTimeout(refresh, 15_000)
      }
      timer = setTimeout(refresh, 200)
    } catch {proceedsState.value = {status: 'unavailable', estimate: null}}
  },
  {immediate: true, flush: 'sync'},
)

function amountRange(field: keyof SaleAmounts): {min: bigint; max: bigint} | null {
  const estimate = proceedsState.value.estimate
  if (proceedsState.value.status !== 'ready' || !estimate?.amounts.length) return null
  let min = estimate.amounts[0][field], max = min
  for (const item of estimate.amounts) {if (item[field] < min) min = item[field]; if (item[field] > max) max = item[field]}
  return {min, max}
}
const proceeds = computed(() => amountRange('proceeds'))
const royalty = computed(() => amountRange('royalty'))
const fee = computed(() => amountRange('fee'))
function rangeText(range: {min: bigint; max: bigint} | null): string {
  if (!range) return proceedsState.value.status === 'loading' ? 'Loading' : 'Unavailable'
  const min = quoteAmountText(range.min, decimals.value), max = quoteAmountText(range.max, decimals.value)
  return (range.min === range.max ? min : min + ' - ' + max) + ' ' + symbol.value
}

const belowFloor = computed(() => {
  if (currency.value !== 'znn' || !props.floor || amount.value === null) return false
  return Number(units(amount.value, 18, 8).replace(/,/g, '')) < props.floor * 0.8
})

function setFloor() {
  if (props.floor) price.value = String(props.floor)
}

async function list() {
  const owner = wallet.address as Address, ex = exchange()
  if (!owner || !ex || !price.value || market.busy.value) return
  const draft = {items: props.items.map(item => ({collection: item.collection, tokenId: item.tokenId,
    name: item.name, collectionName: item.collectionName})), price: price.value, currency: currency.value,
    days: days.value, rewardToken: qsr.value}
  if (!draft.items.length) return
  const keys = (items: {collection: string; tokenId: string}[]) => items.map(item => item.collection.toLowerCase() + ':' + item.tokenId).sort().join(',')
  const read = () => ({endpoint: endpoint.rpc, chainId: endpoint.chainId, walletChainId: wallet.chainId,
    owner: wallet.address, signer: wallet.address, provider: wallet.provider, exchange: exchange()?.address,
    paymentToken: draft.currency === 'qsr' ? qsr.value : '0x0000000000000000000000000000000000000000',
    selection: props.open ? keys(props.items) : ''})
  const captured = {...read(), owner, exchange: ex.address,
    paymentToken: draft.currency === 'qsr' ? draft.rewardToken : '0x0000000000000000000000000000000000000000', selection: keys(draft.items)}
  const n = draft.items.length
  let prepared: {quote: ReturnType<typeof listingQuote>; guard: () => void} | null = null
  await market.run(async () => {
    const quote = listingQuote(draft.price, draft.currency, draft.rewardToken)
    orderDuration(draft.days)
    const guard = quoteContextGuard(read, captured)
    prepared = {quote, guard}
    const collections = [...new Map(draft.items.map(item => [item.collection.toLowerCase(), item])).values()]
    const calls = (await Promise.all(collections.map(item => approvalFor(item.collection as Address, owner, item.collectionName || 'this collection')))).flat()
    guard()
    return guardedQuoteCalls(calls, guard)
  }, {
    sign: {
      label: n === 1 ? `Sign a listing of ${draft.items[0].name} for ${draft.price} ${draft.currency.toUpperCase()}` : `Sign one listing for all ${n} items`,
      run: async () => {
        if (!prepared) throw new Error('Review the listing before signing.')
        const {quote, guard} = prepared
        guard()
        const orders = await Promise.all(draft.items.map(item => newOrder({side: SELL,
          collection: item.collection as Address, tokenId: BigInt(item.tokenId), price: quote.amount, paymentToken: quote.paymentToken}, draft.days)))
        guard()
        const inputs = await signOrders(orders)
        guard()
        await submitOrders(inputs)
        guard()
      },
    },
    success: n === 1 ? `Listed for ${draft.price} ${draft.currency.toUpperCase()}.` : `Listed ${n} items for ${draft.price} ${draft.currency.toUpperCase()} each.`,
    after: () => {burst(button.value); emit('done'); emit('close')},
  })
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

      <dl class="grid gap-1.5 text-[13px] rounded-[8px] bg-sunk border border-line p-3"
        data-testid="listing-proceeds" :data-state="proceedsState.status"
        :data-price="proceedsState.estimate?.price.toString() ?? ''" :data-block="proceedsState.estimate?.head.hash ?? ''"
        :data-proceeds-min="proceeds?.min.toString() ?? ''" :data-proceeds-max="proceeds?.max.toString() ?? ''"
        :data-royalty-min="royalty?.min.toString() ?? ''" :data-royalty-max="royalty?.max.toString() ?? ''"
        :data-fee-min="fee?.min.toString() ?? ''" :data-fee-max="fee?.max.toString() ?? ''">
        <div class="flex justify-between gap-3"><dt class="text-dim">Listing price</dt><dd class="num text-right break-all max-w-[65%]">{{ amount !== null ? quoteAmountText(amount, decimals) + ' ' + symbol : '-' }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-dim">Creator royalty</dt><dd class="num text-right break-all max-w-[65%]">{{ rangeText(royalty) }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-dim">Marketplace fee</dt><dd class="num text-right break-all max-w-[65%]">{{ rangeText(fee) }}</dd></div>
        <div class="flex justify-between gap-3 border-t border-line pt-1.5 mt-0.5 font-semibold">
          <dt>Estimated proceeds{{ many ? ' each' : '' }}</dt>
          <dd class="num text-right break-all max-w-[65%]" style="color: var(--znn-ink)">{{ rangeText(proceeds) }}</dd>
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
