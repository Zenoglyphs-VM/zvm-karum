<script setup lang="ts">
// Making an offer, on one item or on any item in a collection.
//
// An offer is a signature too, paid in wrapped ZNN against an allowance, so
// nothing is locked while it stands (D28). That makes an offer only as good as
// the balance and the allowance behind it, and the node checks both before it
// shows the offer. So the dialog tops up both first when they are short: wrap
// the difference, approve the total, then sign.
import {computed, ref, watch} from 'vue'
import {type Address} from 'viem'
import {endpoint} from '../core/endpoint'
import {listingQuote, quotedAmount, quotedCount, quoteTotal, quoteContextGuard, guardedQuoteCalls} from '../core/order-quote'
import {wallet} from '../core/wallet'
import {chain} from '../core/chain'
import {publicClient} from '@zvm/web/evm'
import {units, usd, whole} from '../core/format'
import {usdOf} from '../core/prices'
import {BUY, erc20Abi, exchange, newOrder, orderDuration, offerFunding, signOrder, submitOrders} from '../core/orders'
import {useMarket} from '../core/market'
import Modal from './Modal.vue'
import NftMedia from './NftMedia.vue'
import StepRail from './StepRail.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  open: boolean
  collection: string
  collectionName?: string
  /** Absent for a collection offer: any item will do. */
  tokenId?: string | null
  name?: string
  image?: string
  floor?: number | null
  topBid?: number | null
}>()
const emit = defineEmits<{(e: 'close'): void; (e: 'done'): void}>()

const market = useMarket()
const price = ref('')
const quantity = ref(1)
const days = ref(7)
const wrapped = ref<bigint | null>(null)
const native = ref<bigint | null>(null)

const isCollection = computed(() => !props.tokenId)
const DURATIONS = [
  {d: 1, label: '1 day'},
  {d: 3, label: '3 days'},
  {d: 7, label: '7 days'},
  {d: 30, label: '30 days'},
]

async function balances() {
  const ex = exchange()
  if (!wallet.address || !ex?.wrappedZnn || endpoint.chainId === null) return
  const client = publicClient(endpoint.chainId)
  const [w, n] = await Promise.all([
    client.readContract({address: ex.wrappedZnn, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address]}).catch(() => null),
    client.getBalance({address: wallet.address}).catch(() => null),
  ])
  wrapped.value = w
  native.value = n
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    market.reset()
    price.value = ''
    quantity.value = 1
    void balances()
  },
)
watch(() => chain.head, () => props.open && balances())

const each = computed(() => {
  try {
    const v = quotedAmount(price.value, 18)
    return v > 0n ? v : null
  } catch {
    return null
  }
})
const total = computed(() => {
  try {return each.value === null ? null : quoteTotal(each.value, isCollection.value ? quotedCount(quantity.value) : 1n)}
  catch {return null}
})
const toWrap = computed(() => (total.value === null || wrapped.value === null ? null : total.value > wrapped.value ? total.value - wrapped.value : 0n))
const short = computed(() => toWrap.value !== null && native.value !== null && toWrap.value > native.value)

async function offer() {
  const bidder = wallet.address as Address, ex = exchange()
  if (!bidder || !ex?.wrappedZnn || !price.value || market.busy.value) return
  const draft = {collection: props.collection, tokenId: props.tokenId ?? null, price: price.value,
    count: quantity.value, days: days.value, name: props.name, paymentToken: ex.wrappedZnn}
  const read = () => ({endpoint: endpoint.rpc, chainId: endpoint.chainId, walletChainId: wallet.chainId,
    owner: wallet.address, signer: wallet.address, provider: wallet.provider, exchange: exchange()?.address,
    paymentToken: exchange()?.wrappedZnn,
    selection: props.open ? props.collection.toLowerCase() + ':' + (props.tokenId ?? '*') : ''})
  const captured = {...read(), owner: bidder, exchange: ex.address, paymentToken: draft.paymentToken,
    selection: draft.collection.toLowerCase() + ':' + (draft.tokenId ?? '*')}
  let prepared: {quote: ReturnType<typeof listingQuote>; count: bigint; guard: () => void} | null = null
  await market.run(async () => {
    const quote = listingQuote(draft.price, 'znn'), count = draft.tokenId ? 1n : quotedCount(draft.count)
    const total = quoteTotal(quote.amount, count)
    orderDuration(draft.days)
    const guard = quoteContextGuard(read, captured)
    prepared = {quote, count, guard}
    const calls = await offerFunding(bidder, total)
    guard()
    return guardedQuoteCalls(calls, guard)
  }, {
    sign: {
      label: draft.tokenId ? `Sign an offer of ${draft.price} ZNN for ${draft.name}` : `Sign an offer of ${draft.price} ZNN each for ${draft.count} items`,
      run: async () => {
        if (!prepared) throw new Error('Review the offer before signing.')
        const {quote, count, guard} = prepared
        guard()
        const order = await newOrder({side: BUY, collection: draft.collection as Address,
          tokenId: draft.tokenId ? BigInt(draft.tokenId) : 0n, anyToken: !draft.tokenId,
          amount: count, price: quote.amount, paymentToken: draft.paymentToken}, draft.days)
        guard()
        const input = await signOrder(order)
        guard()
        await submitOrders([input])
        guard()
      },
    },
    success: 'Offer made. It stands until it is taken, it expires, or you cancel it.',
    after: () => {emit('done'); emit('close')},
  })
}
</script>

<template>
  <Modal :open="open" :title="isCollection ? 'Make a collection offer' : 'Make an offer'" :width="460" @close="emit('close')">
    <div class="p-4 grid gap-4">
      <div class="flex items-center gap-3">
        <span class="w-12 h-12 rounded-[8px] overflow-hidden shrink-0"><NftMedia :src="image" :seed="`${collection}:${tokenId ?? ''}`" /></span>
        <div class="min-w-0">
          <div class="text-[14px] font-medium truncate">{{ isCollection ? `Any item in ${collectionName}` : name }}</div>
          <div class="text-[12px] text-dim flex gap-3">
            <span v-if="floor">Floor {{ whole(floor) }} ZNN</span>
            <span v-if="topBid">Best offer {{ whole(topBid) }} ZNN</span>
          </div>
        </div>
      </div>

      <div class="grid gap-1.5">
        <label class="ledger" for="offer-price">{{ isCollection ? 'Price each' : 'Price' }}</label>
        <div class="field flex items-center gap-3">
          <input id="offer-price" v-model="price" class="amount" inputmode="decimal" placeholder="0" autocomplete="off" />
          <span class="text-dim font-medium">ZNN</span>
        </div>
        <p v-if="total !== null && usdOf(total, null) !== null" class="text-[12px] text-dim num">{{ usd(usdOf(total, null)) }} in total</p>
      </div>

      <div v-if="isCollection" class="grid gap-1.5">
        <span class="ledger">How many</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm px-2" :disabled="quantity <= 1" @click="quantity--"><Icon name="minus" :size="13" /></button>
          <span class="num w-10 text-center text-[16px]">{{ quantity }}</span>
          <button class="btn btn-sm px-2" :disabled="quantity >= 50" @click="quantity++"><Icon name="plus" :size="13" /></button>
          <span class="text-[12px] text-dim ml-2">Filled one item at a time, by whoever holds one.</span>
        </div>
      </div>

      <div class="grid gap-1.5">
        <span class="ledger">Expires after</span>
        <div class="seg justify-self-start">
          <button v-for="o in DURATIONS" :key="o.label" :class="{on: days === o.d}" @click="days = o.d">{{ o.label }}</button>
        </div>
      </div>

      <dl class="grid gap-1.5 text-[13px] rounded-[8px] bg-sunk border border-line p-3">
        <div class="flex justify-between"><dt class="text-dim">Wrapped ZNN held</dt><dd class="num">{{ wrapped === null ? '-' : units(wrapped, 18, 4) }}</dd></div>
        <div class="flex justify-between"><dt class="text-dim">ZNN held</dt><dd class="num">{{ native === null ? '-' : units(native, 18, 4) }}</dd></div>
        <div v-if="toWrap" class="flex justify-between"><dt class="text-dim">Wrapped first</dt><dd class="num">{{ units(toWrap, 18, 4) }} ZNN</dd></div>
        <div class="flex justify-between border-t border-line pt-1.5 mt-0.5 font-semibold">
          <dt>Offer total</dt>
          <dd class="num">{{ total === null ? '-' : units(total, 18, 4) }} ZNN</dd>
        </div>
      </dl>

      <p v-if="short" class="text-[12.5px]" style="color: var(--danger)">Not enough ZNN to wrap for this offer.</p>

      <StepRail :steps="market.steps.value" />

      <button class="btn btn-plasma w-full !py-3 text-[14.5px]" :disabled="total === null || short || market.busy.value" @click="offer">
        <Icon v-if="market.busy.value" name="refresh" :size="15" class="spin" />
        <Icon v-else name="hand" :size="15" />
        {{ market.busy.value ? 'Making the offer' : 'Make offer' }}
      </button>
      <p class="text-[12px] text-dim -mt-1.5">
        Nothing leaves your wallet until the offer is taken. The exchange may spend up to the total then, from wrapped ZNN you keep.
      </p>
    </div>
  </Modal>
</template>
