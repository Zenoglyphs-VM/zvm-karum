// The names of the chains this app knows, for the node picker and a wallet's
// add-chain prompt. Everything else about a chain (the exchange, the factory,
// the media store) comes from the node's /api/info, which is what keeps this
// working after a devnet is re-genesised.

export const CHAIN_NAMES: Record<number, string> = {
  7340469: 'ZVM devnet',
}

export function chainName(chainId: number | null): string {
  if (chainId === null) return 'Unknown chain'
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`
}
