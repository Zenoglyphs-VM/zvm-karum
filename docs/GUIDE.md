# Karum guide

An NFT marketplace for the **ZVM**, the EVM that Zenon's Network of Momentum
orders. It is OpenSea's and Magic Eden's shape in the Zenon design system: a
static site with no backend of its own. Every collection, item and order on the
page is read by your browser from the ZVM node you point it at.

A karum was the merchants' quarter of a Bronze Age city: the traders' own
district beside the walls, where goods changed hands on terms both sides could
read.

```sh
npm install
npm run dev        # http://localhost:47400/zvm-karum/
npm run build      # static files in dist/, ready for GitHub Pages
npm run typecheck
npm run verify     # a real trade against a running node, in headless Chrome
```

## What it does

| Page | |
|---|---|
| `/` | Featured collections in a carousel, market totals, a live sales ticker, top collections, fresh listings, live drops |
| `/collections` | Every collection, ranked; every column sorts, 24h or all time |
| `/collection/:address` | Items with trait filters, price range, rarity ranks and a dense grid; a floor sweep; activity; collection offers; a sales chart and listing depth |
| `/item/:collection/:id` | Buy now, add to cart, make an offer; for the owner, list, change the price, cancel, accept an offer, transfer; price history, traits with their share, item history, more from the collection |
| `/account/:address` | Collected, listings, offers made and received, created collections, activity, value at floor; on your own profile, select many and list them with one signature, or void every order you ever signed |
| `/activity` | Sales and listings across every collection, refreshed on every block |
| `/drops` | Public mints straight from a collection's contract, with supply, per-wallet caps and countdowns |
| `/create` | A collection, an item in one of yours (image and traits stored by the node), or a drop |
| `/watchlist` | What you starred, kept in this browser per chain |

Search is <kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd>: collections by name, an
address, or `Name #12` for an item.

## How trading works here

**Listing is a signature.** An order is an EIP-712 signature, as on OpenSea and
Blur: free, instant, and one signature over a Merkle root lists many items at
once. The seller's only transaction is a once-per-collection approval. Offers
are paid in wrapped ZNN against an allowance, so nothing is locked while one
stands; the offer dialog wraps and approves first when either is short.

**The cart is one transaction.** Every purchase waits for a momentum to order it
and the next block to execute it, about thirty seconds on the devnets. Ten
separate purchases would be ten of those; `buyMany` is one. Checkout asks the
node for every order again first and takes out anything sold since it was
carted, and the exchange itself skips an input it cannot fill and refunds its
price.

**The book belongs to a node.** A signature is not chain state, so each node
keeps the orders it was handed (D36 in `zvm-docs/spec/DECISIONS.md`). Point the
page at a different node and the items are the same; the offers on them may not
be.

## Talking to a node

The node menu takes a JSON-RPC URL, by default the one `VITE_ZVM_NODE` names
at build time (no node is built in; `.env.example` has a local zvm-devnet's), and
a `?rpc=` query parameter carries it in a link. The market is read from the
API beside that RPC (the URL without `/rpc`), because the two things every page
needs cannot come from the chain: who holds what across a collection, which the
node's index answers, and the unfilled orders, which only the node has. A bare
op-reth URL passes the chain check and is then told plainly that it serves no
market.

Images and metadata resolve against the node, not against this page. Objects
are stored under the hash of their bytes, so `https://nft.example.org/<hash>.png`
and the same object served by a node are the same thing, and the page loads
whichever the node says to. Uploading asks the wallet for one Sign-In with
Ethereum signature per session, bound to the node's host.

## Deploying

`.github/workflows/pages.yml` builds on every push to `main`, with the
organisation's `ZVM_NODE` and `ZVM_GATEWAY` Actions variables, and publishes to
GitHub Pages. Enable Pages for the repository with **GitHub Actions** as the
source. A project site is served from `/<repo>/` and the workflow sets the base
path from the repository's name; add `public/CNAME` for a custom domain and it
builds for `/` instead. The build copies `index.html` to `404.html`, which is
how a deep link to an item survives Pages having no SPA rewrite.

An HTTPS page cannot call a plain-HTTP node, except `http://localhost`, which
browsers treat as trustworthy. So the deployed site works against a public node
over HTTPS and against a node on your own machine, and not against a LAN
address; the node menu says so before you try.

## Shared code

The chain definition, bech32, number formatting, the relayer's fee floor, the
price store and the shared marks come from `@zvm/web`, compiled from the
zvm-core submodule through a Vite alias, as in the explorer and glyphswap.
Clone with `--recurse-submodules`. Moving to a newer zvm-core is a submodule
bump: those are exactly the things that must agree between apps.

## Motion

The site moves more than the explorer does, because browsing art is a different
act from reading a ledger: cards lift and their art zooms under the pointer,
grids arrive in a stagger, the hero slides in the direction you moved, the
sales ticker scrolls, and a purchase bursts plasma from the button that made
it.

All of it runs whatever the system's motion preference says. Windows reports
`prefers-reduced-motion: reduce` whenever "Animation effects" is off, and the
explorer's rule of cutting every animation to zero under it left this market
standing still on machines where nobody chose that; so Karum has no
reduced-motion rule at all, and neither does the shared background lattice.

## Verifying

`npm run verify` needs a running node with its faucet (the first argument, or
`ZVM_RPC`) and the dev server. It funds two throwaway keys, and through the
pages: creates a collection with an uploaded image, mints an item with a trait,
lists it (approval, then signature), and has the second wallet buy it through
the cart; then it reads `ownerOf` on chain, renders the light theme, and fails
if any page scrolls sideways at 400px. Set `KARUM_SHOTS` to a directory to keep
screenshots.
