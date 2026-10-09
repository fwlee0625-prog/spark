<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from 'vue';
import Icon from './Icon.vue';

withDefaults(defineProps<{ content?: string; label?: string }>(), { label: '查看说明' });
const id = useId();
const trigger = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const open = ref(false);
const position = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' });
let timer: ReturnType<typeof setTimeout> | undefined;
let hovered = false;
let focused = false;

function clearTimer(): void { clearTimeout(timer); }
function place(): void {
  if (!trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const box = panel.value.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 8));
  const below = anchor.bottom + 8;
  const top = below + box.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - box.height - 8);
  position.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' };
}
async function show(): Promise<void> {
  clearTimer();
  if (open.value) return;
  open.value = true;
  position.value.visibility = 'hidden';
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  await nextTick();
  if (open.value) place();
}
function hide(): void {
  clearTimer();
  open.value = false;
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
}
function leave(): void {
  hovered = false;
  clearTimer();
  timer = setTimeout(() => { if (!hovered && !focused) hide(); }, 120);
}
function enter(): void { hovered = true; void show(); }
function focus(): void { focused = true; void show(); }
function blur(): void { focused = false; if (!hovered) hide(); }
onBeforeUnmount(hide);
</script>

<template>
  <span ref="trigger" class="inline-flex shrink-0 align-middle" @mouseenter="enter" @mouseleave="leave" @focusin="focus" @focusout="blur" @keydown.esc.stop="hide">
    <slot name="trigger" :open="open" :describedby="open ? id : undefined">
      <button type="button" :aria-label="label" :aria-describedby="open ? id : undefined" class="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" @click.stop.prevent="show">
        <Icon name="help" size="sm" />
      </button>
    </slot>
  </span>
  <Teleport to="body">
    <div v-if="open" :id="id" ref="panel" role="tooltip" :style="position" class="fixed z-[100] w-max max-w-[min(360px,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto whitespace-pre-line break-words rounded-lg bg-slate-800 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg" @mouseenter="enter" @mouseleave="leave" @keydown.esc.stop="hide">
      <slot>{{ content }}</slot>
    </div>
  </Teleport>
</template>
