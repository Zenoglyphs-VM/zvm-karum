import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'
import {parseAbi, encodeFunctionData, decodeFunctionData, encodeAbiParameters, parseAbiParameters} from 'viem'

// This actual-SDK adapter suite runs in the existing hosted npm qualification.
const context = createContext({}), core = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/core/sale-proceeds.ts', import.meta.url), 'utf8'), {mode: 'strip'}), {context})
await core.link(() => {throw new Error('Unexpected pure source import')}); await core.evaluate({timeout: 5000})
const adapter = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/core/sale-proceeds-rpc.ts', import.meta.url), 'utf8'), {mode: 'strip'}), {context})
await adapter.link(name => {
  assert.equal(name, 'viem')
  return new SyntheticModule(['parseAbi', 'encodeFunctionData'], function () {this.setExport('parseAbi', parseAbi); this.setExport('encodeFunctionData', encodeFunctionData)}, {context})
}); await adapter.evaluate({timeout: 5000})
const {saleSource, royaltyResult} = adapter.namespace, {estimateSale} = core.namespace
const zero = '0x' + '0'.repeat(40), recipient = '0x' + '1'.repeat(40), exchange = '0x' + '2'.repeat(40)
const hash = '0x' + 'a'.repeat(64), head = {hash, number: '0x6'}
const abi = parseAbi(['function feeBps() view returns (uint256)', 'function feeRecipient() view returns (address)',
  'function MAX_ROYALTY_BPS() view returns (uint256)', 'function royaltyInfo(uint256,uint256) view returns (address,uint256)'])
const scalar = n => encodeAbiParameters(parseAbiParameters('uint256'), [n])
const encodedRoyalty = (receiver, amount) => encodeAbiParameters(parseAbiParameters('address,uint256'), [receiver, amount])

test('actual SDK calldata binds the selected token and complete sale price to canonical hash calls', async () => {
  const calls = []
  const s = saleSource(async request => {
    if (request.method === 'eth_getBlockByNumber') return {...head}
    const [tx, block] = request.params; assert.equal(block.blockHash, hash); assert.equal(block.requireCanonical, true)
    const decoded = decodeFunctionData({abi, data: tx.data}); calls.push({to: tx.to, ...decoded})
    if (decoded.functionName === 'feeBps') return scalar(200n)
    if (decoded.functionName === 'feeRecipient') return encodeAbiParameters(parseAbiParameters('address'), [recipient])
    if (decoded.functionName === 'MAX_ROYALTY_BPS') return scalar(1000n)
    assert.equal(tx.to, recipient); assert.deepEqual(decoded.args, [7n, 20000018n])
    return encodedRoyalty(recipient, 20000018n)
  }, exchange)
  const q = await estimateSale(s, [{collection: recipient, tokenId: 7n}], 20000018n)
  assert.equal(q.amounts[0].royalty, 2000001n); assert.equal(q.amounts[0].fee, 400000n); assert.equal(q.amounts[0].proceeds, 17600017n)
  assert.equal(calls.length, 4)
})
test('a successful short royalty response follows the exchange no-royalty branch', () => {
  for (const raw of ['0x', '0x1234', '0x' + '00'.repeat(63)]) {
    const value = royaltyResult(raw); assert.equal(value.receiver, zero); assert.equal(value.amount, 0n)
  }
})
test('a normal or zero receiver retains the reported exact uint256 royalty amount', () => {
  for (const receiver of [recipient, zero]) {
    const value = royaltyResult(encodedRoyalty(receiver, (1n << 256n) - 1n))
    assert.equal(value.receiver.toLowerCase(), receiver); assert.equal(value.amount, (1n << 256n) - 1n)
  }
})
test('invalid address padding cannot become an apparently valid proceeds quote', () => {
  assert.throws(() => royaltyResult('0x01' + '00'.repeat(63)), /recipient/)
})
test('malformed RPC bytes never become a zero royalty', () => {
  for (const raw of ['0x1', '0xgg', null, 1]) assert.throws(() => royaltyResult(raw))
})
test('an RPC call error is not relabelled as a successful short staticcall', async () => {
  const s = saleSource(async () => {throw new Error('RPC unavailable')}, exchange)
  await assert.rejects(s.royalty(hash, {collection: recipient, tokenId: 7n}, 20000018n), /RPC unavailable/)
})
test('a missing latest header remains unavailable', async () => {
  const s = saleSource(async () => null, exchange)
  await assert.rejects(s.head(), /block unavailable/)
})
