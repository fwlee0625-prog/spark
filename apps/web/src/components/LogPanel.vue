<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { AnsiUp } from 'ansi_up';
import { displayedPorts } from '@spark/shared';
import type { LogLine } from '@spark/shared';
import { getProject } from '../stores/app.js';
import { toast } from '../composables/toast.js';
import StatusBadge from './StatusBadge.vue';
import { api } from '../api/client.js';
import { formatTime } from '../utils/format.js';
import Icon from './Icon.vue';

const props = defineProps<{ projectId: string }>();

const selectedTerminal = ref('');
const project = computed(() => getProject(props.projectId));
const terminals = computed(() => project.value?.terminalStates ?? []);
const current = computed(() => terminals.value.find((t) => t.id === selectedTerminal.value));
const busy = ref(false);
async function act(action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (!selectedTerminal.value) return;
  busy.value = true;
  try { await api.terminalAction(props.projectId, selectedTerminal.value, action); }
  catch (err) { toast((err as Error).message, 'error'); }
  finally { busy.value = false; }
}

const ansi = new AnsiUp();
const lines = ref<LogLine[]>([]);
const autoscroll = ref(true);
const container = ref<HTMLElement | null>(null);
let es: EventSource | null = null;

function connect(): void {
  es?.close();
  lines.value = [];
  autoscroll.value = true;
  if (!props.projectId || !selectedTerminal.value) return;
  es = new EventSource(`/api/projects/${props.projectId}/logs?terminalId=${encodeURIComponent(selectedTerminal.value)}`);
  es.onmessage = (e) => {
    try {
      const line = JSON.parse(e.data) as LogLine;
      lines.value.push(line);
      if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000);
      if (autoscroll.value) void nextTick(scrollToBottom);
    } catch {
      /* 忽略无法解析的消息 */
    }
  };
}

function scrollToBottom(): void {
  const el = container.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/** 手动上滚时暂停自动滚动 */
function onScroll(): void {
  const el = container.value;
  if (!el) return;
  autoscroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}

async function clearLogs(): Promise<void> {
  lines.value = [];
  try {
    await api.clearLogs(props.projectId, selectedTerminal.value);
  } catch {
    /* 服务端清空失败不影响本地清空 */
  }
}

watch([() => props.projectId, () => terminals.value.map((t) => t.id).join(',')], () => {
  if (!terminals.value.some((t) => t.id === selectedTerminal.value)) selectedTerminal.value = terminals.value[0]?.id ?? '';
  connect();
}, { immediate: true });
watch(selectedTerminal, connect);
onBeforeUnmount(() => es?.close());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-700/60 bg-slate-900 px-3 pt-2">
      <button v-for="terminal in terminals" :key="terminal.id" class="flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs" :class="selectedTerminal === terminal.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'" @click="selectedTerminal = terminal.id">
        {{ terminal.name }} <StatusBadge :status="terminal.status" />
      </button>
    </div>
    <div v-if="current" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/60 bg-slate-900 px-4 py-2 text-xs text-slate-400">
      <span class="min-w-0 flex-1 truncate font-mono" :title="current.command">{{ current.command }}</span>
      <span v-if="displayedPorts([current]).length">端口 {{ displayedPorts([current]).join(' / ') }}</span>
      <span v-if="current.pid">PID {{ current.pid }}</span>
      <span v-if="current.status === 'failed'">退出码 {{ current.exitCode }}</span>
      <button v-if="!['running', 'starting'].includes(current.status)" :disabled="busy" class="rounded bg-emerald-900/50 px-2 py-1 text-emerald-300 disabled:opacity-50" @click="act('start')">启动终端</button>
      <button v-else :disabled="busy" class="rounded bg-slate-800 px-2 py-1 text-slate-200 disabled:opacity-50" @click="act('stop')">停止终端</button>
      <button :disabled="busy" class="rounded bg-slate-800 px-2 py-1 text-slate-200 disabled:opacity-50" @click="act('restart')">重启终端</button>
    </div>
    <div class="flex items-center justify-between border-b border-slate-700/60 bg-slate-900 px-4 py-2">
      <label class="flex cursor-pointer select-none items-center gap-2 text-xs text-slate-400">
        <input v-model="autoscroll" type="checkbox" class="h-3.5 w-3.5 accent-blue-500" />
        自动滚动
      </label>
      <button
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        @click="clearLogs"
      >
        <Icon name="trash" size="sm" />
        清空
      </button>
    </div>
    <div
      ref="container"
      class="terminal flex-1 overflow-auto bg-slate-900 px-4 py-3 font-mono text-xs leading-5 text-slate-200"
      @scroll="onScroll"
    >
      <div v-if="lines.length === 0" class="italic text-slate-600">暂无日志</div>
      <div v-for="(l, i) in lines" :key="i" class="whitespace-pre-wrap break-all">
        <span class="mr-1.5 select-none text-slate-500">{{ formatTime(l.ts) }}</span>
        <span :class="l.stream === 'stderr' ? 'text-red-300' : ''" v-html="ansi.ansi_to_html(l.line)"></span>
      </div>
    </div>
  </div>
</template>
