<script setup lang="ts">
// Karum's mark: a K drawn by the Rune Z's rules. It has the same 24-unit grid,
// the same 2.6 stem with square caps, and the same plasma gradient. The arm is
// one tapered blade whose point stops a hairline short of the stem and whose
// tips run past the grid, top and bottom (chosen as K34, 2026-09-21).
//
// The gradient is in user space, pinned to the grid, and not the default
// bounding box. A perfectly vertical stroke has a bounding box of zero width,
// and SVG paints nothing with a gradient sized to it: the stem vanished in
// every early draft. The Z never hit this because none of its strokes is
// vertical.
withDefaults(defineProps<{size?: number}>(), {size: 24})
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="shrink-0">
    <defs>
      <linearGradient id="karum-rune-plasma" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="20">
        <stop offset="0%" stop-color="hsl(120 86% 63%)" />
        <stop offset="100%" stop-color="hsl(145 100% 38%)" />
      </linearGradient>
    </defs>
    <path d="M5.3,5.3V18.7" stroke="url(#karum-rune-plasma)" stroke-width="2.6" stroke-linecap="square" />
    <path d="M7.2,12L19,2L11.4,12L19,22Z" fill="url(#karum-rune-plasma)" />
  </svg>
</template>
