import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule} from 'node:vm'

const module = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/core/sale-proceeds.ts', import.meta.url), 'utf8'), {mode: 'strip'}), {context: createContext({})})
await module.link(() => {throw new Error('Unexpected pure settlement import')})
await module.evaluate({timeout: 5000})
const {saleAmounts, estimateSale, salePreview} = module.namespace
const zero = '0x' + '0'.repeat(40), receiver = '0x' + '1'.repeat(40), feeRecipient = '0x' + '2'.repeat(40)
const hash = '0x' + 'a'.repeat(64), other = '0x' + 'b'.repeat(64), max = (1n << 256n) - 1n
const head = {hash, number: '0x6'}, selected = [{collection: receiver, tokenId: 7n}, {collection: receiver, tokenId: 8n}]
const royalty = (amount = 750000n) => ({receiver, amount})
const defer = () => {let resolve; const promise = new Promise(r => {resolve = r}); return {promise, resolve}}
function source(overrides = {}) {
  return {head: async () => ({...head}), feeBps: async () => 200n, feeRecipient: async () => feeRecipient,
    royaltyCapBps: async () => 1000n, royalty: async () => royalty(), ...overrides}
}

test('separate fee and royalty floors preserve the base unit lost by a combined rate', () => {
  const q = saleAmounts(20000018n, 200n, feeRecipient, 1000n, royalty())
  assert.equal(q.royalty, 750000n); assert.equal(q.fee, 400000n); assert.equal(q.proceeds, 18850018n)
  assert.equal(20000018n - 20000018n * 575n / 10000n, 18850017n)
})
test('a reported royalty above the exchange cap cannot reduce seller proceeds below the capped amount', () => {
  const q = saleAmounts(20000018n, 200n, feeRecipient, 1000n, royalty(20000018n))
  assert.equal(q.royalty, 2000001n); assert.equal(q.fee, 400000n); assert.equal(q.proceeds, 17600017n)
})
test('an exact royalty amount is not replaced by a token-zero basis-point sample', () => {
  assert.equal(saleAmounts(20000018n, 200n, feeRecipient, 1000n, royalty(123457n)).proceeds, 19476561n)
})
test('a zero royalty receiver disables its transfer before cap multiplication', () => {
  const q = saleAmounts(max, 0n, zero, 1000n, {receiver: zero, amount: max})
  assert.equal(q.royalty, 0n); assert.equal(q.proceeds, max)
})
test('a zero fee recipient disables its fee before multiplication', () => {
  assert.equal(saleAmounts(max, max, zero, 0n, {receiver: zero, amount: 0n}).proceeds, max)
})
test('a one-base-unit sale retains both independently rounded zero deductions', () => {
  const q = saleAmounts(1n, 250n, feeRecipient, 1000n, royalty(1n))
  assert.equal(q.royalty, 0n); assert.equal(q.fee, 0n); assert.equal(q.proceeds, 1n)
})
test('fee multiplication overflow is unavailable rather than a fabricated large proceeds amount', () => {
  assert.throws(() => saleAmounts(max, 200n, feeRecipient, 1000n, {receiver: zero, amount: 0n}), /range/)
})
test('cap multiplication overflow is detected even when the reported royalty is zero', () => {
  assert.throws(() => saleAmounts(max, 0n, zero, 1000n, royalty(0n)), /range/)
})
test('deductions that would underflow settlement never become negative preview text', () => {
  assert.throws(() => saleAmounts(100n, 200n, feeRecipient, 10000n, royalty(100n)), /exceed/)
})
test('invalid unsigned inputs and malformed receivers are refused', () => {
  for (const bad of [-1n, max + 1n, 1.5, '10']) assert.throws(() => saleAmounts(bad, 200n, feeRecipient, 1000n, royalty()))
  assert.throws(() => saleAmounts(100n, 200n, 'invalid', 1000n, royalty()))
})
test('every selected token gets an exact quote while fee and cap settings are shared once', async () => {
  const calls = [], settings = []
  const q = await estimateSale(source({feeBps: async h => {settings.push(['fee', h]); return 200n},
    feeRecipient: async h => {settings.push(['recipient', h]); return feeRecipient},
    royaltyCapBps: async h => {settings.push(['cap', h]); return 1000n},
    royalty: async (h, item, price) => {calls.push([h, item.tokenId, price]); return royalty(item.tokenId === 7n ? 750000n : 20000018n)}}), selected, 20000018n)
  assert.deepEqual(calls, [[hash, 7n, 20000018n], [hash, 8n, 20000018n]])
  assert.equal(settings.length, 3); assert.ok(settings.every(row => row[1] === hash))
  assert.deepEqual(Array.from(q.amounts, row => row.proceeds), [18850018n, 17600017n])
})
test('the selected block is rechecked after all reads and a canonical replacement rejects the estimate', async () => {
  let reads = 0
  await assert.rejects(estimateSale(source({head: async number => {reads++; return {hash: number ? other : hash, number: '0x6'}}}), selected, 20000018n), /block changed/)
  assert.equal(reads, 2)
})
test('a missing or pending block cannot reach fee or royalty calls', async () => {
  let reads = 0
  await assert.rejects(estimateSale(source({head: async () => ({hash: null, number: null}), feeBps: async () => {reads++; return 200n}}), selected, 20000018n))
  assert.equal(reads, 0)
})
test('an RPC royalty failure remains unknown instead of a zero deduction', async () => {
  await assert.rejects(estimateSale(source({royalty: async () => {throw new Error('Unavailable RPC')}}), selected, 20000018n), /Unavailable RPC/)
})
test('an empty or malformed selection never starts a snapshot read', async () => {
  let heads = 0
  const s = source({head: async () => {heads++; return head}})
  await assert.rejects(estimateSale(s, [], 1n)); await assert.rejects(estimateSale(s, [{collection: 'invalid', tokenId: 7n}], 1n))
  assert.equal(heads, 0)
})
test('the selected item values are captured before the first asynchronous read', async () => {
  const gate = defer(), items = [{collection: receiver, tokenId: 7n}], ids = []
  const pending = estimateSale(source({head: async () => {await gate.promise; return head}, royalty: async (_h, item) => {ids.push(item.tokenId); return royalty()}}), items, 20000018n)
  items[0].tokenId = 99n; gate.resolve(); await pending
  assert.deepEqual(ids, [7n])
})
test('the reader bounds concurrent royalty requests while retaining the complete selection', async () => {
  let active = 0, peak = 0, reads = 0
  const items = Array.from({length: 11}, (_, i) => ({collection: receiver, tokenId: BigInt(i + 1)}))
  const q = await estimateSale(source({royalty: async () => {active++; reads++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 0)); active--; return royalty()}}), items, 20000018n)
  assert.equal(reads, 11); assert.equal(q.amounts.length, 11); assert.ok(peak <= 4 && peak > 1)
})
test('a failed worker prevents dispatching the rest of a large selection', async () => {
  let reads = 0
  const items = Array.from({length: 20}, (_, i) => ({collection: receiver, tokenId: BigInt(i)}))
  await assert.rejects(estimateSale(source({royalty: async () => {reads++; throw new Error('failed read')}}), items, 20000018n))
  assert.ok(reads <= 4)
})
test('a late old-price response cannot replace the newer form estimate', async () => {
  const updates = [], loader = salePreview(value => updates.push(value)), gate = defer()
  const old = loader.load(source({head: async () => {await gate.promise; return head}}), selected, 20000018n)
  await loader.load(source(), selected, 30000018n)
  gate.resolve(); await old
  assert.equal(updates.at(-1).status, 'ready'); assert.equal(updates.at(-1).estimate.price, 30000018n)
})
test('closing or changing an endpoint clears old state and fences its in-flight reads', async () => {
  const updates = [], loader = salePreview(value => updates.push(value)), gate = defer()
  const pending = loader.load(source({head: async () => {await gate.promise; return head}}), selected, 20000018n)
  loader.clear(); gate.resolve(); await pending
  assert.equal(updates.at(-1).status, 'idle'); assert.equal(updates.at(-1).estimate, null)
})
test('a failed new estimate clears a previously ready value', async () => {
  const updates = [], loader = salePreview(value => updates.push(value))
  await loader.load(source(), selected, 20000018n)
  await loader.load(source({feeBps: async () => {throw new Error('offline')}}), selected, 20000018n)
  assert.equal(updates.at(-1).status, 'unavailable'); assert.equal(updates.at(-1).estimate, null)
})
