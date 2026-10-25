<script setup lang="ts">
import ResourceLine from '../components/ResourceLine.vue';
import Select from '../components/Select.vue';
import { getResource } from '../stores/app.js';
import { freshness, memory, metric, sortProjects, sortOptions } from '../utils/resources.js';
import Tooltip from '../components/Tooltip.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { displayedPorts } from '@spark/shared';
import type { PortStatus } from '@spark/shared';
import { api } from '../api/client.js';
import { store } from '../stores/app.js';
import { formatDuration, typeMeta } from '../utils/format.js';
import { restartProjectAction, stopProjectAction } from '../composables/actions.js';
import Icon from '../components/Icon.vue';
import ProjectFormModal from '../components/ProjectFormModal.vue';
import StatCard from '../components/StatCard.vue';
import ResourceGauge from '../components/ResourceGauge.vue';
import StatusBadge from '../components/StatusBadge.vue';

const formOpen = ref(false);
const formRef = ref<InstanceType<typeof ProjectFormModal> | null>(null);

const now = ref(Date.now());
let ticker: number | undefined;
onMounted(() => {
  ticker = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(ticker));

const sort = ref('default');
const runningProjects = computed(() => sortProjects(store.projects.filter((p) => p.status === 'running' || p.status === 'starting' || p.status === 'partial'), sort.value));
const stoppedCount = computed(() => store.projects.filter((p) => p.status === 'stopped').length);
const failedCount = computed(() => store.projects.filter((p) => p.status === 'failed').length);

const portStats = ref<PortStatus[]>([]);
async function scanPorts(): Promise<void> {
  try {
    portStats.value = await api.scanPorts();
  } catch {
    /* 忽略扫描失败 */
  }
}
const occupiedPorts = computed(() => portStats.value.filter((s) => s.occupied).length);
onMounted(() => void scanPorts());
// 终端状态或发现端口变化时重新统计
watch(
  () => store.projects.map((p) => p.terminalStates.map((t) => `${t.status}:${t.listeningPorts.join(',')}`).join('|')).join(';'),
  () => void scanPorts(),
);

function openCreate(): void {
  formRef.value?.open(null);
  formOpen.value = true;
}

function uptime(startedAt: number | null): string {
  return startedAt ? formatDuration(now.value - startedAt) : '-';
}

/** 首页三块扇形仪表:内存/CPU 占整机比例,进程以 100 个为满刻度 */
const gaugeItems = computed(() => {
  const total = store.resources?.total;
  const sysMemory = store.resources?.systemMemoryBytes ?? null;
  const memBytes = total?.memoryBytes ?? null;
  const cpu = total?.cpuPercent ?? null;
  const processes = total?.processCount ?? null;
  const memPercent = memBytes != null && sysMemory ? (memBytes / sysMemory) * 100 : null;
  const memoryText = memBytes != null ? memory(memBytes) : metric(total, 'memoryBytes');
  return [
    {
      key: 'memory',
      label: '内存 RSS',
      title: '已管理项目进程树 RSS 合计；弧线为占系统物理内存的比例',
      percent: memPercent,
      center: memPercent == null ? '—' : `${Math.round(memPercent)}`,
      unit: memPercent == null ? '' : '%',
      detail: memPercent == null ? memoryText : `${memoryText} / ${memory(sysMemory!)}`,
    },
    {
      key: 'cpu',
      label: 'CPU · 整机容量',
      title: '已管理项目 CPU 合计，按整机全部逻辑核心容量计算',
      percent: cpu,
      center: cpu == null ? '—' : `${Math.round(cpu)}`,
      unit: cpu == null ? '' : '%',
      detail: metric(total, 'cpuPercent'),
    },
    {
      key: 'processes',
      label: '活跃进程',
      title: '已管理项目进程树中的进程数量；弧线满刻度为 100 个进程',
      percent: processes == null ? null : Math.min(100, processes),
      center: processes == null ? '—' : `${processes}`,
      unit: '',
      detail: metric(total, 'processCount'),
    },
  ];
});

</script>

<template>
  <div class="flex min-h-full flex-col px-8 py-7">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="flex items-center gap-1.5 text-xl font-semibold text-slate-800">首页<Tooltip label="首页说明" content="快速管理本地项目,查看运行状态与系统概况" /></h1>
      </div>
      <button
        class="flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-700"
        @click="openCreate"
      >
        <Icon name="plus" size="sm" />
        新建项目
      </button>
    </div>

    <!-- 统计卡片 -->
    <div class="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard label="运行中" :value="runningProjects.length" :sub="`/ ${store.projects.length} 个项目`" icon="play" tone="green">
        <template #icon><span class="text-emerald-500">▶</span></template>
      </StatCard>
      <StatCard label="已停止" :value="stoppedCount" :sub="`/ ${store.projects.length} 个项目`" icon="stop" tone="gray">
        <template #icon><span class="text-slate-400">■</span></template>
      </StatCard>
      <StatCard label="启动失败" :value="failedCount" :sub="`/ ${store.projects.length} 个项目`" icon="warning" tone="red">
        <template #icon><Icon name="warning" /></template>
      </StatCard>
      <StatCard label="已占用端口" :value="occupiedPorts" :sub="`/ ${portStats.length} 个端口`" icon="ports" tone="purple">
        <template #icon><Icon name="ports" /></template>
      </StatCard>
    </div>

    <section class="mt-5 rounded-2xl border border-white/70 bg-white/80 p-5 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-sm font-semibold text-slate-700">已管理项目资源</h2><span class="text-xs text-slate-400">{{ freshness(store.resources?.total, now) }}</span></div>
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="g in gaugeItems" :key="g.key" class="flex items-center gap-4" :title="g.title">
          <ResourceGauge :percent="g.percent" :value="g.center" :unit="g.unit" />
          <div class="min-w-0">
            <p class="text-xs text-slate-400">{{ g.label }}</p>
            <p class="mt-0.5 truncate text-lg font-semibold tabular-nums text-slate-700">{{ g.detail }}</p>
          </div>
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-400">仅统计已管理项目的进程树；RSS 合计可能包含重复的共享内存。</p>
    </section>
    <div class="mt-5">
      <!-- 运行中的项目 -->
      <div class="flex flex-col glass-card rounded-2xl bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-700">运行中的项目</h2>
          <Select v-model="sort" :options="sortOptions" rounded="xl" />
          <RouterLink to="/projects" class="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-500">
            查看全部 <span>→</span>
          </RouterLink>
        </div>
        <div v-if="runningProjects.length" class="mt-2 max-h-80 divide-y divide-slate-100 overflow-y-auto">
          <div v-for="p in runningProjects" :key="p.id" class="flex flex-wrap items-center gap-3 py-2">
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
              :class="typeMeta(p.type).badgeClass"
            >
              {{ typeMeta(p.type).letter }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <RouterLink :to="{ path: '/projects', query: { project: p.id } }" class="truncate text-sm font-medium text-slate-700 hover:text-blue-500">{{ p.name }}</RouterLink>
                <StatusBadge :status="p.status" />
                <span v-if="p.terminalStates.length > 1" class="text-xs text-slate-400">{{ p.terminalStates.filter(t => ['running', 'starting'].includes(t.status)).length }}/{{ p.terminalStates.length }} 终端</span>
              </div>
              <p class="mt-0.5 truncate font-mono text-xs text-slate-400">{{ p.cwd }}</p>
            </div>
            <ResourceLine class="order-last w-full pl-11 sm:order-none sm:w-auto sm:pl-0" :resource="getResource(p.id)" :now="now" />
            <div class="w-24 shrink-0 text-right">
              <div class="text-sm font-semibold tabular-nums text-slate-700">{{ displayedPorts(p.terminalStates).join(' / ') || '-' }}</div>
              <div class="text-xs text-slate-400">{{ uptime(p.startedAt) }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                class="rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                title="停止"
                @click="stopProjectAction(p.id, p.name)"
              >
                <Icon name="stop" size="sm" />
              </button>
              <button
                class="rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                title="重启"
                @click="restartProjectAction(p.id, p.name)"
              >
                <Icon name="refresh" size="sm" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col items-center justify-center gap-1 py-6 text-center">
          <p class="text-sm text-slate-400">暂无运行中的项目</p>
          <RouterLink to="/projects" class="text-xs text-blue-500 hover:text-blue-600">去项目列表启动 →</RouterLink>
        </div>
      </div>

    </div>

    <ProjectFormModal ref="formRef" :open="formOpen" :project="null" @close="formOpen = false" @saved="void scanPorts()" />
  </div>
</template>
