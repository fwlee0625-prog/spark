<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, type AppLogEntry } from '../api/client.js';
import { toast } from '../composables/toast.js';
import Icon from '../components/Icon.vue';

const entries = ref<AppLogEntry[]>([]);
const loading = ref(false);
const filter = ref('all');
const filtered = computed(() => filter.value === 'all' ? entries.value : entries.value.filter((entry) => entry.level === filter.value));

async function refresh(): Promise<void> {
  loading.value = true;
  try { entries.value = await api.getAppLogs(); }
  catch (err) { toast(`读取软件日志失败：${(err as Error).message}`, 'error'); }
  finally { loading.value = false; }
}

async function clearLogs(): Promise<void> {
  try { await api.clearAppLogs(); entries.value = []; toast('软件日志已清空', 'success'); }
  catch (err) { toast(`清空日志失败：${(err as Error).message}`, 'error'); }
}

function formatTime(value: string): string { return new Date(value).toLocaleString(); }
let timer: number | undefined;
onMounted(() => { void refresh(); timer = window.setInterval(() => void refresh(), 5000); });
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <section class="px-8 py-7">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-slate-800">软件日志</h1>
        <p class="mt-1 text-sm text-slate-500">查看 Spark 服务运行记录与错误信息</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60" :disabled="loading" @click="refresh">
          <Icon name="refresh" size="sm" :class="loading ? 'animate-spin' : ''" />刷新
        </button>
        <button class="flex items-center gap-1.5 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100" @click="clearLogs">
          <Icon name="trash" size="sm" />清空
        </button>
      </div>
    </div>

    <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-2">
        <button v-for="option in [{ id: 'all', label: '全部' }, { id: 'error', label: '错误' }, { id: 'warn', label: '警告' }, { id: 'info', label: '信息' }]" :key="option.id" class="rounded-lg px-3 py-1.5 text-xs font-medium" :class="filter === option.id ? 'bg-indigo-100 text-indigo-700' : 'bg-white/70 text-slate-500 hover:bg-white'" @click="filter = option.id">{{ option.label }}</button>
      </div>
      <span class="text-xs text-slate-400">最近 {{ entries.length }} 条 · 每 5 秒自动刷新</span>
    </div>

    <div class="glass-card mt-3 overflow-hidden rounded-2xl">
      <div v-for="entry in filtered" :key="entry.id" class="grid grid-cols-[150px_58px_minmax(0,1fr)] gap-3 border-b border-slate-100/80 px-4 py-3 last:border-0 max-sm:grid-cols-[1fr_auto]">
        <time class="pt-0.5 font-mono text-xs text-slate-400">{{ formatTime(entry.timestamp) }}</time>
        <span class="w-fit rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase" :class="entry.level === 'error' ? 'bg-red-50 text-red-600' : entry.level === 'warn' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'">{{ entry.level }}</span>
        <pre class="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-700 max-sm:col-span-2">{{ entry.message }}</pre>
      </div>
      <div v-if="filtered.length === 0" class="px-5 py-16 text-center text-sm text-slate-400">{{ loading ? '正在读取日志…' : '暂无软件日志' }}</div>
    </div>
  </section>
</template>
