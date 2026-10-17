<script setup lang="ts">
import Tooltip from '../components/Tooltip.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { PortStatus } from '@spark/shared';
import { api } from '../api/client.js';
import { toast } from '../composables/toast.js';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import StatCard from '../components/StatCard.vue';

const statuses = ref<PortStatus[]>([]);
const loading = ref(false);
const detail = ref<PortStatus | null>(null);

async function scan(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    statuses.value = await api.scanPorts();
  } catch (err) {
    toast(`端口扫描失败:${(err as Error).message}`, 'error');
  } finally {
    loading.value = false;
  }
}

let timer: number | undefined;
onMounted(() => { void scan(); timer = window.setInterval(() => void scan(), 3000); });
onBeforeUnmount(() => window.clearInterval(timer));

const occupiedList = computed(() => statuses.value.filter((s) => s.occupied));
const freeList = computed(() => statuses.value.filter((s) => !s.occupied));
const conflictList = computed(() => statuses.value.filter((s) => s.occupied && s.source === 'external'));

function sourceLabel(s: PortStatus): string {
  if (!s.occupied) return '-';
  if (s.source === 'project') return '本管理工具';
  if (s.source === 'external') return '外部进程';
  return '未知';
}

function processInfo(s: PortStatus): string {
  if (!s.occupied || s.pid == null) return '-';
  return `PID ${s.pid}${s.processName ? ` (${s.processName})` : ''}`;
}
</script>

<template>
  <div class="data-page px-8 py-7">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="flex items-center gap-1.5 text-xl font-semibold text-slate-800">端口管理<Tooltip label="端口管理说明" content="查看本地端口占用情况,避免部署端口冲突" /></h1>
      </div>
      <button
        class="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60"
        :disabled="loading"
        @click="scan"
      >
        <Icon name="refresh" size="sm" :class="loading ? 'animate-spin' : ''" />
        {{ loading ? '扫描中…' : '刷新' }}
      </button>
    </div>

    <div class="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard label="总端口" :value="statuses.length" sub="配置及自动发现" icon="ports" tone="blue">
        <template #icon><Icon name="ports" /></template>
      </StatCard>
      <StatCard label="已占用" :value="occupiedList.length" icon="ports" tone="green">
        <template #icon><span class="text-emerald-500">▶</span></template>
      </StatCard>
      <StatCard label="空闲" :value="freeList.length" icon="ports" tone="gray">
        <template #icon><span class="text-slate-400">○</span></template>
      </StatCard>
      <StatCard label="冲突风险" :value="conflictList.length" sub="外部进程占用" icon="warning" tone="red">
        <template #icon><Icon name="warning" /></template>
      </StatCard>
    </div>

    <div class="data-scroll port-table-scroll mt-5 glass-card rounded-2xl bg-white shadow-sm">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-xs text-slate-400">
            <th class="px-5 py-3.5 font-medium">端口</th>
            <th class="px-3 py-3.5 font-medium">状态</th>
            <th class="px-3 py-3.5 font-medium">项目名称</th>
            <th class="px-3 py-3.5 font-medium">进程信息</th>
            <th class="px-3 py-3.5 font-medium">来源</th>
            <th class="px-5 py-3.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in statuses" :key="s.port" class="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
            <td class="px-5 py-3.5 font-semibold tabular-nums text-slate-700">{{ s.port }}</td>
            <td class="px-3 py-3.5">
              <span
                v-if="s.occupied"
                class="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>已占用
              </span>
              <span v-else class="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                <span class="h-1.5 w-1.5 rounded-full bg-slate-300"></span>空闲
              </span>
            </td>
            <td class="px-3 py-3.5 text-slate-600">{{ s.projectName ?? '-' }}<div v-if="s.terminalName" class="mt-0.5 text-xs text-slate-400">{{ s.terminalName }}</div></td>
            <td class="px-3 py-3.5 font-mono text-xs text-slate-500">{{ processInfo(s) }}</td>
            <td class="px-3 py-3.5">
              <span
                v-if="s.source === 'external'"
                class="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-500"
              >
                <Icon name="warning" size="sm" />外部进程
              </span>
              <span v-else class="text-slate-500">{{ sourceLabel(s) }}</span>
            </td>
            <td class="px-5 py-3.5 text-right">
              <button
                v-if="s.occupied"
                class="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                @click="detail = s"
              >
                查看
              </button>
              <span v-else class="text-xs text-slate-300">-</span>
            </td>
          </tr>
          <tr v-if="statuses.length === 0">
            <td colspan="6" class="px-5 py-12 text-center text-sm text-slate-400">
              {{ loading ? '正在扫描…' : '暂无配置或发现的端口，启动项目后会自动检测监听端口' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 端口详情 -->
    <Modal :open="detail != null" :title="`端口 ${detail?.port} 详情`" width="max-w-lg" @close="detail = null">
      <template v-if="detail">
        <div class="space-y-3 text-sm">
          <div class="flex justify-between rounded-lg bg-slate-50 px-3.5 py-2.5">
            <span class="text-slate-400">占用来源</span>
            <span class="font-medium text-slate-700">{{ sourceLabel(detail) }}</span>
          </div>
          <div v-if="detail.projectName" class="flex justify-between rounded-lg bg-slate-50 px-3.5 py-2.5">
            <span class="text-slate-400">关联项目</span>
            <span class="font-medium text-slate-700">{{ detail.projectName }}</span>
          </div>
          <div>
            <p class="mb-1.5 text-xs font-medium text-slate-400">监听进程(共 {{ detail.processes?.length ?? 0 }} 个)</p>
            <div class="overflow-hidden rounded-lg ring-1 ring-slate-100">
              <div
                v-for="proc in detail.processes ?? []"
                :key="proc.pid"
                class="flex justify-between border-b border-slate-50 px-3.5 py-2 font-mono text-xs last:border-0"
              >
                <span class="text-slate-600">{{ proc.command }}</span>
                <span class="tabular-nums text-slate-400">PID {{ proc.pid }}</span>
              </div>
              <div v-if="!detail.processes?.length" class="px-3.5 py-2 text-xs text-slate-400">未获取到进程信息</div>
            </div>
          </div>
          <p class="rounded-lg bg-blue-50 px-3.5 py-2.5 text-xs leading-5 text-blue-500">
            提示:外部进程占用的端口不会自动清理;如需释放,请手动处理对应进程,或在项目列表中删除/修改该端口配置。
          </p>
        </div>
      </template>
    </Modal>
  </div>
</template>
