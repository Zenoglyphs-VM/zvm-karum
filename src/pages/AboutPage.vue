<script setup lang="ts">
import {endpoint} from '../core/endpoint'
import {chain} from '../core/chain'
import Icon from '../components/Icon.vue'
import KarumMark from '../components/KarumMark.vue'

const steps = [
  {n: 1, who: 'You', what: 'Sign the purchase, an ordinary EVM transaction.'},
  {n: 2, who: 'Relayer', what: 'Posts it to Zenon and returns the hash.'},
  {n: 3, who: 'Zenon', what: 'A momentum fixes its place in line.'},
  {n: 4, who: 'ZVM', what: 'The next block runs it: the item moves, the seller is paid.'},
]

const facts = [
  {
    icon: 'tag',
    tone: 'var(--znn-ink)',
    title: 'Listing is a signature',
    body: 'Listings and offers are signed EIP-712 orders: free and instant. Only a sale, or a cancel, is a transaction.',
  },
  {
    icon: 'coins',
    tone: 'var(--new-ink)',
    title: 'Who is paid what',
    body: "The buyer pays the price and gas. The creator's royalty (at most 10%) and the exchange fee come out of the price; the seller gets the rest. Mints carry no fee.",
  },
] as const
</script>

<template>
  <article class="shelf grid gap-8 max-w-[760px] mx-auto w-full">
    <header class="grid gap-3">
      <span class="flex items-center gap-3"><KarumMark :size="34" /><span class="ledger">About</span></span>
      <h1 class="text-[34px] md:text-[44px] font-semibold tracking-[-0.035em] leading-[1.05]">
        A market that lives <span class="plasma-text">outside the walls</span>.
      </h1>
      <p class="text-[15px] text-soft">
        An NFT market for the ZVM, the EVM that Zenon's Network of Momentum orders. It has no server: your browser reads
        everything from the node you chose.
      </p>
    </header>

    <div class="grid sm:grid-cols-2 gap-3">
      <section v-for="f in facts" :key="f.title" class="card p-4 grid gap-1.5 content-start">
        <h2 class="text-[16px] font-semibold tracking-[-0.01em] flex items-center gap-2"><Icon :name="f.icon" :size="16" :style="{color: f.tone}" /> {{ f.title }}</h2>
        <p class="text-[13.5px] text-soft">{{ f.body }}</p>
      </section>
    </div>

    <section class="grid gap-3">
      <h2 class="text-[20px] font-semibold tracking-[-0.02em] flex items-center gap-2"><Icon name="clock" :size="18" style="color: var(--nom-ink)" /> A purchase takes two momentums</h2>
      <ol class="grid gap-2">
        <li v-for="s in steps" :key="s.n" class="card px-4 py-2.5 flex gap-4 items-center rise-in" :style="{'--i': s.n}">
          <span class="num text-[13px] w-6 h-6 rounded-full grid place-items-center shrink-0" style="background: var(--sunk); border: 1px solid var(--line)">{{ s.n }}</span>
          <span class="ledger w-16 shrink-0">{{ s.who }}</span>
          <span class="text-[14px]">{{ s.what }}</span>
        </li>
      </ol>
      <p class="text-[14px] text-soft">
        On this node that is about {{ chain.interval.toFixed(1) }} seconds a block; the line under the header shows the beat.
        A cart is a single transaction, however many items are in it.
      </p>
    </section>

    <section class="grid gap-3">
      <h2 class="text-[20px] font-semibold tracking-[-0.02em] flex items-center gap-2"><Icon name="server" :size="18" style="color: var(--warn)" /> Each node keeps its own order book</h2>
      <p class="text-[14px] text-soft">
        Signed orders are not chain state, so another node may show different offers. You are reading
        <code class="mono text-[13px] break-all">{{ endpoint.rpc }}</code>; switch from the node menu, or add
        <code class="mono text-[13px]">?rpc=</code> to a link.
      </p>
    </section>

    <section class="card p-5 grid gap-2">
      <h2 class="ledger">Keys</h2>
      <p class="text-[13.5px] text-soft flex flex-wrap gap-x-5 gap-y-1">
        <span><span class="kbd">Ctrl K</span> or <span class="kbd">/</span> search</span>
        <span><span class="kbd">Esc</span> close</span>
        <span><span class="kbd">&larr;</span> <span class="kbd">&rarr;</span> move the featured carousel</span>
      </p>
    </section>
  </article>
</template>
