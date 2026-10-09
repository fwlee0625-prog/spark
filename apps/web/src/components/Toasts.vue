<script setup lang="ts">
import { toasts } from '../composables/toast.js';
import Icon from './Icon.vue';
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed right-5 top-5 z-[60] flex w-80 flex-col gap-2">
      <TransitionGroup>
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex items-start gap-2.5 rounded-xl bg-white p-3.5 shadow-lg ring-1 ring-slate-900/5"
        >
          <Icon
            :name="t.type === 'success' ? 'check' : t.type === 'error' ? 'warning' : 'bolt'"
            size="sm"
            :class="t.type === 'success' ? 'mt-0.5 text-emerald-500' : t.type === 'error' ? 'mt-0.5 text-red-500' : 'mt-0.5 text-blue-500'"
          />
          <p class="whitespace-pre-wrap break-all text-sm leading-5 text-slate-600">{{ t.message }}</p>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
