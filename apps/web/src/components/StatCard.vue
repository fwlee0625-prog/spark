<script setup lang="ts">
import type { IconName } from './icons.js';

defineProps<{
  label: string;
  value: number | string;
  sub?: string;
  icon: IconName;
  tone: 'green' | 'gray' | 'red' | 'purple' | 'blue';
}>();

const tones = {
  green: 'bg-emerald-100 text-emerald-600',
  gray: 'bg-slate-200 text-slate-500',
  red: 'bg-red-100 text-red-500',
  purple: 'bg-purple-100 text-purple-500',
  blue: 'bg-blue-100 text-blue-500',
};
</script>

<template>
  <div class="flex items-center gap-4 glass-card rounded-2xl bg-white p-5 shadow-sm">
    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" :class="tones[tone]">
      <slot name="icon">
        <span class="text-lg">●</span>
      </slot>
    </div>
    <div class="min-w-0">
      <div class="text-xs text-slate-400">{{ label }}</div>
      <div class="mt-0.5 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tabular-nums text-slate-800">{{ value }}</span>
        <span v-if="sub" class="text-xs text-slate-400">{{ sub }}</span>
      </div>
    </div>
  </div>
</template>
