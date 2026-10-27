<script setup lang="ts">
// The cart, sliding in from the right: every listing picked on the site, the
// total per currency, and one checkout.
//
// Checkout asks the node for each order again first, because the book is
// eventually consistent (D36) and a listing picked a minute ago may have sold.
// Those are taken out and named before the wallet is asked for anything, so
// the person pays for what they will actually receive. The exchange would skip
// them and refund the difference anyway; saying so up front is the courtesy.
import {computed, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import type {Address} from 'viem'
import {cart, cartTotals, clearCart, removeFromCart} from '../core/cart'
import {wallet, askToConnect} from '../core/wallet'
import {endpoint, hasMarket} from '../core/endpoint'
import {batchMessage, batchResult, type BatchResult} from '../core/batch-result'
import {isZero, units, usd} from '../core/format'
import {usdOf} from '../core/prices'
import {buyManyCall, exchange, fetchFillable, tokenApproval, type Input} from '../core/orders'
import {useMarket} from '../core/market'
import {burst} from '../core/burst'
import {toast} from '../core/toast'
import NftMedia from './NftMedia.vue'
import Price from './Price.vue'
import StepRail from './StepRail.vue'
import Icon from './Icon.vue'

const router = useRouter()
const market = useMarket()
const gone = ref<string[]>([])
const checkoutResult = ref<BatchResult | null>(null)
const checkoutBtn = ref<HTMLElement | null>(null)

const totalUsd = computed(() => {
  let sum = 0
  for (const t of cartTotals.value) {
    const v = usdOf(t.total, isZero(t.currency) ? null : t.currency)
    if (v === null) return null
    sum += v
  }
  return sum
})

watch(
  () => cart.open,
  (open) => {
    if (open) {
      gone.value = []
      if (!market.busy.value) market.reset()
    }
  },
)

function close() {
  cart.open = false
}

function openItem(collection: string, tokenId: string) {
  close()
  router.push(`/item/${collection}/${tokenId}`)
}

async function checkout() {
  if (!wallet.address) return askToConnect()
  const buyer = wallet.address as Address
  const names = new Map(cart.items.map((i) => [i.hash, i.name]))
  checkoutResult.value = null
  const chainId = endpoint.chainId, node = endpoint.rpc
  let selectedExchange: Address | null = null
  let submitted: Input[] = []
  let nativeSent = 0n
  const guard = () => {
    if (wallet.address?.toLowerCase() !== buyer.toLowerCase() || wallet.chainId !== chainId ||
        endpoint.chainId !== chainId || endpoint.rpc !== node ||
        exchange()?.address.toLowerCase() !== selectedExchange?.toLowerCase()) {
      throw new Error('The account or node changed. Review checkout again.')
    }
  }
  await market.run(
    async () => {
      selectedExchange = exchange()?.address ?? null
      if (!selectedExchange) throw new Error('This node has no exchange deployed.')
      guard()
      const {inputs, gone: missing} = await fetchFillable(cart.items.map((i) => i.hash))
      guard()
      gone.value = missing.map((h) => names.get(h) ?? h)
      missing.forEach(removeFromCart)
      if (!inputs.length) throw new Error('Nothing in the cart can still be bought.')
      const native = inputs.filter((i) => isZero(i.order.paymentToken)).reduce((a, i) => a + i.order.price, 0n)
      // Anything priced in a token is paid from an allowance, one per token.
      const byToken = new Map<string, bigint>()
      for (const i of inputs) {
        if (isZero(i.order.paymentToken)) continue
        const k = i.order.paymentToken.toLowerCase()
        byToken.set(k, (byToken.get(k) ?? 0n) + i.order.price)
      }
      const approvals = (
        await Promise.all([...byToken.entries()].map(([token, total]) => tokenApproval(token as Address, buyer, total, 'QSR')))
      ).flat()
      submitted = inputs
      nativeSent = native
      guard()
      return [...approvals, buyManyCall(inputs, native)].map(call => ({...call, guard}))
    },
    {
      after: () => {
        const step = [...market.steps.value].reverse().find(step => step.receipt)
        if (!selectedExchange || !step?.receipt || step.hash !== step.receipt.transactionHash) throw new Error('The executed checkout receipt is unavailable.')
        const result = batchResult(step.receipt, selectedExchange, buyer, submitted, nativeSent)
        checkoutResult.value = result
        guard()
        result.purchasedHashes.forEach(removeFromCart)
        if (result.bought > 0) burst(checkoutBtn.value)
        toast(batchMessage(result), result.bought > 0 ? 'good' : 'bad', {to: `/account/${buyer}`, label: 'See them'})
      },
    },
  )
}
</script>

<template>
  <Teleport to="body">
    <Transition name="scrim">
      <div v-if="cart.open" class="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" @click="close" />
    </Transition>
    <Transition name="drawer">
      <aside
        v-if="cart.open"
        class="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[420px] flex flex-col border-l border-line-strong bg-raised"
        style="box-shadow: var(--shadow-pop)"
        role="dialog"
        aria-label="Cart"
        @keydown.esc="close"
      >
        <header class="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-line">
          <h2 class="text-[16px] font-semibold tracking-[-0.01em] flex items-center gap-2">
            Your cart <span class="chip" style="background: var(--sunk); color: var(--dim)">{{ cart.items.length }}</span>
          </h2>
          <span class="flex items-center gap-1">
            <button v-if="cart.items.length && !market.busy.value" class="btn btn-sm btn-quiet" @click="clearCart">Clear all</button>
            <button class="btn btn-sm btn-quiet px-1.5" title="Close" @click="close"><Icon name="x" :size="16" /></button>
          </span>
        </header>

        <div class="flex-1 overflow-y-auto">
          <div v-if="!cart.items.length" class="h-full grid place-items-center text-center px-8 py-16">
            <div class="grid gap-3 justify-items-center">
              <span class="grid place-items-center w-14 h-14 rounded-full bg-sunk border border-line">
                <Icon name="cart" :size="22" class="text-dim" />
              </span>
              <p class="text-[14px]">Nothing here yet</p>
              <p class="text-[12.5px] text-dim">Add listed items from any collection.</p>
              <button class="btn btn-sm mt-1" @click="close(); router.push('/collections')">Browse collections</button>
            </div>
          </div>

          <TransitionGroup v-else tag="ul" name="list" class="p-2 grid gap-1">
            <li
              v-for="i in cart.items"
              :key="i.hash"
              class="group flex items-center gap-3 p-2 rounded-[8px] hover:bg-surface transition-colors"
            >
              <button class="w-14 h-14 rounded-[6px] overflow-hidden shrink-0" @click="openItem(i.collection, i.tokenId)">
                <NftMedia :src="i.image" :alt="i.name" :seed="`${i.collection}:${i.tokenId}`" />
              </button>
              <div class="min-w-0 grow">
                <div class="text-[13.5px] font-medium truncate">{{ i.name }}</div>
                <div class="text-[12px] text-dim truncate">{{ i.collectionName }}</div>
              </div>
              <div class="text-right shrink-0">
                <Price :raw="i.price" :currency="i.currency" size="sm" />
              </div>
              <button
                class="icon-btn text-dim hover:text-fg opacity-60 group-hover:opacity-100"
                :disabled="market.busy.value"
                title="Remove"
                @click="removeFromCart(i.hash)"
              >
                <Icon name="trash" :size="14" />
              </button>
            </li>
          </TransitionGroup>

          <div v-if="gone.length" class="mx-4 mb-3 text-[12.5px] rounded p-2.5" style="background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn)">
            Sold or withdrawn since you added {{ gone.length === 1 ? 'it' : 'them' }}, so taken out: {{ gone.join(', ') }}.
          </div>

          <div v-if="market.steps.value.length" class="px-4 pb-4"><StepRail :steps="market.steps.value" /></div>
          <p v-if="checkoutResult" data-batch-outcome role="status" class="px-4 pb-4 text-[12.5px]">{{ batchMessage(checkoutResult) }}</p>
        </div>

        <footer v-if="cart.items.length" class="border-t border-line p-4 grid gap-3 bg-surface">
          <div class="flex items-start justify-between gap-3">
            <span class="text-[13px] text-dim pt-0.5">You pay</span>
            <div class="grid justify-items-end gap-0.5">
              <span v-for="t in cartTotals" :key="t.key" class="num font-semibold text-[17px]">
                {{ units(t.total, t.decimals, 4) }} <span class="text-dim text-[12px]">{{ t.symbol }}</span>
              </span>
              <span v-if="totalUsd !== null" class="text-[12px] text-dim num">{{ usd(totalUsd) }}</span>
            </div>
          </div>
          <p class="text-[11.5px] text-dim">
            The seller pays the royalty and the exchange's fee out of the price. You pay the listed price and gas, nothing else.
          </p>
          <button
            ref="checkoutBtn"
            class="btn btn-plasma w-full !py-3 text-[14.5px]"
            :disabled="market.busy.value || !hasMarket"
            data-testid="checkout"
            @click="checkout"
          >
            <Icon v-if="market.busy.value" name="refresh" :size="15" class="spin" />
            <Icon v-else name="bolt" :size="15" />
            {{ !wallet.address ? 'Connect wallet to buy' : market.busy.value ? 'Buying' : `Buy ${cart.items.length} item${cart.items.length === 1 ? '' : 's'}` }}
          </button>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>
