// Drives the real pages against a running ZVM node, in headless Chrome, and
// makes a real trade.
//
//   node scripts/verify.mjs [rpc, default $ZVM_RPC] [http://localhost:47400/zvm-karum/]
//
// Two stand-in EIP-6963 wallets, a seller and a buyer, sign with throwaway keys
// the node's faucet funds, exactly as MetaMask would: transactions, EIP-712
// orders and the media store's Sign-In with Ethereum. Nothing under the wallet
// is mocked. The seller creates a collection with an uploaded image, mints an
// item into it and lists it (an approval transaction, then a signature); the
// buyer puts it in the cart and checks out. Zenon orders each transaction, the
// deriver derives it, op-reth runs it, and the script reads ownerOf at the end.
//
// Set KARUM_SHOTS to a directory to keep screenshots.

import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import puppeteer from 'puppeteer-core'
import {createPublicClient, createWalletClient, defineChain, http, parseAbi} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'

const rpc = process.argv[2] ?? process.env.ZVM_RPC
if (!rpc) throw new Error("pass the node's JSON-RPC, or set ZVM_RPC")
const app = process.argv[3] ?? 'http://localhost:47400/zvm-karum/'
const apiBase = rpc.replace(/\/rpc$/, '')
const shots = process.env.KARUM_SHOTS
if (shots) mkdirSync(shots, {recursive: true})

const started = Date.now()
const log = (msg) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${msg}`)

const chromePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p))
if (!chromePath) throw new Error('no Chrome found')

const info = await (await fetch(`${apiBase}/api/info`)).json()
if (!info.apps?.exchange) throw new Error(`${apiBase} serves no market: /api/info has no apps.exchange`)
const chain = defineChain({
  id: info.l2.chainId,
  name: 'ZVM',
  nativeCurrency: {name: 'Zenon', symbol: 'ZNN', decimals: 18},
  rpcUrls: {default: {http: [rpc]}},
})
const client = createPublicClient({chain, transport: http(rpc)})
const erc721 = parseAbi(['function ownerOf(uint256) view returns (address)'])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(fn, ms, what) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return
    await sleep(2000)
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function fund(address) {
  // The faucet has a short per-address cooldown and a shared one; retry
  // through it rather than failing the run on the second wallet.
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${apiBase}/api/faucet`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({address}),
    })
    if (res.ok) break
    if (i === 9) throw new Error(`faucet: ${await res.text()}`)
    await sleep(6000)
  }
  await until(async () => (await client.getBalance({address})) > 0n, 240_000, `faucet ZNN for ${address}`)
}

// --- the stand-in wallets ------------------------------------------------------

function standIn(account) {
  const signer = createWalletClient({account, chain, transport: http(rpc)})
  return async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address]
      case 'eth_chainId':
        return `0x${chain.id.toString(16)}`
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
      case 'wallet_watchAsset':
        return null
      case 'personal_sign':
        return account.signMessage({message: {raw: params[0]}})
      case 'eth_signTypedData_v4': {
        const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
        const {EIP712Domain, ...types} = typed.types
        return account.signTypedData({domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message})
      }
      case 'eth_sendTransaction': {
        const [tx] = params
        return signer.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : 0n,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
          maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
        })
      }
      default:
        return client.request({method, params})
    }
  }
}

const seller = privateKeyToAccount(generatePrivateKey())
const buyer = privateKeyToAccount(generatePrivateKey())
log(`seller ${seller.address}`)
log(`buyer  ${buyer.address}`)
await fund(seller.address)
await fund(buyer.address)
log('both funded')

const browser = await puppeteer.launch({executablePath: chromePath, headless: 'new', args: ['--no-sandbox', '--disable-gpu']})
const problems = []

async function openAs(account, name) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({width: 1360, height: 1000, deviceScaleFactor: 1})
  page.on('pageerror', (err) => problems.push(`${name}: page error: ${err.message}`))
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: console: ${m.text()}`))
  await page.exposeFunction('__evm', standIn(account))
  await page.evaluateOnNewDocument((label) => {
    const provider = {request: ({method, params}) => window.__evm(method, params ?? []), on() {}, removeListener() {}}
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({info: {uuid: `karum-verify-${label}`, name: 'Test wallet', icon: '', rdns: 'test.karum'}, provider}),
        }),
      )
    window.addEventListener('eip6963:requestProvider', announce)
  }, name)
  return page
}

const url = (path) => `${app}${path.replace(/^\//, '')}${path.includes('?') ? '&' : '?'}rpc=${encodeURIComponent(rpc)}`
const shot = async (page, name) => shots && page.screenshot({path: join(shots, `${name}.png`), fullPage: true})

// A closed <dialog> keeps its buttons in the DOM, so every lookup is scoped to
// what a person could actually see and press.
const visibleButton = (text, selector) =>
  [...document.querySelectorAll(selector)]
    .filter((el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null))
    .find((b) => b.textContent.trim().startsWith(text) && !b.disabled)

async function click(page, text, selector = 'button') {
  const fn = `(${visibleButton})(${JSON.stringify(text)}, ${JSON.stringify(selector)})`
  await page.waitForFunction(fn, {timeout: 40_000}).catch(async () => {
    const offered = await page.evaluate(
      (sel) => [...document.querySelectorAll(sel)].filter((el) => el.checkVisibility()).map((b) => b.textContent.trim()).slice(0, 30),
      selector,
    )
    throw new Error(`no visible "${text}" (${selector}); the page offers ${JSON.stringify(offered)}`)
  })
  await page.evaluate(`${fn}.click()`)
}

async function connect(page) {
  await click(page, 'Connect wallet')
  await click(page, 'Test wallet')
  await page.waitForFunction(() => !document.querySelector('[data-testid="connect"]')?.textContent.includes('Connect'), {timeout: 20_000})
}

/**
 * Waits for an action's outcome, and fails fast with the step list when a
 * step failed or an error toast appeared rather than waiting out the timeout.
 */
async function outcome(page, done, what, ms = 420_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const state = await page.evaluate(`(() => {
      const steps = [...document.querySelectorAll('li[data-state]')].map((li) => ({state: li.dataset.state, text: li.textContent.replace(/\\s+/g, ' ').trim()}))
      const bad = [...document.querySelectorAll('[data-toast][data-tone="bad"]')].map((t) => t.textContent.trim())
      return {steps, bad, done: (${done})()}
    })()`)
    if (state.done) {
      for (const s of state.steps.filter((s, i, a) => a.findIndex((x) => x.text === s.text) === i)) log(`   ${s.state === 'done' ? 'ok  ' : s.state} ${s.text}`)
      return
    }
    if (state.bad.length || state.steps.some((s) => s.state === 'failed')) {
      for (const s of state.steps) log(`   ${s.state} ${s.text}`)
      throw new Error(`${what}: ${state.bad.join(' | ') || 'a step failed'}`)
    }
    await sleep(1000)
  }
  throw new Error(`${what}: timed out`)
}

let failed = false
try {
  // --- reading ---------------------------------------------------------------
  const sp = await openAs(seller, 'seller')
  await sp.goto(url('/'), {waitUntil: 'networkidle2', timeout: 60_000})
  await sp.waitForFunction(() => document.querySelectorAll('tbody tr.cursor-pointer').length > 0, {timeout: 60_000})
  log('home lists collections')
  await shot(sp, '01-home')

  // Search is Ctrl K; typing a collection's name and Enter must land on it.
  const first = await sp.$eval('tbody tr.cursor-pointer .font-medium', (el) => el.textContent.trim())
  await sp.keyboard.down('Control')
  await sp.keyboard.press('KeyK')
  await sp.keyboard.up('Control')
  await sp.waitForSelector('[role="dialog"][aria-label="Search"] input', {timeout: 5000})
  await sp.keyboard.type(first)
  await sleep(200)
  await sp.keyboard.press('Enter')
  await sp.waitForFunction(() => location.pathname.includes('/collection/0x'), {timeout: 10_000})
  await sp.waitForFunction(() => document.querySelectorAll('.nft-card').length > 0, {timeout: 30_000})
  log(`search found "${first}" and its items render`)
  await shot(sp, '02-collection')

  // --- the seller creates, mints and lists -----------------------------------
  const svg = join(tmpdir(), `karum-verify-${Date.now()}.svg`)
  const hue = Math.floor(Math.random() * 360)
  writeFileSync(
    svg,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 70% 20%)"/><path d="M14 14H50L14 50H50" fill="none" stroke="hsl(${hue} 90% 60%)" stroke-width="6"/></svg>`,
  )
  const tag = seller.address.slice(2, 6).toUpperCase()

  await sp.goto(url('/create'), {waitUntil: 'networkidle2'})
  await click(sp, 'Connect', 'button.btn-plasma')
  await click(sp, 'Test wallet')
  await sp.waitForFunction(() => !document.querySelector('[data-testid="connect"]')?.textContent.includes('Connect'), {timeout: 20_000})
  log('seller connected')
  await (await sp.$('input[type="file"]')).uploadFile(svg)
  await sp.type('#name', `Verify ${tag}`)
  await sp.type('#symbol', `V${tag}`)
  await sp.type('#desc', 'Made by scripts/verify.mjs.')
  await click(sp, 'Create collection', 'button.btn-plasma')
  await outcome(sp, () => location.pathname.includes('/collection/0x'), 'create a collection')
  const collection = await sp.evaluate(() => location.pathname.match(/0x[0-9a-fA-F]{40}/)[0])
  log(`created ${collection}`)

  await sp.goto(url('/create?tab=item'), {waitUntil: 'networkidle2'})
  await sp.waitForFunction((c) => [...document.querySelectorAll('#target option')].some((o) => o.value.toLowerCase() === c.toLowerCase()), {timeout: 120_000}, collection)
  await sp.select('#target', await sp.$eval('#target', (el, c) => [...el.options].find((o) => o.value.toLowerCase() === c.toLowerCase()).value, collection))
  await (await sp.$('input[type="file"]')).uploadFile(svg)
  await sp.type('#name', `Verify ${tag} #1`)
  await sp.type('input[placeholder^="Type"]', 'Palette')
  await sp.type('input[placeholder^="Value"]', 'Plasma')
  await click(sp, 'Mint item', 'button.btn-plasma')
  await outcome(sp, () => location.pathname.includes('/item/'), 'mint an item')
  const tokenId = await sp.evaluate(() => location.pathname.split('/').pop())
  log(`minted token ${tokenId}`)

  await sp.waitForSelector('[data-testid="list"]', {timeout: 60_000})
  await sp.click('[data-testid="list"]')
  await sp.waitForSelector('dialog[open] #list-price', {timeout: 10_000})
  await sp.type('dialog[open] #list-price', '0.5')
  await sp.click('[data-testid="list-submit"]')
  await outcome(sp, () => [...document.querySelectorAll('[data-toast]')].some((t) => t.textContent.includes('Listed for')), 'list the item')
  log('listed for 0.5 ZNN: an approval, then a signature')
  await sp.reload({waitUntil: 'networkidle2'})
  await sp.waitForFunction(() => document.body.textContent.includes('Change the price'), {timeout: 60_000})
  await shot(sp, '03-item-seller')

  // --- the buyer checks out --------------------------------------------------
  const bp = await openAs(buyer, 'buyer')
  await bp.goto(url(`/item/${collection}/${tokenId}`), {waitUntil: 'networkidle2'})
  await bp.waitForSelector('[data-testid="buy"]', {timeout: 60_000})
  await connect(bp)
  log('buyer connected, and the listing shows')
  await click(bp, '', 'button[title="Add to cart"]')
  await bp.waitForSelector('[data-testid="checkout"]', {timeout: 10_000})
  await shot(bp, '04-cart')
  await bp.click('[data-testid="checkout"]')
  await outcome(bp, () => [...document.querySelectorAll('[data-toast]')].some((t) => t.textContent.includes('Bought 1 item')), 'check out')
  await until(
    async () => (await client.readContract({address: collection, abi: erc721, functionName: 'ownerOf', args: [BigInt(tokenId)]})).toLowerCase() === buyer.address.toLowerCase(),
    60_000,
    'ownerOf to be the buyer',
  )
  log('ownerOf is the buyer: bought through the cart with buyMany')

  await bp.goto(url(`/account/${buyer.address}`), {waitUntil: 'networkidle2'})
  await bp.waitForFunction((n) => document.body.textContent.includes(n), {timeout: 90_000}, `Verify ${tag} #1`)
  log('the buyer profile shows it')
  await shot(bp, '05-buyer-profile')

  // --- layout ----------------------------------------------------------------
  await bp.evaluate(() => document.querySelector('button[title*="light theme"]')?.click())
  await bp.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', {timeout: 5000})
  await bp.goto(url(`/collection/${collection}`), {waitUntil: 'networkidle2'})
  await shot(bp, '06-light')
  log('light theme rendered')

  await bp.setViewport({width: 400, height: 900})
  for (const path of ['/', `/collection/${collection}`, `/item/${collection}/${tokenId}`, `/account/${buyer.address}`, '/activity', '/create']) {
    await bp.goto(url(path), {waitUntil: 'networkidle2'})
    await sleep(1200)
    const overflow = await bp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (overflow) throw new Error(`${path} scrolls sideways at 400px wide`)
  }
  await shot(bp, '07-narrow')
  log('no page scrolls sideways at 400px')
} catch (err) {
  failed = true
  console.error(`\nFAILED: ${err.message}`)
} finally {
  await browser.close()
}

if (problems.length) {
  console.error('\nBrowser problems:')
  for (const p of [...new Set(problems)]) console.error(`  ${p}`)
}
if (failed || problems.length) process.exit(1)
log('all checks passed')
