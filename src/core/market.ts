// Running a market action from a page: the transactions it needs, in order,
// then the signature if it is a listing or an offer, with its progress on the
// page and a toast when it is over.

import {ref} from 'vue'
import type {Address} from 'viem'
import {publicClient} from '@zvm/web/evm'
import {endpoint} from './endpoint'
import {wallet, askToConnect} from './wallet'
import {allDone, runCalls, type Call, type SignStep, type Step} from './tx'
import {approveCollectionCall, collectionAbi} from './nft'
import {exchange} from './orders'
import {toast} from './toast'

export function useMarket() {
  const steps = ref<Step[]>([])
  const busy = ref(false)
  const error = ref('')

  /**
   * Builds the calls, runs them, then the signature, and refreshes after. The
   * build runs inside the try, so a stale order or a missing allowance found
   * while building is reported like any other failure rather than thrown past
   * the button that started it.
   */
  async function run(
    build: () => Promise<Call[]> | Call[],
    opts: {sign?: SignStep; after?: () => unknown; success?: string} = {},
  ): Promise<boolean> {
    if (!wallet.address) {
      askToConnect()
      return false
    }
    busy.value = true
    error.value = ''
    steps.value = []
    try {
      const calls = await build()
      if (!calls.length && !opts.sign) return false
      const done = await runCalls(calls, (s) => (steps.value = s), opts.sign)
      const ok = allDone(done)
      if (ok) {
        if (opts.success) toast(opts.success, 'good')
        await opts.after?.()
      } else {
        const failed = done.find((s) => s.state === 'failed')
        if (failed?.detail) toast(failed.detail, 'bad')
      }
      return ok
    } catch (err: any) {
      error.value = err?.shortMessage ?? err?.message ?? String(err)
      toast(error.value, 'bad')
      return false
    } finally {
      busy.value = false
    }
  }

  function reset() {
    steps.value = []
    error.value = ''
  }

  return {steps, busy, error, run, reset}
}

/** The approval a seller needs once per collection, and only if it is missing. */
export async function approvalFor(collection: Address, owner: Address, name: string): Promise<Call[]> {
  const ex = exchange()
  if (!ex) throw new Error('This node has no exchange deployed.')
  const approved = await publicClient(endpoint.chainId!).readContract({
    address: collection,
    abi: collectionAbi,
    functionName: 'isApprovedForAll',
    args: [owner, ex.address],
  })
  return approved ? [] : [approveCollectionCall(collection, ex.address, name)]
}

/** The royalty a collection's contract reports, in basis points, or null. */
export async function royaltyBps(collection: Address): Promise<number | null> {
  try {
    const [, amount] = await publicClient(endpoint.chainId!).readContract({
      address: collection,
      abi: collectionAbi,
      functionName: 'royaltyInfo',
      args: [0n, 10_000n],
    })
    return Number(amount)
  } catch {
    return null
  }
}
