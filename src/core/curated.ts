// Collections whose look Karum sets itself, over what their contract says.
//
// Only for a collection whose on-chain art cannot be changed and is wrong.
// ZNS's registrar compiled its collection logo into contractURI() with no
// setter, and the logo it shipped was a rough stand-in; the registrar holds
// live names, so it will not be redeployed for a picture. The node indexes
// contractURI as the chain says it; this corrects it at the API edge, where
// every page reads collections, so no page needs to know.

import type {Collection, Meta} from './api'

/** ZNS's mark (zvm-zns/web/src/components/ZnsMark.vue: a chamfered name tag
 *  holding the explorer's Rune Z) on a dark card, lit by the three colours
 *  the ZNS page is lit by. */
const ZNS_LOGO =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
      `<defs>` +
      `<radialGradient id="a" cx=".22" cy=".2" r=".7"><stop offset="0" stop-color="#00d557" stop-opacity=".32"/><stop offset="1" stop-color="#00d557" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="b" cx=".85" cy=".8" r=".7"><stop offset="0" stop-color="#0061eb" stop-opacity=".38"/><stop offset="1" stop-color="#0061eb" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="c" cx=".88" cy=".12" r=".45"><stop offset="0" stop-color="#f91690" stop-opacity=".26"/><stop offset="1" stop-color="#f91690" stop-opacity="0"/></radialGradient>` +
      `<pattern id="d" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="1.1" fill="#fff" fill-opacity=".07"/></pattern>` +
      `<linearGradient id="p" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="22"><stop offset="0" stop-color="hsl(120 86% 63%)"/><stop offset="1" stop-color="hsl(145 100% 38%)"/></linearGradient>` +
      `</defs>` +
      `<rect width="512" height="512" fill="#06090a"/>` +
      `<rect width="512" height="512" fill="url(#d)"/>` +
      `<rect width="512" height="512" fill="url(#a)"/><rect width="512" height="512" fill="url(#b)"/><rect width="512" height="512" fill="url(#c)"/>` +
      `<g transform="translate(96 96) scale(13.333)">` +
      `<path d="M6,2.5H21.5V18L18,21.5H2.5V6Z" fill="none" stroke="url(#p)" stroke-width="1.6" stroke-linejoin="miter"/>` +
      `<g transform="translate(12 12) scale(0.72) translate(-12 -12)" fill="none" stroke="url(#p)" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter"><path d="M5.3,5.3H18.7L5.3,18.7H18.7"/><path d="M9.6,9.6L14.4,14.4"/></g>` +
      `</g></svg>`,
  )

/** By lower-case collection address: ZNS's registrars on the chain this build
 *  points at, VITE_ZNS_REGISTRARS, comma-separated (ZNSRegistrar in zvm-zns's
 *  deployment record, and any it replaced). Every devnet deploys its own ZNS,
 *  so none is written here. */
const CURATED: Record<string, Partial<Meta>> = Object.fromEntries(
  ((import.meta.env.VITE_ZNS_REGISTRARS as string | undefined) ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    .map((a) => [a, {image: ZNS_LOGO}]),
)

export function curate<T extends Collection | null | undefined>(c: T): T {
  const over = c ? CURATED[c.address.toLowerCase()] : undefined
  if (c && over) c.meta = {...(c.meta ?? {}), ...over}
  return c
}
