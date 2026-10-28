// The collection factory and a collection, as calls this page can make. The
// exchange and its signed orders are in orders.ts.

import {decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex} from 'viem'
import type {Call} from './tx'

export const factoryEventAbi = parseAbi([
  'event CollectionCreated(address indexed collection, address indexed creator, string name, string symbol)',
])

export const transferEventAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'])

export const collectionAbi = parseAbi([
  'function name() view returns (string)',
  'function owner() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function nextTokenId() view returns (uint256)',
  'function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address, uint256)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function mint(address to, string uri) returns (uint256)',
  'function drop() view returns (uint128 price, uint32 maxSupply, uint32 maxPerWallet, uint32 start, uint32 end)',
  'function dropMinted(address) view returns (uint256)',
  'function publicMint(uint256 quantity) payable returns (uint256)',
  'function setDrop(uint128 price, uint32 maxSupply, uint32 maxPerWallet, uint32 start, uint32 end)',
  'function transferFrom(address from, address to, uint256 tokenId)',
])

export const factoryAbi = parseAbi([
  'function createCollection(string name, string symbol, string contractURI, string baseURI, uint96 royaltyBps) returns (address)',
])

type RawLog = {address: string; topics: readonly string[]; data: string}

/** The collection a create transaction made, read from the factory's own event. */
export function collectionFromLogs(logs: readonly RawLog[], factory: string): Address | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({abi: factoryEventAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]]})
      if (decoded.eventName === 'CollectionCreated') return (decoded.args as {collection: Address}).collection
    } catch {
      /* another event from the same contract */
    }
  }
  return null
}

/** The token a mint created: the first Transfer out of nothing. */
export function mintedTokenId(logs: readonly RawLog[], collection: string): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== collection.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({abi: transferEventAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]]})
      const args = decoded.args as {from: Address; tokenId: bigint}
      if (/^0x0{40}$/i.test(args.from)) return args.tokenId
    } catch {
      /* not a Transfer */
    }
  }
  return null
}

export function approveCollectionCall(collection: Address, operator: Address, name = 'this collection'): Call {
  return {
    to: collection,
    value: 0n,
    label: `Let the exchange move ${name}`,
    data: encodeFunctionData({abi: collectionAbi, functionName: 'setApprovalForAll', args: [operator, true]}),
  }
}

/** Removes this exchange operator permission for every token in the collection. */
export function revokeCollectionCall(collection: Address, operator: Address, name = 'this collection'): Call {
  return {
    to: collection,
    value: 0n,
    label: `Revoke exchange access to ${name}`,
    data: encodeFunctionData({abi: collectionAbi, functionName: 'setApprovalForAll', args: [operator, false]}),
  }
}

export function createCollectionCall(factory: Address, name: string, symbol: string, contractURI: string, royaltyBps: number): Call {
  return {
    to: factory,
    value: 0n,
    label: `Create ${name}`,
    data: encodeFunctionData({abi: factoryAbi, functionName: 'createCollection', args: [name, symbol, contractURI, '', BigInt(royaltyBps)]}),
  }
}

export function mintCall(collection: Address, to: Address, uri: string, label: string): Call {
  return {to: collection, value: 0n, label, data: encodeFunctionData({abi: collectionAbi, functionName: 'mint', args: [to, uri]})}
}

export function publicMintCall(collection: Address, quantity: number, price: bigint, label: string): Call {
  return {
    to: collection,
    value: price * BigInt(quantity),
    label,
    data: encodeFunctionData({abi: collectionAbi, functionName: 'publicMint', args: [BigInt(quantity)]}),
  }
}

export interface DropTerms {
  price: bigint
  maxSupply: number
  maxPerWallet: number
  start: number
  end: number
}

export function setDropCall(collection: Address, d: DropTerms): Call {
  return {
    to: collection,
    value: 0n,
    label: 'Open the drop',
    data: encodeFunctionData({abi: collectionAbi, functionName: 'setDrop', args: [d.price, d.maxSupply, d.maxPerWallet, d.start, d.end]}),
  }
}

export function transferCall(collection: Address, from: Address, to: Address, tokenId: bigint, label: string): Call {
  return {to: collection, value: 0n, label, data: encodeFunctionData({abi: collectionAbi, functionName: 'transferFrom', args: [from, to, tokenId]})}
}

/** The metadata a mint writes, in the shape every marketplace reads. */
export function metadataDoc(name: string, description: string, image: string, traits: {trait_type: string; value: string}[]) {
  return {name, description, image, attributes: traits.filter((t) => t.trait_type && t.value)}
}
