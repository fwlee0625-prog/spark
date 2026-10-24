<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { store, getResource } from '../stores/app.js';
import { freshness, metric, sortOptions, sortProjects } from '../utils/resources.js';
import Select from '../components/Select.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ResourcePanel from '../components/ResourcePanel.vue';
import LogPanel from '../components/LogPanel.vue';

const search = ref('');
const sort = ref('memoryBytes');
const activeOnly = ref(false);
const selectedId = ref('');
const tab = ref<'resources' | 'logs'>('resources');
const terminalId = ref('');
const now = ref(Date.now());
const timer = window.setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => window.clearInterval(timer));
const activeCount = computed(() => store.projects.filter(p => ['running', 'starting', 'partial'].includes(p.status)).length);
const projects = computed(() => sortProjects(store.projects.filter(p =>
  `${p.name} ${p.cwd}`.toLowerCase().includes(search.value.trim().toLowerCase()) &&
  (!activeOnly.value || ['running', 'starting', 'partial'].includes(p.status)),
), sort.value));
const selected = computed(() => store.projects.find(p => p.id === selectedId.value));
watch(() => projects.value.map(p => p.id), ids => {
  if (!ids.includes(selectedId.value)) selectedId.value = ids[0] ?? '';
}, { immediate: true });
watch(selectedId, () => { tab.value = 'resources'; terminalId.value = ''; });
function showLogs(id: string) { terminalId.value = id; tab.value = 'logs'; }
</script>

<template>
  <div class="min-h-full px-4 py-7 sm:px-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-800">资源监控</h1>
        <p class="mt-2 text-xs text-slate-500">查看已管理项目的资源占用，定位到终端与进程。</p>
      </div>
      <span class="text-xs text-slate-400" role="status">{{ store.connected ? freshness(store.resources?.total, now) : '连接中断，等待重新连接' }}</span>
    </div>
    <div class="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div v-for="item in ([['memoryBytes','项目内存 RSS'], ['cpuPercent','项目 CPU · 整机容量'], ['processCount','活跃进程']] as const)" :key="item[0]" class="glass-card rounded-2xl bg-white p-5 shadow-sm">
        <p class="text-xs text-slate-500">{{ item[1] }}</p>
        <p class="mt-3 text-2xl font-semibold tabular-nums text-slate-800">{{ metric(store.resources?.total, item[0]) }}</p>
      </div>
      <div class="glass-card rounded-2xl bg-white p-5 shadow-sm">
        <p class="text-xs text-slate-500">运行中项目</p>
        <p class="mt-3 text-2xl font-semibold tabular-nums text-slate-800">{{ activeCount }} <span class="text-sm font-normal text-slate-400">/ {{ store.projects.length }}</span></p>
      </div>
    </div>
    <p class="mt-3 text-xs leading-5 text-slate-400">每 {{ (store.resources?.intervalMs ?? 3000) / 1000 }} 秒更新。仅统计已管理的本机进程树；RSS 可能重复包含共享内存，历史保留最近 15 分钟。</p>
    <section class="mt-6 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm" aria-label="项目资源排行">
      <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <h2 class="mr-auto text-sm font-semibold text-slate-700">项目资源排行</h2>
        <input v-model="search" type="search" aria-label="搜索资源项目" placeholder="搜索项目名称或路径…" class="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
        <Select v-model="sort" :options="sortOptions" rounded="xl" />
        <label class="flex items-center gap-2 text-xs text-slate-500"><input v-model="activeOnly" type="checkbox" class="accent-blue-500" />仅看运行中</label>
      </div>
      <div class="max-h-80 overflow-auto">
        <table class="w-full min-w-[680px] text-left text-xs">
          <thead class="sticky top-0 bg-slate-50 text-slate-400"><tr><th class="p-4">项目</th><th class="p-4">状态</th><th class="p-4">内存 RSS</th><th class="p-4">CPU</th><th class="p-4">进程</th><th class="p-4">采样状态</th></tr></thead>
          <tbody>
            <tr v-for="p in projects" :key="p.id" class="border-t border-slate-100" :class="selectedId === p.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'">
              <td class="p-4"><button class="text-left font-medium text-blue-600 hover:underline" :aria-pressed="selectedId === p.id" @click="selectedId = p.id">{{ p.name }}</button><p class="mt-1 max-w-64 truncate text-slate-400" :title="p.cwd">{{ p.cwd }}</p></td>
              <td class="p-4"><StatusBadge :status="p.status" /></td>
              <td class="p-4 tabular-nums">{{ metric(getResource(p.id), 'memoryBytes') }}</td>
              <td class="p-4 tabular-nums">{{ metric(getResource(p.id), 'cpuPercent') }}</td>
              <td class="p-4 tabular-nums">{{ metric(getResource(p.id), 'processCount') }}</td>
              <td class="p-4 text-slate-400">{{ getResource(p.id)?.status === 'unavailable' ? '采集不可用' : freshness(getResource(p.id), now) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!projects.length" class="p-10 text-center text-sm text-slate-400">{{ store.projects.length ? '没有符合条件的项目' : '暂无项目，添加并启动项目后即可查看资源。' }} <RouterLink v-if="!store.projects.length" to="/projects" class="text-blue-500">前往项目列表 →</RouterLink></p>
      </div>
    </section>
    <section v-if="selected" class="mt-5 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm" aria-label="所选项目资源详情">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div class="flex items-center gap-3"><h2 class="text-sm font-semibold text-slate-700">{{ selected.name }}</h2><StatusBadge :status="selected.status" /></div>
        <RouterLink :to="{path:'/projects', query:{project:selected.id}}" class="text-xs text-blue-500">管理项目 →</RouterLink>
      </div>
      <div class="flex gap-5 border-b border-slate-100 px-5" role="tablist" aria-label="项目监控视图">
        <button v-for="item in ([['resources','资源趋势与明细'],['logs','终端日志']] as const)" :key="item[0]" role="tab" :aria-selected="tab === item[0]" class="border-b-2 py-3 text-xs" :class="tab === item[0] ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'" @click="tab = item[0]">{{ item[1] }}</button>
      </div>
      <ResourcePanel v-if="tab === 'resources'" :key="selected.id" :project-id="selected.id" @logs="showLogs" />
      <div v-else class="h-[32rem]"><LogPanel :key="selected.id" :project-id="selected.id" :terminal-id="terminalId" /></div>
    </section>
  </div>
</template>
