<script setup lang="ts">
import { useRoute } from 'vue-router';
import ResourceLine from '../components/ResourceLine.vue';
import ResourcePanel from '../components/ResourcePanel.vue';
import { getResource } from '../stores/app.js';
import { sortProjects, sortOptions } from '../utils/resources.js';
import Tooltip from '../components/Tooltip.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Project } from '@spark/shared';
import { PROJECT_TYPE_OPTIONS, displayedPorts } from '@spark/shared';
import { api } from '../api/client.js';
import { store } from '../stores/app.js';
import { formatDateTime, formatDuration, typeMeta } from '../utils/format.js';
import {
  deleteProjectAction,
  restartProjectAction,
  startProjectAction,
  stopProjectAction,
} from '../composables/actions.js';
import { confirmAction } from '../composables/confirm.js';
import { toast } from '../composables/toast.js';
import Icon from '../components/Icon.vue';
import LogPanel from '../components/LogPanel.vue';
import ProjectFormModal from '../components/ProjectFormModal.vue';
import GroupManagerModal from '../components/GroupManagerModal.vue';
import Select from '../components/Select.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TypeTag from '../components/TypeTag.vue';
import ProjectPortLink from '../components/ProjectPortLink.vue';

const sort = ref('default');
const route = useRoute();
const drawerTab = ref('logs');
const terminalId = ref('');
const search = ref('');
const typeFilter = ref('');
const statusFilter = ref('');
const groupFilter = ref('');

const typeOptions = [{ value: '', label: '全部类型' }, ...PROJECT_TYPE_OPTIONS];
const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'running', label: '运行中' },
  { value: 'starting', label: '启动中' },
  { value: 'partial', label: '部分运行' },
  { value: 'stopped', label: '已停止' },
  { value: 'failed', label: '启动失败' },
];
const groupOptions = computed(() => [
  { value: '', label: '全部分组' },
  ...store.groups.map((g) => ({ value: g.id, label: g.name })),
]);

const formOpen = ref(false);
const formRef = ref<InstanceType<typeof ProjectFormModal> | null>(null);
const groupOpen = ref(false);
const drawerId = ref(typeof route.query.project === 'string' ? route.query.project : '');

const filtered = computed(() =>
  sortProjects(store.projects.filter((p) => {
    const q = search.value.trim().toLowerCase();
    if (q && !`${p.name} ${p.cwd}`.toLowerCase().includes(q)) return false;
    if (typeFilter.value && p.type !== typeFilter.value) return false;
    if (statusFilter.value && p.status !== statusFilter.value) return false;
    if (groupFilter.value && !p.groupIds.includes(groupFilter.value)) return false;
    return true;
  }), sort.value),
);

const drawerProject = computed(() => store.projects.find((p) => p.id === drawerId.value) ?? null);

const now = ref(Date.now());
let ticker: number | undefined;
onMounted(() => {
  ticker = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(ticker));

function uptime(startedAt: number | null): string {
  return startedAt ? formatDuration(now.value - startedAt) : '-';
}

function openCreate(): void {
  formRef.value?.open(null);
  formOpen.value = true;
}

function openEdit(p: Project): void {
  formRef.value?.open(p);
  formOpen.value = true;
}

function openDrawer(id: string): void {
  drawerId.value = id;
  drawerTab.value = 'logs';
  terminalId.value = '';
}

async function startAll(): Promise<void> {
  const ok = await confirmAction({
    title: '全部启动',
    message: '将启动列表中所有未运行的项目(端口被占用的会跳过),继续吗?',
  });
  if (!ok) return;
  const targets = store.projects.filter((p) => p.status === 'stopped' || p.status === 'failed' || p.status === 'partial');
  let started = 0;
  let skipped = 0;
  await Promise.allSettled(
    targets.map(async (p) => {
      try {
        await api.startProject(p.id);
        started += 1;
      } catch {
        skipped += 1;
      }
    }),
  );
  toast(`已发出 ${started} 个启动指令${skipped ? `,${skipped} 个被跳过` : ''}`, 'success');
}

async function stopAll(): Promise<void> {
  const targets = store.projects.filter((p) => p.status === 'running' || p.status === 'starting' || p.status === 'partial');
  if (!targets.length) {
    toast('当前没有运行中的项目', 'info');
    return;
  }
  const ok = await confirmAction({
    title: '停止全部',
    message: `确定停止全部 ${targets.length} 个运行中的项目吗?`,
    confirmText: '全部停止',
    danger: true,
  });
  if (!ok) return;
  await Promise.allSettled(targets.map((p) => api.stopProject(p.id)));
  toast('已停止全部运行中的项目', 'success');
}
</script>

<template>
  <div class="projects-page data-page">
    <div class="page-header">
      <div>
        <h1 class="flex items-center gap-1.5 text-xl font-semibold text-slate-800">项目列表<Tooltip label="项目列表说明" content="管理所有本地项目,支持快速启动、停止和查看日志" /></h1>
      </div>
      <div class="page-actions">
        <button
          class="toolbar-button"
          @click="startAll"
        >
          <Icon name="play" size="sm" />全部启动
        </button>
        <button
          class="toolbar-button"
          @click="stopAll"
        >
          <Icon name="stop" size="sm" />停止全部
        </button>
        <button
          class="toolbar-button"
          @click="groupOpen = true"
        >
          <Icon name="users" size="sm" />分组管理
        </button>
        <button
          class="primary-button"
          @click="openCreate"
        >
          <Icon name="plus" size="sm" />新建项目
        </button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="project-filters">
      <div class="project-search relative">
        <Icon name="search" size="sm" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          v-model="search"
          type="search"
          aria-label="搜索项目名称或路径"
          placeholder="搜索项目名称或路径…"
          class="search-input"
        />
      </div>
      <Select v-model="typeFilter" :options="typeOptions" rounded="xl" />
      <Select v-model="statusFilter" :options="statusOptions" rounded="xl" />
      <Select v-model="groupFilter" :options="groupOptions" rounded="xl" />
      <Select v-model="sort" :options="sortOptions" rounded="xl" />
    </div>

    <!-- 项目卡片 -->
    <div class="project-grid">
      <div
        v-for="p in filtered"
        :key="p.id"
        class="project-card"
        @click="openDrawer(p.id)"
      >
        <div class="project-card-heading">
          <div class="project-avatar" :class="typeMeta(p.type).badgeClass">
            {{ typeMeta(p.type).letter }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="project-name">{{ p.name }}</span>
            </div>
            <div class="mt-0.5 flex items-center gap-2 whitespace-nowrap">
              <StatusBadge :status="p.status" />
                <span v-if="p.terminalStates.length > 1" class="text-xs text-slate-400">{{ p.terminalStates.filter(t => ['running', 'starting'].includes(t.status)).length }}/{{ p.terminalStates.length }} 终端</span>
              <span v-if="p.status === 'failed' && p.exitCode != null" class="text-xs text-red-400">退出码 {{ p.exitCode }}</span>
            </div>
          </div>
          <TypeTag class="project-type-tag" :type="p.type" />
        </div>

        <div class="project-terminal-states">
          <template v-if="p.terminalStates.length > 1">
          <span v-for="terminal in p.terminalStates" :key="terminal.id" class="flex max-w-full items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-500">
            <span class="truncate" :title="terminal.name">{{ terminal.name }}</span><StatusBadge class="shrink-0" :status="terminal.status" />
          </span>
          </template>
        </div>
        <div class="project-meta">
          <span class="flex min-w-0 items-center gap-1" :title="`端口 ${displayedPorts(p.terminalStates).join(' / ') || '-'}`"><Icon name="monitor" size="sm" class="shrink-0" /><span class="shrink-0">端口</span><span class="truncate font-medium tabular-nums text-slate-600">{{ displayedPorts(p.terminalStates).join(' / ') || '-' }}</span></span>
          <span>
            <template v-if="p.startedAt">启动于 {{ formatDateTime(p.startedAt) }}</template>
            <template v-else-if="p.status === 'running' || p.status === 'starting' || p.status === 'partial'">已运行 {{ uptime(p.startedAt) }}</template>
            <template v-else>未启动</template>
          </span>
        </div>

        <ResourceLine :resource="getResource(p.id)" :now="now" />
        <div class="project-card-actions" @click.stop>
          <ProjectPortLink :terminals="p.terminalStates" />
          <button
            v-if="p.status === 'stopped' || p.status === 'failed' || p.status === 'partial'"
            class="rounded-lg bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100"
            title="启动"
            @click="startProjectAction(p.id, p.name)"
          >
            <Icon name="play" size="sm" />
          </button>
          <button
            v-if="['running', 'starting', 'partial'].includes(p.status)"
            class="rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
            title="停止"
            @click="stopProjectAction(p.id, p.name)"
          >
            <Icon name="stop" size="sm" />
          </button>
          <button
            v-if="p.status === 'running' || p.status === 'starting' || p.status === 'partial'"
            class="rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
            title="重启"
            @click="restartProjectAction(p.id, p.name)"
          >
            <Icon name="refresh" size="sm" />
          </button>
          <button
            type="button"
            aria-label="编辑项目"
            :title="['running', 'starting', 'partial'].includes(p.status) ? '请先停止项目再编辑' : '编辑项目'"
            :disabled="['running', 'starting', 'partial'].includes(p.status)"
            class="rounded-lg bg-slate-100 p-2 text-slate-500 enabled:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            @click="openEdit(p)"
          >
            <Icon name="pencil" size="sm" />
          </button>
          <button
            type="button"
            aria-label="删除项目"
            :title="['running', 'starting', 'partial'].includes(p.status) ? '请先停止项目再删除' : '删除项目'"
            :disabled="['running', 'starting', 'partial'].includes(p.status)"
            class="rounded-lg bg-red-50 p-2 text-red-500 enabled:hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            @click="deleteProjectAction(p.id, p.name)"
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      </div>
      <div v-if="filtered.length === 0" class="col-span-full glass-card rounded-2xl bg-white py-12 text-center text-sm text-slate-400 shadow-sm">
        {{ store.projects.length ? '没有符合筛选条件的项目' : '还没有项目,点击右上角「新建项目」添加' }}
      </div>
    </div>

    <!-- 新建 / 编辑 -->
    <ProjectFormModal ref="formRef" :open="formOpen" @close="formOpen = false" />

    <!-- 分组管理 -->
    <GroupManagerModal :open="groupOpen" @close="groupOpen = false" />
    <!-- 日志抽屉 -->
    <Teleport to="body">
      <div v-if="drawerProject" class="fixed inset-0 z-30">
        <div class="dialog-backdrop absolute inset-0" @click="drawerId = ''"></div>
        <div role="dialog" aria-modal="true" aria-labelledby="project-drawer-title" class="glass-drawer absolute inset-y-0 right-0 flex w-[64rem] max-w-full flex-col sm:max-w-[96vw]">
          <div class="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
            <div class="min-w-0">
              <p class="mb-1 text-xs text-slate-400">项目详情</p>
              <div class="flex min-w-0 flex-wrap items-center gap-3">
                <h2 id="project-drawer-title" class="min-w-0 truncate text-lg font-semibold text-slate-800">{{ drawerProject.name }}</h2>
                <TypeTag :type="drawerProject.type" />
                <StatusBadge :status="drawerProject.status" />
              </div>
            </div>
            <button aria-label="关闭项目详情" class="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" @click="drawerId = ''">
              <Icon name="x" size="sm" />
            </button>
          </div>
          <section aria-label="项目信息" class="max-h-[35vh] shrink-0 overflow-y-auto border-b border-slate-100 px-6 py-4">
            <dl class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <div class="col-span-full">
                <dt class="mb-1 text-xs text-slate-400">项目目录</dt>
                <dd class="break-all font-mono text-sm text-slate-700">{{ drawerProject.cwd }}</dd>
              </div>
              <div>
                <dt class="mb-1 text-xs text-slate-400">端口</dt>
                <dd class="break-words text-sm tabular-nums text-slate-700">{{ displayedPorts(drawerProject.terminalStates).join(' / ') || '-' }}</dd>
              </div>
              <div>
                <dt class="mb-1 text-xs text-slate-400">启动时间</dt>
                <dd class="text-sm text-slate-700">{{ drawerProject.startedAt ? formatDateTime(drawerProject.startedAt) : '未启动' }}</dd>
              </div>
              <div>
                <dt class="mb-1 text-xs text-slate-400">终端</dt>
                <dd class="text-sm text-slate-700">{{ drawerProject.terminalStates.filter(t => ['running', 'starting'].includes(t.status)).length }} / {{ drawerProject.terminalStates.length }} 运行中</dd>
              </div>
              <div>
                <dt class="mb-1 text-xs text-slate-400">所属分组</dt>
                <dd class="break-words text-sm text-slate-700">{{ store.groups.filter(g => drawerProject?.groupIds.includes(g.id)).map(g => g.name).join('、') || '未分组' }}</dd>
              </div>
              <div>
                <dt class="mb-1 text-xs text-slate-400">崩溃自动重启</dt>
                <dd class="text-sm text-slate-700">{{ drawerProject.autoRestart ? '已开启' : '已关闭' }}</dd>
              </div>
            </dl>
          </section>
          <div class="flex shrink-0 items-center gap-5 border-b border-slate-100 px-6">
            <button v-for="tab in [{id:'logs',label:'终端日志'},{id:'resources',label:'资源监控'}]" :key="tab.id" class="border-b-2 py-3 text-sm" :class="drawerTab === tab.id ? 'border-blue-500 font-medium text-blue-600' : 'border-transparent text-slate-500'" @click="drawerTab=tab.id">{{ tab.label }}</button>
          </div>
          <div class="min-h-0 flex-1">
            <LogPanel v-if="drawerTab === 'logs'" :project-id="drawerProject.id" :terminal-id="terminalId" />
            <ResourcePanel v-else :project-id="drawerProject.id" @logs="id => { terminalId=id; drawerTab='logs'; }" />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
