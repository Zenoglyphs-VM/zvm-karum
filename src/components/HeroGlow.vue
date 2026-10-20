<script setup lang="ts">
// Soft light behind the hero, taken from the featured collection's own art, so
// the glow is always the colour of what is being shown.
//
// Four glows, each the art itself blurred to pure colour and faded out
// through a radial mask, so it has no edge. Each wanders a curved loop about a
// quarter of the hero wide, on its own cycle, and pulses: swells a little and
// brightens, then eases off. The drift is on `transform` and the pulse on the
// separate `scale` and `opacity` properties, so the two combine rather than
// overwrite each other, and all of it stays on the compositor.
import NftMedia from './NftMedia.vue'

defineProps<{src?: string | null; seed: string}>()
</script>

<template>
  <div class="glow" aria-hidden="true">
    <div class="glow__wash"><NftMedia :src="src" :seed="seed" eager /></div>
    <div v-for="n in 4" :key="n" class="glow__light" :class="`glow__light--${n}`">
      <NftMedia :src="src" :seed="seed" eager />
    </div>
  </div>
</template>

<style scoped>
.glow {
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
}

/* The ground light: the whole image, blurred and dim, so the room is never
   black between the glows. */
.glow__wash {
  position: absolute;
  inset: -12%;
  filter: blur(64px) saturate(1.4);
  opacity: 0.45;
}

.glow__light {
  position: absolute;
  aspect-ratio: 1;
  border-radius: 50%;
  overflow: hidden;
  filter: blur(46px) saturate(1.8);
  mix-blend-mode: screen;
  -webkit-mask-image: radial-gradient(closest-side, #000 35%, transparent);
  mask-image: radial-gradient(closest-side, #000 35%, transparent);
  will-change: transform, scale, opacity;
}

/* Placed across the width, biggest behind the art side; every cycle is a
   different length, so the four never pulse in step. */
.glow__light--1 {
  width: 46%;
  left: -8%;
  top: -40%;
  animation:
    drift-1 10s ease-in-out infinite alternate,
    pulse 5.2s ease-in-out infinite alternate;
}
.glow__light--2 {
  width: 52%;
  left: 38%;
  top: -30%;
  animation:
    drift-2 12s ease-in-out infinite alternate,
    pulse 6.4s ease-in-out -2s infinite alternate;
}
.glow__light--3 {
  width: 40%;
  left: 62%;
  top: 10%;
  animation:
    drift-3 13s ease-in-out infinite alternate,
    pulse 4.6s ease-in-out -1s infinite alternate;
}
.glow__light--4 {
  width: 34%;
  left: 18%;
  top: 30%;
  animation:
    drift-4 15s ease-in-out infinite alternate,
    pulse 7.1s ease-in-out -3s infinite alternate;
}

/* Each glow wanders a loop about a quarter of the hero wide, through two
   waypoints, so the path curves instead of sliding back and forth on a line. */
@keyframes drift-1 {
  0% {
    transform: translate3d(0, 0, 0);
  }
  33% {
    transform: translate3d(24%, 8%, 0);
  }
  66% {
    transform: translate3d(12%, 26%, 0);
  }
  100% {
    transform: translate3d(30%, 18%, 0);
  }
}
@keyframes drift-2 {
  0% {
    transform: translate3d(0, 0, 0);
  }
  33% {
    transform: translate3d(-22%, 14%, 0);
  }
  66% {
    transform: translate3d(-6%, 28%, 0);
  }
  100% {
    transform: translate3d(-26%, 20%, 0);
  }
}
@keyframes drift-3 {
  0% {
    transform: translate3d(0, 0, 0);
  }
  33% {
    transform: translate3d(-18%, -16%, 0);
  }
  66% {
    transform: translate3d(-28%, 6%, 0);
  }
  100% {
    transform: translate3d(-10%, -22%, 0);
  }
}
@keyframes drift-4 {
  0% {
    transform: translate3d(0, 0, 0);
  }
  33% {
    transform: translate3d(22%, -14%, 0);
  }
  66% {
    transform: translate3d(34%, 6%, 0);
  }
  100% {
    transform: translate3d(16%, -24%, 0);
  }
}

/* The breath: slightly larger and brighter, then back. */
@keyframes pulse {
  from {
    scale: 0.9;
    opacity: 0.45;
  }
  to {
    scale: 1.14;
    opacity: 0.95;
  }
}
</style>
