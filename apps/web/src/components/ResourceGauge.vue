<script setup lang="ts">
import { computed } from 'vue';

/** 圆环占比 0-100;null 表示尚未采集,只显示轨道与占位符。 */
const props = defineProps<{
  percent: number | null;
  value: string;
  unit?: string;
}>();

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ratio = computed(() => (props.percent == null ? 0 : Math.min(100, Math.max(0, props.percent))));
const dasharray = computed(() => `${(ratio.value / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
const tone = computed(() => {
  if (props.percent == null) return 'text-slate-300';
  if (ratio.value >= 90) return 'text-red-500';
  if (ratio.value >= 70) return 'text-amber-500';
  return 'text-emerald-500';
});
</script>

<template>
  <div class="relative h-20 w-20 shrink-0" role="img" :aria-label="`当前 ${value}${unit ?? ''}`">
    <svg viewBox="0 0 64 64" class="h-full w-full -rotate-90">
      <circle cx="32" cy="32" :r="RADIUS" fill="none" stroke="currentColor" stroke-width="6" class="text-slate-100" />
      <circle
        v-if="ratio > 0"
        cx="32"
        cy="32"
        :r="RADIUS"
        fill="none"
        stroke="currentColor"
        stroke-width="6"
        stroke-linecap="round"
        :stroke-dasharray="dasharray"
        class="transition-all duration-700 ease-out"
        :class="tone"
      />
    </svg>
    <div class="absolute inset-0 flex items-center justify-center">
      <span class="text-lg font-bold leading-none tabular-nums" :class="tone">
        {{ value }}<span v-if="unit" class="ml-0.5 text-[10px] font-semibold">{{ unit }}</span>
      </span>
    </div>
  </div>
</template>
