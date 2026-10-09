<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{ open: boolean; title: string; width?: string }>();
const emit = defineEmits<{ close: [] }>();

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close');
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div class="dialog-backdrop absolute inset-0" @click="emit('close')"></div>
      <div
        class="relative z-10 flex max-h-[90vh] w-full flex-col glass-dialog"
        :class="width ?? 'max-w-xl'"
      >
        <div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 class="flex items-center gap-1.5 text-base font-semibold text-slate-800">{{ title }}<slot name="title-extra" /></h3>
          <button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" @click="emit('close')">
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>
        <div v-if="$slots.footer" class="flex justify-end gap-3 border-t border-slate-100 px-5 py-3.5">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
