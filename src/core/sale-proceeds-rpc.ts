// Read settlement inputs at one canonical block without guessing a token-zero rate.
import {encodeFunctionData, parseAbi, type Address, type Hex} from 'viem'
import type {Royalty, SaleHead, SaleSource} from './sale-proceeds'

type SnapshotRequest =
  | {method: 'eth_getBlockByNumber'; params: [Hex | 'latest', false]}
  | {method: 'eth_call'; params: [{to: Address; data: Hex}, {blockHash: Hex; requireCanonical: true}]}
export type SnapshotRequestFn = (request: SnapshotRequest) => Promise<unknown>
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const exchangeAbi = parseAbi([
  'function feeBps() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function MAX_ROYALTY_BPS() view returns (uint256)',
])
const royaltyAbi = parseAbi(['function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address, uint256)'])

function bytes(raw: unknown): string {
  if (typeof raw !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(raw)) throw new Error('Sale response unavailable.')
  return raw.slice(2)
}
function scalar(raw: unknown): bigint {
  const data = bytes(raw)
  if (data.length !== 64) throw new Error('Sale amount unavailable.')
  return BigInt('0x' + data)
}
function recipient(word: string): Address {
  if (word.length !== 64 || !/^0{24}/i.test(word)) throw new Error('Sale recipient unavailable.')
  return ('0x' + word.slice(24)) as Address
}
export function royaltyResult(raw: unknown): Royalty {
  const data = bytes(raw)
  // A successful short staticcall is treated as no royalty by the exchange.
  if (data.length < 128) return {receiver: ZERO, amount: 0n}
  return {receiver: recipient(data.slice(0, 64)), amount: BigInt('0x' + data.slice(64, 128))}
}

export function saleSource(request: SnapshotRequestFn, exchange: Address): SaleSource {
  const call = async (to: Address, data: Hex, hash: Hex) =>
    request({method: 'eth_call', params: [{to, data}, {blockHash: hash, requireCanonical: true}]})
  return {
    async head(number) {
      const raw = await request({method: 'eth_getBlockByNumber', params: [number ?? 'latest', false]})
      if (!raw || typeof raw !== 'object' || !('hash' in raw) || !('number' in raw) || typeof raw.hash !== 'string' || typeof raw.number !== 'string') throw new Error('Sale block unavailable.')
      return {hash: raw.hash, number: raw.number} as SaleHead
    },
    async feeBps(hash) {return scalar(await call(exchange, encodeFunctionData({abi: exchangeAbi, functionName: 'feeBps'}), hash))},
    async feeRecipient(hash) {return recipient(bytes(await call(exchange, encodeFunctionData({abi: exchangeAbi, functionName: 'feeRecipient'}), hash)))},
    async royaltyCapBps(hash) {return scalar(await call(exchange, encodeFunctionData({abi: exchangeAbi, functionName: 'MAX_ROYALTY_BPS'}), hash))},
    async royalty(hash, item, price) {
      // RPC failures remain unavailable. They are never relabelled as a zero deduction.
      return royaltyResult(await call(item.collection, encodeFunctionData({abi: royaltyAbi, functionName: 'royaltyInfo', args: [item.tokenId, price]}), hash))
    },
  }
}
