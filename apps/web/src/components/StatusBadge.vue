<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectStatus } from '@spark/shared';

const props = defineProps<{ status: ProjectStatus }>();

const meta = computed(() => {
  switch (props.status) {
    case 'running':
      return { label: '运行中', dot: 'bg-emerald-500', text: 'text-emerald-600', pulse: false };
    case 'partial':
      return { label: '部分运行', dot: 'bg-amber-500', text: 'text-amber-600', pulse: false };
    case 'starting':
      return { label: '启动中', dot: 'bg-blue-500', text: 'text-blue-600', pulse: true };
    case 'failed':
      return { label: '启动失败', dot: 'bg-red-500', text: 'text-red-600', pulse: false };
    default:
      return { label: '已停止', dot: 'bg-slate-300', text: 'text-slate-500', pulse: false };
  }
});
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium" :class="meta.text">
    <span class="relative flex h-2 w-2">
      <span v-if="meta.pulse" class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" :class="meta.dot"></span>
      <span class="relative inline-flex h-2 w-2 rounded-full" :class="meta.dot"></span>
    </span>
    {{ meta.label }}
  </span>
</template>
