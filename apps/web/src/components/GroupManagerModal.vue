<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Group } from '@spark/shared';
import { api } from '../api/client.js';
import { getProject, refreshGroups, store } from '../stores/app.js';
import { confirmAction } from '../composables/confirm.js';
import { toast } from '../composables/toast.js';
import Icon from './Icon.vue';
import Modal from './Modal.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const editingId = ref<string | null>(null); // null = 列表态,'new' = 新建,其他 = 编辑对应分组
const draft = reactive({ name: '', projectIds: [] as string[] });
const busy = ref(false);

const editing = computed(() => editingId.value !== null);

function startCreate(): void {
  editingId.value = 'new';
  draft.name = '';
  draft.projectIds = [];
}

function startEdit(group: Group): void {
  editingId.value = group.id;
  draft.name = group.name;
  draft.projectIds = [...group.projectIds];
}

function toggleProject(id: string): void {
  const i = draft.projectIds.indexOf(id);
  if (i >= 0) draft.projectIds.splice(i, 1);
  else draft.projectIds.push(id);
}

async function saveDraft(): Promise<void> {
  if (!draft.name.trim()) {
    toast('请填写分组名称', 'error');
    return;
  }
  busy.value = true;
  try {
    if (editingId.value === 'new') {
      await api.createGroup(draft.name.trim(), [...draft.projectIds]);
      toast('分组已创建', 'success');
    } else if (editingId.value) {
      await api.updateGroup(editingId.value, { name: draft.name.trim(), projectIds: [...draft.projectIds] });
      toast('分组已更新', 'success');
    }
    editingId.value = null;
    await refreshGroups();
  } catch (err) {
    toast(`保存失败:${(err as Error).message}`, 'error');
  } finally {
    busy.value = false;
  }
}

async function removeGroup(group: Group): Promise<void> {
  const ok = await confirmAction({
    title: '删除分组',
    message: `确定删除分组「${group.name}」吗?\n分组内的项目不会被删除。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteGroup(group.id);
    toast('分组已删除', 'success');
    await refreshGroups();
  } catch (err) {
    toast(`删除失败:${(err as Error).message}`, 'error');
  }
}

async function startGroup(group: Group): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await api.startGroup(group.id);
    const lines: string[] = [];
    if (result.started.length) lines.push(`已启动 ${result.started.length} 个项目`);
    for (const b of result.blocked) lines.push(`${b.name}:${b.reason},已跳过`);
    for (const f of result.failed) lines.push(`${f.name} 启动失败:${f.reason}`);
    toast(lines.join('\n') || '分组内没有项目', result.blocked.length || result.failed.length ? 'info' : 'success');
  } catch (err) {
    toast(`整组启动失败:${(err as Error).message}`, 'error');
  } finally {
    busy.value = false;
  }
}

async function stopGroup(group: Group): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.stopGroup(group.id);
    toast(`分组「${group.name}」已全部停止`, 'success');
  } catch (err) {
    toast(`整组停止失败:${(err as Error).message}`, 'error');
  } finally {
    busy.value = false;
  }
}

function memberNames(group: Group): string {
  return group.projectIds.map((id) => getProject(id)?.name ?? '?').join('、') || '空分组';
}

defineExpose({ startCreate });
</script>

<template>
  <Modal :open="open" title="分组管理" width="max-w-2xl" @close="emit('close')">
    <!-- 编辑/新建态 -->
    <div v-if="editing" class="space-y-4">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-slate-500">分组名称</label>
        <input
          v-model="draft.name"
          type="text"
          placeholder="如:电商前后端"
          class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-slate-500">包含项目({{ draft.projectIds.length }})</label>
        <div v-if="store.projects.length" class="space-y-1.5">
          <label
            v-for="p in store.projects"
            :key="p.id"
            class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm"
            :class="draft.projectIds.includes(p.id) ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'"
          >
            <input
              type="checkbox"
              class="h-4 w-4 accent-blue-500"
              :checked="draft.projectIds.includes(p.id)"
              @change="toggleProject(p.id)"
            />
            <span class="font-medium text-slate-700">{{ p.name }}</span>
            <span class="truncate font-mono text-xs text-slate-400">{{ p.cwd }}</span>
          </label>
        </div>
        <p v-else class="text-sm text-slate-400">还没有项目,先去新建项目吧</p>
      </div>
      <div class="flex justify-end gap-3 pt-2">
        <button class="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="editingId = null">
          取消
        </button>
        <button
          class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          :disabled="busy"
          @click="saveDraft"
        >
          保存
        </button>
      </div>
    </div>

    <!-- 列表态 -->
    <div v-else>
      <div v-if="store.groups.length" class="space-y-3">
        <div v-for="g in store.groups" :key="g.id" class="rounded-xl border border-slate-200 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Icon name="users" size="sm" class="text-blue-500" />
              <span class="text-sm font-semibold text-slate-800">{{ g.name }}</span>
              <span class="text-xs text-slate-400">{{ g.projectIds.length }} 个项目</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                class="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                @click="startGroup(g)"
              >
                <Icon name="play" size="sm" />整组启动
              </button>
              <button
                class="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                @click="stopGroup(g)"
              >
                <Icon name="stop" size="sm" />整组停止
              </button>
              <button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-500" title="编辑" @click="startEdit(g)">
                <Icon name="pencil" size="sm" />
              </button>
              <button class="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" title="删除" @click="removeGroup(g)">
                <Icon name="trash" size="sm" />
              </button>
            </div>
          </div>
          <p class="mt-2 truncate text-xs text-slate-400">{{ memberNames(g) }}</p>
        </div>
      </div>
      <div v-else class="py-10 text-center">
        <p class="text-sm text-slate-400">还没有分组</p>
        <p class="mt-1 text-xs text-slate-400">把常用的几个项目(如前端 + 后端)归为一组,一键整组启动</p>
      </div>
      <div class="mt-4 flex justify-end">
        <button
          class="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          @click="startCreate"
        >
          <Icon name="plus" size="sm" />新建分组
        </button>
      </div>
    </div>
  </Modal>
</template>
