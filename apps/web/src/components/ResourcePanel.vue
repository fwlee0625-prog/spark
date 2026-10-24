<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { getProject, getResource, store } from '../stores/app.js';
import { metric, freshness, memory } from '../utils/resources.js';
import { formatDuration } from '../utils/format.js';
import ResourceChart from './ResourceChart.vue';
import StatusBadge from './StatusBadge.vue';
const props = defineProps<{ projectId: string }>();
defineEmits<{ logs: [terminalId: string] }>();
const resource = computed(() => getResource(props.projectId));
const project = computed(() => getProject(props.projectId));
const now = ref(Date.now());
const expanded = ref<string[]>([]);
const historyError = ref(false);
const timer = window.setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => window.clearInterval(timer));
let requestId = 0;
watch(
  () => props.projectId,
  async (id) => {
    const version = ++requestId;
    expanded.value = [];
    historyError.value = false;
    try {
      const history = await api.resourceHistory(id);
      if (version !== requestId) return;
      const merged = new Map([...history.points, ...(store.resourceHistory[id] ?? [])].map((p) => [p.timestamp, p]));
      store.resourceHistory[id] = [...merged.values()]
        .filter((p) => p.timestamp >= Date.now() - 900000)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-1000);
    } catch {
      if (version === requestId) historyError.value = true;
    }
  },
  { immediate: true },
);
const points = computed(() => store.resourceHistory[props.projectId] ?? []);
function toggle(id: string) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((x) => x !== id) : [...expanded.value, id];
}
</script>
<template>
  <div class="h-full overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-slate-700">
        资源概况
      </h3>
      <span class="text-xs text-slate-400">
        {{ freshness(resource, now) }}
      </span>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <div
        v-for="item in ([['memoryBytes','内存 RSS'],['cpuPercent','CPU'],['processCount','活跃进程']] as const)"
        :key="item[0]"
        class="rounded-xl border border-slate-100 bg-white p-4"
      >
        <p class="text-xs text-slate-400">
          {{ item[1] }}
        </p>
        <p class="mt-2 truncate text-lg font-semibold tabular-nums text-slate-700">
          {{ metric(resource,item[0]) }}
        </p>
      </div>
    </div>
    <p class="my-3 text-xs leading-5 text-slate-400">
      仅统计 Spark 管理的进程树。CPU 为整机总容量百分比；内存为 RSS 合计，共享内存可能重复计算。停止、重启和采样缺口会断开曲线。
    </p>
    <div class="grid gap-3">
      <ResourceChart
        v-for="field in (['memoryBytes','cpuPercent'] as const)"
        :key="field"
        :field="field"
        :points="points"
        :now="now"
        :interval="store.resources?.intervalMs ?? 5000"
      />
    </div>
    <p v-if="historyError" class="mt-2 text-xs text-amber-600">
      历史数据暂不可用，正在显示本次连接的采样。
    </p>
    <h3 class="mb-3 mt-6 text-sm font-semibold text-slate-700">
      终端明细
    </h3>
    <div class="overflow-x-auto rounded-xl border border-slate-100 bg-white">
      <table class="w-full min-w-[640px] text-left text-xs">
        <thead class="bg-slate-50 text-slate-400">
          <tr>
            <th class="p-3">
              终端 / 状态
            </th>
            <th>
              CPU
            </th>
            <th>
              内存 RSS
            </th>
            <th>
              进程
            </th>
            <th>
              运行时长
            </th>
            <th class="p-3">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="t in project?.terminalStates ?? []" :key="t.id">
            <tr class="border-t border-slate-100">
              <td class="p-3">
                <p class="mb-1 font-medium text-slate-700">
                  {{ t.name }}
                </p>
                <StatusBadge :status="t.status" />
              </td>
              <td class="tabular-nums">
                {{ metric(resource?.terminals.find(r => r.terminalId === t.id),'cpuPercent') }}
              </td>
              <td class="tabular-nums">
                {{ metric(resource?.terminals.find(r => r.terminalId === t.id),'memoryBytes') }}
              </td>
              <td>
                {{ metric(resource?.terminals.find(r => r.terminalId === t.id),'processCount') }}
              </td>
              <td>
                {{ t.startedAt && ['running','starting'].includes(t.status) ? formatDuration(now-t.startedAt) : '—' }}
              </td>
              <td class="p-3">
                <button class="text-blue-500 hover:underline" @click="$emit('logs',t.id)">
                  查看日志
                </button>
                <button
                  class="ml-3 text-slate-500 hover:underline"
                  :aria-expanded="expanded.includes(t.id)"
                  @click="toggle(t.id)"
                >
                  {{ expanded.includes(t.id) ? '收起' : '进程明细' }}
                </button>
              </td>
            </tr>
            <tr v-if="expanded.includes(t.id)">
              <td colspan="6" class="bg-slate-50 px-4 py-3">
                <div
                  v-for="p in resource?.terminals.find(r => r.terminalId === t.id)?.processes ?? []"
                  :key="p.pid"
                  class="grid grid-cols-[70px_1fr_90px_90px] gap-3 py-1 tabular-nums"
                >
                  <span>
                    {{ p.pid }}
                  </span>
                  <span class="truncate" :title="p.name">
                    {{ p.name }}
                  </span>
                  <span>
                    {{ p.cpuPercent == null ? '采集中' : `${p.cpuPercent.toFixed(1)}%` }}
                  </span>
                  <span>
                    {{ memory(p.memoryBytes) }}
                  </span>
                </div>
                <p
                  v-if="!resource?.terminals.find(r => r.terminalId === t.id)?.processes.length"
                  class="text-slate-400"
                >
                  暂无可用进程数据
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
