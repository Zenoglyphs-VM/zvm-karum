// Exact per-item settlement estimates for the exchange's current source snapshot.
// The listing signature does not lock future exchange fees or collection royalties.
import type {Address, Hex} from 'viem'

const UINT256_MAX = (1n << 256n) - 1n
const ZERO = '0x0000000000000000000000000000000000000000'
export type Royalty = {receiver: Address; amount: bigint}
export type SaleItem = {collection: Address; tokenId: bigint}
export type SaleHead = {hash: Hex; number: Hex}
export type SaleAmounts = {fee: bigint; royalty: bigint; proceeds: bigint}
export type SaleEstimate = {head: SaleHead; price: bigint; amounts: SaleAmounts[]}
export type SaleSource = {
  head: (number?: Hex) => Promise<SaleHead>
  feeBps: (hash: Hex) => Promise<bigint>
  feeRecipient: (hash: Hex) => Promise<Address>
  royaltyCapBps: (hash: Hex) => Promise<bigint>
  royalty: (hash: Hex, item: SaleItem, price: bigint) => Promise<Royalty>
}
export type SalePreview = {status: 'idle' | 'loading' | 'unavailable' | 'ready'; estimate: SaleEstimate | null}

function uint(value: bigint): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > UINT256_MAX) throw new Error('Invalid sale amount.')
  return value
}
function address(value: string): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) throw new Error('Invalid sale address.')
  return value as Address
}
function share(price: bigint, bps: bigint): bigint {
  const product = price * uint(bps)
  if (product > UINT256_MAX) throw new Error('The sale calculation exceeds the exchange amount range.')
  return product / 10_000n
}

/** Match _royalty and _settle, including independent floors and disabled receivers. */
export function saleAmounts(price: bigint, feeBps: bigint, feeRecipient: Address, capBps: bigint, royalty: Royalty): SaleAmounts {
  uint(price); uint(feeBps); uint(capBps); uint(royalty.amount)
  const receiver = address(royalty.receiver), recipient = address(feeRecipient)
  let payment = 0n
  if (receiver.toLowerCase() !== ZERO) {
    const cap = share(price, capBps)
    payment = royalty.amount > cap ? cap : royalty.amount
  }
  const fee = recipient.toLowerCase() === ZERO ? 0n : share(price, feeBps)
  if (payment + fee > price) throw new Error('The sale deductions exceed its price.')
  return {royalty: payment, fee, proceeds: price - payment - fee}
}

/** One hash-selected snapshot, shared fee reads and at most four active royalty reads. */
export async function estimateSale(source: SaleSource, selected: readonly SaleItem[], price: bigint,
  current: () => boolean = () => true): Promise<SaleEstimate> {
  uint(price)
  if (!selected.length) throw new Error('Select an item to estimate its proceeds.')
  const items = selected.map(item => ({collection: address(item.collection), tokenId: uint(item.tokenId)}))
  const guard = () => {if (!current()) throw new Error('The sale estimate changed.')}
  guard()
  const head = await source.head()
  guard()
  if (!/^0x[0-9a-f]{64}$/i.test(head.hash) || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(head.number)) throw new Error('Sale block unavailable.')
  const [feeBps, recipient, capBps] = await Promise.all([
    source.feeBps(head.hash), source.feeRecipient(head.hash), source.royaltyCapBps(head.hash),
  ])
  guard()
  const amounts: SaleAmounts[] = new Array(items.length)
  let next = 0, stopped = false
  const worker = async () => {
    try {
      while (!stopped && next < items.length) {
        guard()
        const index = next++
        const royalty = await source.royalty(head.hash, items[index], price)
        guard()
        amounts[index] = saleAmounts(price, feeBps, recipient, capBps, royalty)
      }
    } catch (error) {stopped = true; throw error}
  }
  await Promise.all(Array.from({length: Math.min(4, items.length)}, worker))
  guard()
  const canonical = await source.head(head.number)
  guard()
  if (canonical.hash.toLowerCase() !== head.hash.toLowerCase() || canonical.number !== head.number) throw new Error('The sale block changed.')
  return {head: {...head}, price, amounts}
}

/** Late reads may never replace a newer form, endpoint, selection or closed dialog. */
export function salePreview(publish: (value: SalePreview) => void) {
  let generation = 0
  return {
    clear() {generation++; publish({status: 'idle', estimate: null})},
    async load(source: SaleSource, items: readonly SaleItem[], price: bigint) {
      const own = ++generation
      publish({status: 'loading', estimate: null})
      try {
        const estimate = await estimateSale(source, items, price, () => own === generation)
        if (own === generation) publish({status: 'ready', estimate})
      } catch {
        if (own === generation) publish({status: 'unavailable', estimate: null})
      }
    },
  }
}
