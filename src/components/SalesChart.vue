<script setup lang="ts">
// Sales against time: one dot per sale, and a line through the rolling median
// of the last few, which is the price a collection is actually clearing at.
// A mean would let one fat-finger sale drag the line for a week.
//
// Hand-drawn SVG rather than a chart library: it is one scatter and one line,
// and the bundle stays small enough to open quickly on a phone.
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {ago, whole} from '../core/format'

interface SalePoint {
  t: number
  price: number
  label?: string
}

const props = withDefaults(defineProps<{points: SalePoint[]; height?: number; window?: number}>(), {height: 220, window: 5})

const box = ref<HTMLElement | null>(null)
const width = ref(640)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(240, e.contentRect.width)))
  if (box.value) ro.observe(box.value)
})
onUnmounted(() => ro?.disconnect())

const PAD = {l: 44, r: 12, t: 14, b: 24}

const sorted = computed(() => [...props.points].filter((p) => isFinite(p.price) && p.price > 0).sort((a, b) => a.t - b.t))

const scale = computed(() => {
  const pts = sorted.value
  const t0 = pts[0]?.t ?? 0
  const t1 = pts[pts.length - 1]?.t ?? 1
  const hi = Math.max(...pts.map((p) => p.price), 0) * 1.15 || 1
  const w = width.value - PAD.l - PAD.r
  const h = props.height - PAD.t - PAD.b
  const span = Math.max(1, t1 - t0)
  return {
    x: (t: number) => PAD.l + (pts.length === 1 ? w / 2 : ((t - t0) / span) * w),
    y: (v: number) => PAD.t + h - (v / hi) * h,
    hi,
  }
})

const median = computed(() => {
  const pts = sorted.value
  return pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - props.window + 1), i + 1).map((x) => x.price).sort((a, b) => a - b)
    const m = win.length % 2 ? win[(win.length - 1) / 2] : (win[win.length / 2 - 1] + win[win.length / 2]) / 2
    return {t: p.t, price: m}
  })
})

const path = computed(() => median.value.map((p, i) => `${i ? 'L' : 'M'}${scale.value.x(p.t).toFixed(1)},${scale.value.y(p.price).toFixed(1)}`).join(''))
const area = computed(() => {
  const m = median.value
  if (m.length < 2) return ''
  const base = props.height - PAD.b
  return `${path.value}L${scale.value.x(m[m.length - 1].t).toFixed(1)},${base}L${scale.value.x(m[0].t).toFixed(1)},${base}Z`
})

const ticks = computed(() => [0, 0.5, 1].map((f) => ({v: scale.value.hi * f, y: scale.value.y(scale.value.hi * f)})))

const hover = ref<number | null>(null)
const tip = computed(() => (hover.value === null ? null : sorted.value[hover.value]))
</script>

<template>
  <div ref="box" class="relative w-full select-none">
    <svg v-if="sorted.length" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="block">
      <defs>
        <linearGradient id="karum-sales-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00d557" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#00d557" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g>
        <line v-for="tk in ticks" :key="tk.v" :x1="PAD.l" :x2="width - PAD.r" :y1="tk.y" :y2="tk.y" stroke="var(--line)" stroke-dasharray="2 4" />
        <text v-for="tk in ticks" :key="`l${tk.v}`" :x="PAD.l - 8" :y="tk.y + 3.5" text-anchor="end" class="mono" font-size="10.5" fill="var(--dim)">
          {{ whole(tk.v) }}
        </text>
      </g>
      <path v-if="area" :d="area" fill="url(#karum-sales-fill)" class="fade-in" />
      <path v-if="median.length > 1" :d="path" fill="none" stroke="var(--znn-ink)" stroke-width="2" class="draw-in" style="--len: 3000" />
      <circle
        v-for="(p, i) in sorted"
        :key="i"
        :cx="scale.x(p.t)"
        :cy="scale.y(p.price)"
        :r="hover === i ? 6 : 4"
        :fill="hover === i ? 'var(--new-ink)' : 'var(--nom-ink)'"
        fill-opacity="0.85"
        stroke="var(--bg)"
        stroke-width="1.5"
        class="transition-all duration-150 cursor-pointer rise-in"
        :style="{'--i': i, transformOrigin: `${scale.x(p.t)}px ${scale.y(p.price)}px`}"
        @mouseenter="hover = i"
        @mouseleave="hover = null"
      />
      <text :x="PAD.l" :y="height - 6" class="mono" font-size="10.5" fill="var(--dim)">{{ ago(sorted[0].t) }}</text>
      <text :x="width - PAD.r" :y="height - 6" text-anchor="end" class="mono" font-size="10.5" fill="var(--dim)">{{ ago(sorted[sorted.length - 1].t) }}</text>
    </svg>
    <div v-else class="grid place-items-center text-[13px] text-dim" :style="{height: `${height}px`}">No sales yet.</div>

    <div
      v-if="tip"
      class="pop absolute pointer-events-none px-2.5 py-1.5 text-[12px] -translate-x-1/2 -translate-y-full"
      :style="{left: `${scale.x(tip.t)}px`, top: `${scale.y(tip.price) - 10}px`}"
    >
      <div class="num font-semibold">{{ whole(tip.price) }} ZNN</div>
      <div class="text-dim">{{ tip.label ? `${tip.label}, ` : '' }}{{ ago(tip.t) }}</div>
    </div>
  </div>
</template>
