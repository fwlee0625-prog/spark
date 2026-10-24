<script setup lang="ts">
import type { ResourceUsage } from '@spark/shared';
import { freshness, metric } from '../utils/resources.js';
defineProps<{ resource?: ResourceUsage | null; now?: number }>();
</script>
<template>
  <div
    :title="freshness(resource, now ?? Date.now())"
    class="resource-line flex h-9 shrink-0 items-center gap-4 text-xs tabular-nums text-slate-500"
  >
    <span title="进程树 RSS 内存合计；共享内存可能重复计算">
      内存
      <strong class="font-medium text-slate-700">
        {{ metric(resource, 'memoryBytes') }}
      </strong>
    </span>
    <span title="CPU 占整机总容量的百分比">
      CPU
      <strong class="font-medium text-slate-700">
        {{ metric(resource, 'cpuPercent') }}
      </strong>
    </span>
    <span title="当前项目进程树中的进程数量">
      进程
      <strong class="font-medium text-slate-700">
        {{ metric(resource, 'processCount') }}
      </strong>
    </span>
    <span v-if="resource?.sampledAt && (now ?? Date.now()) - resource.sampledAt > 15000" class="text-amber-600">
      数据已过期
    </span>
  </div>
</template>
