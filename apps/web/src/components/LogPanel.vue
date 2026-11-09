<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useVirtualList } from '@vueuse/core';
import { LogViewBuffer, type RenderedLogLine } from '../utils/logViewBuffer.js';
import { displayedPorts } from '@spark/shared';
import type { LogLine } from '@spark/shared';
import { metric } from '../utils/resources.js';
import { getResource } from '../stores/app.js';
import { getProject } from '../stores/app.js';
import { toast } from '../composables/toast.js';
import StatusBadge from './StatusBadge.vue';
import { api } from '../api/client.js';
import { formatTime } from '../utils/format.js';
import Icon from './Icon.vue';

const props = defineProps<{ projectId: string; terminalId?: string }>();

const selectedTerminal = ref(props.terminalId ?? '');
watch(() => props.terminalId, id => { if(id) selectedTerminal.value=id; });
const resource = computed(() => getResource(props.projectId)?.terminals.find(t => t.terminalId === selectedTerminal.value));
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

const buffer = new LogViewBuffer();
const lines = shallowRef<RenderedLogLine[]>([]);
const autoscroll = ref(true);
// Fixed-height terminal rows keep the DOM bounded; long lines scroll horizontally.
const { list: visibleLines, containerProps, wrapperProps, scrollTo } = useVirtualList(lines, {
  itemHeight: 20,
  overscan: 8,
});
let es: EventSource | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function resetLogs(): void {
  generation++;
  clearTimeout(flushTimer);
  flushTimer = undefined;
  buffer.clear();
  lines.value = [];
}

function connect(): void {
  es?.close();
  es = null;
  resetLogs();
  autoscroll.value = true;
  if (!props.projectId || !selectedTerminal.value) return;
  const source = new EventSource(`/api/projects/${props.projectId}/logs?terminalId=${encodeURIComponent(selectedTerminal.value)}`);
  es = source;
  source.onmessage = (e) => {
    if (es !== source) return;
    try {
      const line = JSON.parse(e.data) as LogLine;
      buffer.append(line);
      if (flushTimer !== undefined) return;
      const activeGeneration = generation;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        lines.value = buffer.flush(lines.value);
        if (autoscroll.value) void nextTick(() => {
          if (generation === activeGeneration) scrollToBottom();
        });
      }, 50);
    } catch {
      /* 忽略无法解析的消息 */
    }
  };
}

function scrollToBottom(): void {
  scrollTo(Math.max(0, lines.value.length - 1));
}
watch(autoscroll, enabled => { if (enabled) void nextTick(scrollToBottom); });

/** 手动上滚时暂停自动滚动 */
function onScroll(): void {
  const el = containerProps.ref.value;
  if (!el) return;
  autoscroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}

async function clearLogs(): Promise<void> {
  resetLogs();
  try {
    await api.clearLogs(props.projectId, selectedTerminal.value);
  } catch {
    /* 服务端清空失败不影响本地清空 */
  }
}

watch([() => props.projectId, () => terminals.value.map((t) => t.id).join(',')], () => {
  if (!terminals.value.some((t) => t.id === selectedTerminal.value)) selectedTerminal.value = terminals.value[0]?.id ?? '';
}, { immediate: true });
watch([() => props.projectId, selectedTerminal], connect, { immediate: true });
onBeforeUnmount(() => {
  es?.close();
  es = null;
  resetLogs();
});
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
      <span title="占整机容量">CPU {{ metric(resource, 'cpuPercent') }}</span>
      <span title="进程树 RSS 合计">内存 {{ metric(resource, 'memoryBytes') }}</span>
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
      <span class="text-xs text-slate-500">{{ lines.length }} 行 · 长行可横向滚动</span>
      <button
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        @click="clearLogs"
      >
        <Icon name="trash" size="sm" />
        清空
      </button>
    </div>
    <div
      v-bind="containerProps"
      class="terminal min-h-0 flex-1 overflow-auto bg-slate-900 font-mono text-xs leading-5 text-slate-200"
      @scroll="onScroll"
      aria-label="终端日志，长行可横向滚动"
      tabindex="0"
    >
      <div v-if="lines.length === 0" class="px-4 italic text-slate-600">暂无日志</div>
      <div v-else v-bind="wrapperProps" class="min-w-full w-max">
        <div v-for="{ data: l } in visibleLines" :key="l.id" class="h-5 whitespace-pre px-4">
          <span class="mr-1.5 select-none text-slate-500">{{ formatTime(l.ts) }}</span>
          <span :class="l.stream === 'stderr' ? 'text-red-300' : ''" v-html="l.html"></span>
        </div>
      </div>
    </div>
  </div>
</template>
