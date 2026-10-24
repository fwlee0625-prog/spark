<script setup lang="ts">
import { computed } from 'vue';
import type { ResourceHistoryPoint } from '@spark/shared';
import { memory } from '../utils/resources.js';
const props = defineProps<{
  points: ResourceHistoryPoint[];
  field: 'memoryBytes' | 'cpuPercent';
  now: number;
  interval: number;
}>();
const max = computed(
  () => Math.max(props.field === 'cpuPercent' ? 1 : 1048576, ...props.points.map((p) => p[props.field] ?? 0)) * 1.15,
);
const paths = computed(() => {
  const result: string[] = [];
  let path = '';
  let previous: ResourceHistoryPoint | undefined;
  for (const p of props.points) {
    const value = p[props.field];
    if (p.timestamp < props.now - 900000 || p.status === 'stopped' || p.status === 'unavailable' || value == null) {
      if (path) result.push(path);
      path = '';
      previous = undefined;
      continue;
    }
    const x = Math.max(0, Math.min(600, ((p.timestamp - props.now + 900000) / 900000) * 600));
    const y = 110 - (value / max.value) * 100;
    if (previous && (previous.runId !== p.runId || p.timestamp - previous.timestamp > props.interval * 2.5)) {
      if (path) result.push(path);
      path = '';
    }
    path += `${path ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    previous = p;
  }
  if (path) result.push(path);
  return result.map((d) => (d.includes(' L') ? d : `${d} l 0.1 0`));
});
</script>
<template>
  <div class="rounded-xl border border-slate-100 bg-white p-4">
    <div class="flex justify-between text-xs text-slate-500">
      <strong class="text-slate-700">
        {{ field === 'memoryBytes' ? 'RSS 内存' : 'CPU · 整机容量' }}
      </strong>
      <span>
        {{ field === 'memoryBytes' ? memory(max) : `${max.toFixed(1)}%` }}
      </span>
    </div>
    <svg
      viewBox="0 0 600 120"
      class="mt-3 h-32 w-full"
      preserveAspectRatio="none"
      role="img"
      :aria-label="field === 'memoryBytes' ? '最近十五分钟内存曲线' : '最近十五分钟 CPU 曲线'"
    >
      <path v-for="y in [10,60,110]" :key="y" :d="`M 0 ${y} H 600`" stroke="#e2e8f0" stroke-dasharray="3 4"/>
      <path
        v-for="(d,i) in paths"
        :key="i"
        :d="d"
        fill="none"
        :stroke="field === 'memoryBytes' ? '#8b5cf6' : '#3b82f6'"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
      />
    </svg>
    <p v-if="!paths.length" class="text-center text-xs text-slate-400">
      等待有效采样
    </p>
    <div class="flex justify-between text-xs text-slate-400">
      <span>
        15 分钟前
      </span>
      <span>
        现在
      </span>
    </div>
  </div>
</template>
