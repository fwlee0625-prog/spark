<script setup lang="ts">
import Tooltip from './Tooltip.vue';
import { computed, reactive, ref, watch } from 'vue';
import type { DetectResult, Project } from '@spark/shared';
import { PROJECT_TYPE_OPTIONS, projectTerminals } from '@spark/shared';
import { api } from '../api/client.js';
import { refreshGroups, refreshProjects, store } from '../stores/app.js';
import { normalizePortInput } from '../utils/projectForm.js';
import { basename } from '../utils/format.js';
import { toast } from '../composables/toast.js';
import FolderPickerModal from './FolderPickerModal.vue';
import Icon from './Icon.vue';
import Modal from './Modal.vue';
import Select from './Select.vue';
import TerminalEnvFields from './TerminalEnvFields.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

/** 当前编辑的项目,由 open(project) 传入;null 表示新建 */
const editing = ref<Project | null>(null);

interface EnvRow {
  key: string;
  value: string;
}

const form = reactive({
  name: '',
  cwd: '',
  command: '',
  port: '' as string | number,
  type: 'generic',
  autoRestart: false,
  groupIds: [] as string[],
});
interface TerminalRow { envRows: EnvRow[]; number: number; id: string; name: string; cwd: string; command: string; port: string | number }
const mainTerminal = reactive({ id: 'main', number: 1, name: '终端 1', cwd: '', envRows: [{ key: '', value: '' }] as EnvRow[] });
let nextTerminalNumber = 2;
const extraTerminals = ref<TerminalRow[]>([]);
function addTerminal(): void {
  const number = nextTerminalNumber++;
  extraTerminals.value.push({ id: `t_${crypto.randomUUID().slice(0, 8)}`, number, name: `终端 ${number}`, cwd: '', command: '', port: '', envRows: [{ key: '', value: '' }] });
}

function removeMainTerminal(): void {
  const next = extraTerminals.value.shift();
  if (!next) return;
  Object.assign(mainTerminal, { id: next.id, number: next.number, name: next.name, cwd: next.cwd, envRows: next.envRows });
  form.command = next.command;
  form.port = next.port;
}

const detectResult = ref<DetectResult | null>(null);
const detecting = ref(false);
const detectError = ref('');
const saving = ref(false);
const saveError = ref('');
const pickerOpen = ref(false);
let detectVersion = 0;

function cancelDetection(): void {
  detectVersion += 1;
  detecting.value = false;
  pickerOpen.value = false;
}

watch(() => props.open, (open) => {
  if (!open) cancelDetection();
});

/** 选择器选完目录后自动识别并预填 */
function onPickDir(dir: string): void {
  form.cwd = dir;
  void detectCwd();
}

const isEdit = computed(() => editing.value != null);
const scripts = computed(() => detectResult.value?.scripts ?? []);

/** 选目录后自动识别并预填 */
async function detectCwd(): Promise<void> {
  const dir = form.cwd.trim();
  const version = ++detectVersion;
  detecting.value = false;
  detectError.value = '';
  detectResult.value = null;
  if (!dir) return;
  detecting.value = true;
  try {
    const result = await api.detect(dir);
    if (version !== detectVersion || form.cwd.trim() !== dir || !props.open) return;
    detectResult.value = result;
    if (!form.name.trim()) form.name = basename(dir);
    if (detectResult.value.type) form.type = detectResult.value.type;
    if (detectResult.value.suggestedCommand && !form.command.trim()) {
      form.command = detectResult.value.suggestedCommand;
    }
  } catch (err) {
    if (version === detectVersion && form.cwd.trim() === dir && props.open) detectError.value = (err as Error).message;
  } finally {
    if (version === detectVersion) detecting.value = false;
  }
}

function useScript(script: string): void {
  const pm = detectResult.value?.packageManager ?? 'npm';
  form.command = pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`;
}

function envRowsFrom(env: Record<string, string>): EnvRow[] {
  const rows = Object.entries(env).map(([key, value]) => ({ key, value }));
  return rows.length ? rows : [{ key: '', value: '' }];
}

function toggleGroup(groupId: string): void {
  const i = form.groupIds.indexOf(groupId);
  if (i >= 0) form.groupIds.splice(i, 1);
  else form.groupIds.push(groupId);
}

function fillFromProject(p: Project): void {
  form.name = p.name;
  form.cwd = p.cwd;
  const [first, ...rest] = projectTerminals(p);
  Object.assign(mainTerminal, { id: first!.id, number: first!.number ?? 1, name: first!.name, cwd: first!.cwd, envRows: envRowsFrom(first!.env) });
  form.command = first!.command;
  form.port = first!.port != null ? String(first!.port) : '';
  extraTerminals.value = rest.map((t, i) => ({ ...t, number: t.number ?? i + 2, envRows: envRowsFrom(t.env), port: t.port != null ? String(t.port) : '' }));
  nextTerminalNumber = Math.max(mainTerminal.number, ...extraTerminals.value.map((t) => t.number)) + 1;
  form.type = p.type;
  form.autoRestart = p.autoRestart;
  form.groupIds = [...p.groupIds];
}

function envObject(rows: EnvRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) result[row.key.trim()] = row.value;
  }
  return result;
}

async function save(): Promise<void> {
  if (saving.value) return;
  saveError.value = '';
  try {
    if (!form.name.trim() || !form.cwd.trim() || !form.command.trim()) {
      throw new Error('名称、目录、启动命令均为必填');
    }
    if (!mainTerminal.name.trim() || extraTerminals.value.some((t) => !t.name.trim() || !t.command.trim())) {
      throw new Error('每个终端的名称和启动命令均为必填');
    }
    const { envRows: mainEnvRows, ...mainConfig } = mainTerminal;
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      cwd: form.cwd.trim(),
      terminals: [{ ...mainConfig, env: envObject(mainEnvRows), command: form.command.trim(), port: normalizePortInput(form.port) },
        ...extraTerminals.value.map(({ envRows, ...t }) => ({ ...t, env: envObject(envRows), name: t.name.trim(), command: t.command.trim(), port: normalizePortInput(t.port) }))],
      type: form.type,
      groupIds: [...form.groupIds],
      autoRestart: form.autoRestart,
    };
    saving.value = true;
    if (isEdit.value && editing.value) {
      await api.updateProject(editing.value.id, payload);
      toast('项目已更新', 'success');
    } else {
      await api.createProject(payload);
      toast('项目已创建', 'success');
    }
    await refreshProjects();
    await refreshGroups();
    emit('saved');
    emit('close');
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : '保存失败，请重试';
    toast(`保存失败:${saveError.value}`, 'error');
  } finally {
    saving.value = false;
  }
}

/** 每次打开都初始化表单；未传项目时默认新建。 */
function resetForm(project: Project | null = null): void {
  cancelDetection();
  saveError.value = '';
  const p = project;
  editing.value = p ?? null;
  if (p) {
    fillFromProject(p);
    detectResult.value = null;
    detectError.value = '';
  } else {
    Object.assign(mainTerminal, { id: 'main', number: 1, name: '终端 1', cwd: '', envRows: [{ key: '', value: '' }] });
    nextTerminalNumber = 2;
    extraTerminals.value = [];
    form.name = '';
    form.cwd = '';
    form.command = '';
    form.port = '';
    form.type = 'generic';
    form.autoRestart = false;
    form.groupIds = [];
    detectResult.value = null;
    detectError.value = '';
  }
}

defineExpose({ open: resetForm });
</script>

<template>
  <Modal :open="open" :title="isEdit ? '编辑项目' : '新建项目'" width="max-w-2xl" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="save">
      <!-- 目录 + 识别 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-slate-500">项目目录(绝对路径)</label>
        <div class="flex gap-2">
          <input
            v-model="form.cwd"
            type="text"
            placeholder="/Users/me/code/my-project"
            class="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            @change="detectCwd"
          />
          <button
            type="button"
            class="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-500"
            @click="pickerOpen = true"
          >
            <Icon name="folder" size="sm" /> 浏览
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            :disabled="detecting || !form.cwd.trim()"
            @click="detectCwd"
          >
            {{ detecting ? '识别中…' : '自动识别' }}
          </button>
        </div>
        <p v-if="detectError" class="mt-2 text-xs text-red-500">{{ detectError }}</p>
        <div v-if="detectResult" class="mt-2 max-h-48 overflow-y-auto overscroll-contain rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-medium text-slate-600">识别结果:</span>
            <span class="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{{ detectResult.type }}</span>
            <span v-if="detectResult.packageManager" class="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
              {{ detectResult.packageManager }}
            </span>
            <span v-if="detectResult.venv" class="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
              {{ detectResult.venv }}
            </span>
            <span v-for="tag in detectResult.tags ?? []" :key="tag" class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-500">
              {{ tag }}
            </span>
          </div>
          <div v-if="scripts.length" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="font-medium text-slate-600">可选脚本:</span>
            <button
              v-for="s in scripts"
              :key="s"
              type="button"
              class="rounded-md px-2 py-0.5 font-mono ring-1 transition-colors"
              :class="form.command === (detectResult?.packageManager === 'npm' ? `npm run ${s}` : `${detectResult?.packageManager} ${s}`)
                ? 'bg-blue-500 text-white ring-blue-500'
                : 'bg-white text-slate-600 ring-slate-200 hover:ring-blue-300'"
              @click="useScript(s)"
            >
              {{ s }}
            </button>
          </div>
          <p v-for="note in detectResult.notes ?? []" :key="note" class="mt-1.5 text-slate-400">{{ note }}</p>
        </div>
      </div>

      <!-- 名称 / 类型 -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="mb-1.5 block text-xs font-medium text-slate-500">项目名称</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="my-project"
            class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-slate-500">类型标签</label>
          <Select v-model="form.type" :options="[...PROJECT_TYPE_OPTIONS]" />
        </div>
      </div>

      <div class="flex items-center justify-between border-t border-slate-100 pt-3">
        <div>
          <label class="flex items-center gap-1.5 text-sm font-semibold text-slate-700">启动终端 · {{ extraTerminals.length + 1 }} 个<Tooltip label="启动终端说明" content="前后端可分别配置；项目启动时同时启动所有终端。环境变量分别配置，自动重启设置应用于所有终端。" /></label>
        </div>
        <button type="button" class="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50" :disabled="extraTerminals.length >= 19" @click="addTerminal">+ 添加终端</button>
      </div>
      <div class="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500">终端 {{ mainTerminal.number }}</span>
          <button v-if="extraTerminals.length" type="button" class="text-xs text-red-500 hover:text-red-600" @click="removeMainTerminal">移除</button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="mb-1.5 block text-xs text-slate-500">终端名称</label><input v-model="mainTerminal.name" :aria-label="`终端 ${mainTerminal.number} 名称`" placeholder="前端" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" /></div>
          <div><label class="mb-1.5 block text-xs text-slate-500">工作目录（可选）<Tooltip label="工作目录说明" content="留空使用项目目录，支持相对于项目目录的路径，也支持绝对路径。" /></label><input v-model="mainTerminal.cwd" :aria-label="`终端 ${mainTerminal.number} 工作目录`" placeholder="留空使用项目目录，如 frontend" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-400" /></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2"><label class="mb-1.5 block text-xs text-slate-500">启动命令</label><input v-model="form.command" :aria-label="`终端 ${mainTerminal.number} 启动命令`" placeholder="pnpm dev" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-400" /></div>
          <div><label class="mb-1.5 block text-xs text-slate-500">端口（可选）</label><input v-model="form.port" :aria-label="`终端 ${mainTerminal.number} 端口`" type="number" min="1" max="65535" placeholder="5173" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" /></div>
        </div>
        <TerminalEnvFields v-model="mainTerminal.envRows" :terminal-number="mainTerminal.number" />
      </div>

      <div v-for="(terminal, i) in extraTerminals" :key="terminal.id" class="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div class="flex items-center justify-between"><span class="text-xs font-semibold text-slate-500">终端 {{ terminal.number }}</span><button type="button" class="text-xs text-red-500 hover:text-red-600" @click="extraTerminals.splice(i, 1)">移除</button></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="mb-1.5 block text-xs text-slate-500">终端名称</label><input v-model="terminal.name" :aria-label="`终端 ${terminal.number} 名称`" placeholder="后端" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" /></div>
          <div><label class="mb-1.5 block text-xs text-slate-500">工作目录（可选）<Tooltip label="工作目录说明" content="留空使用项目目录，支持相对于项目目录的路径，也支持绝对路径。" /></label><input v-model="terminal.cwd" :aria-label="`终端 ${terminal.number} 工作目录`" placeholder="如 backend，也支持绝对路径" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-400" /></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2"><label class="mb-1.5 block text-xs text-slate-500">启动命令</label><input v-model="terminal.command" :aria-label="`终端 ${terminal.number} 启动命令`" placeholder="pnpm dev" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-400" /></div>
          <div><label class="mb-1.5 block text-xs text-slate-500">端口（可选）</label><input v-model="terminal.port" :aria-label="`终端 ${terminal.number} 端口`" type="number" min="1" max="65535" placeholder="3000" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" /></div>
        </div>
        <TerminalEnvFields v-model="terminal.envRows" :terminal-number="terminal.number" />
      </div>

      <!-- 分组 / 崩溃重启 -->
      <div v-if="store.groups.length" class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-slate-500">所属分组:</span>
        <button
          v-for="g in store.groups"
          :key="g.id"
          type="button"
          class="rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors"
          :class="form.groupIds.includes(g.id) ? 'bg-blue-500 text-white ring-blue-500' : 'bg-white text-slate-500 ring-slate-200 hover:ring-blue-300'"
          @click="toggleGroup(g.id)"
        >
          {{ g.name }}
        </button>
      </div>
      <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input v-model="form.autoRestart" type="checkbox" class="h-4 w-4 accent-blue-500" />
        进程崩溃后自动重启<Tooltip label="项目自动重启说明" content="应用于所有终端，次数上限见设置。" />
      </label>
    </form>

    <template #footer>
      <p v-if="saveError" role="alert" class="mr-auto self-center text-xs text-red-500">{{ saveError }}</p>
      <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="emit('close')">
        取消
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>

  <FolderPickerModal :open="pickerOpen" :initial-dir="form.cwd" @close="pickerOpen = false" @select="onPickDir" />
</template>
