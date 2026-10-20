// A small burst of plasma from a point on screen, for a purchase that executed
// or a drop minted. Fourteen dots, positioned once and left to a CSS animation,
// then removed.

const COLORS = ['#7bf06c', '#00d557', '#00b98a', '#5da4ff', '#ff5bad']

export function burst(from: {x: number; y: number} | Element | null | undefined) {
  if (typeof window === 'undefined') return
  let x = window.innerWidth / 2
  let y = window.innerHeight / 2
  if (from instanceof Element) {
    const r = from.getBoundingClientRect()
    x = r.left + r.width / 2
    y = r.top + r.height / 2
  } else if (from) {
    x = from.x
    y = from.y
  }
  for (let i = 0; i < 14; i++) {
    const dot = document.createElement('span')
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4
    const dist = 50 + Math.random() * 70
    dot.className = 'burst-dot'
    dot.style.left = `${x - 3}px`
    dot.style.top = `${y - 3}px`
    dot.style.background = COLORS[i % COLORS.length]
    dot.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    dot.style.setProperty('--dy', `${Math.sin(angle) * dist}px`)
    document.body.appendChild(dot)
    window.setTimeout(() => dot.remove(), 1000)
  }
}
