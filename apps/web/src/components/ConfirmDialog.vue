<script setup lang="ts">
import { acceptConfirm, cancelConfirm, useConfirmState } from '../composables/confirm.js';
import Icon from './Icon.vue';

const state = useConfirmState();
</script>

<template>
  <Teleport to="body">
    <div v-if="state.open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="dialog-backdrop absolute inset-0" @click="cancelConfirm"></div>
      <div class="relative z-10 w-full max-w-sm glass-dialog p-5">
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            :class="state.danger ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'"
          >
            <Icon name="warning" />
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-slate-800">{{ state.title }}</h3>
            <p class="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-slate-500">{{ state.message }}</p>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            @click="cancelConfirm"
          >
            取消
          </button>
          <button
            class="rounded-lg px-4 py-2 text-sm font-medium text-white"
            :class="state.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'"
            @click="acceptConfirm"
          >
            {{ state.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
