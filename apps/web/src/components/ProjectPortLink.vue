<script setup lang="ts">
import type { TerminalWithState } from '@spark/shared';
import { onClickOutside } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{ terminals: TerminalWithState[] }>();
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
// Only actual listeners from active terminals are navigation targets.
const ports = computed(() => [...new Set(props.terminals
  .filter((terminal) => ['running', 'starting'].includes(terminal.status))
  .flatMap((terminal) => terminal.listeningPorts))].sort((a, b) => a - b));
const title = computed(() => ports.value.length === 0
  ? '当前没有运行中的端口'
  : ports.value.length === 1 ? `打开 http://localhost:${ports.value[0]}` : '选择要打开的端口');

onClickOutside(root, () => { open.value = false; });
watch(ports, (value) => { if (value.length < 2) open.value = false; });

function toggle(): void {
  if (ports.value.length === 1) {
    window.open(`http://localhost:${ports.value[0]}`, '_blank', 'noopener,noreferrer');
  } else if (ports.value.length > 1) {
    open.value = !open.value;
  }
}

function close(): void {
  open.value = false;
  trigger.value?.focus();
}
</script>

<template>
  <div ref="root" class="relative" @click.stop @keydown.esc.stop.prevent="close">
    <button
      ref="trigger"
      type="button"
      :title="title"
      :aria-label="title"
      :aria-expanded="ports.length > 1 ? open : undefined"
      :disabled="!ports.length"
      class="rounded-lg bg-indigo-50 p-2 text-indigo-500 enabled:hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
      @click="toggle"
    >
      <Icon name="externalLink" size="sm" />
    </button>
    <div
      v-if="open"
      class="absolute bottom-full left-0 z-20 mb-2 w-52 overflow-hidden rounded-xl border border-slate-100 bg-white p-1 shadow-xl"
    >
      <div class="px-3 py-2 text-xs text-slate-400">选择要打开的端口</div>
      <div class="max-h-48 overflow-y-auto">
        <a
          v-for="port in ports"
          :key="port"
          :href="`http://localhost:${port}`"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 focus:bg-indigo-50"
          @click="close"
        >
          <span>localhost:{{ port }}</span>
          <Icon name="externalLink" size="sm" />
        </a>
      </div>
    </div>
  </div>
</template>
