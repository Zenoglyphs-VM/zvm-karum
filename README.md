# Karum

An NFT marketplace for the ZVM, the EVM that Zenon's Network of Momentum
orders. A static site with no backend: every collection, item and order is read
from a ZVM node, the one the build names or one chosen in the header.

```sh
git clone --recurse-submodules https://github.com/Zenoglyphs-VM/zvm-karum
npm install
cp .env.example .env
npm run dev        # http://localhost:47400/zvm-karum/
npm run build      # dist/
npm run typecheck
npm run verify     # a real trade against a running node, in headless Chrome
```

No node is built in. `VITE_ZVM_NODE` names the node this build reads (the build
stops without it) and `VITE_ZVM_PRESETS` adds more to the picker;
`.env.example` has
a local [zvm-devnet](https://github.com/Zenoglyphs-VM/zvm-devnet)'s. The shared code (`@zvm/web`) is compiled
from the [zvm-core](https://github.com/Zenoglyphs-VM/zvm-core) submodule.

Listing is an EIP-712 signature and costs nothing; buying is a transaction, and
a cart of many items is one. The order book belongs to the node, so a different
node shows the same items with possibly different offers.

## Deploy

Every push to `main` publishes to GitHub Pages (Settings, Pages, Source:
GitHub Actions), built with the organisation's `ZVM_NODE` and `ZVM_GATEWAY`
Actions variables. Add `public/CNAME` to serve from a domain's root.

MIT licence. The full guide, with how it works and why:
[docs/GUIDE.md](docs/GUIDE.md).
