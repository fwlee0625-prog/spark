<script setup lang="ts">
import Icon from './Icon.vue';
import Tooltip from './Tooltip.vue';

const props = defineProps<{ terminalNumber: number }>();
const rows = defineModel<{ key: string; value: string }[]>({ required: true });
</script>

<template>
  <div class="border-t border-slate-200/70 pt-3">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="flex items-center gap-1.5 text-xs text-slate-500">环境变量（可选）<Tooltip label="终端环境变量说明" content="仅用于此终端，每个终端可独立配置。" /></label>
      <button type="button" :aria-label="`终端 ${props.terminalNumber} 添加环境变量`" class="flex items-center gap-1 text-xs font-medium text-blue-500 hover:text-blue-600" @click="rows.push({ key: '', value: '' })">
        <Icon name="plus" size="sm" /> 添加
      </button>
    </div>
    <div class="space-y-2">
      <div v-for="(row, i) in rows" :key="i" class="flex items-center gap-2">
        <input v-model="row.key" :aria-label="`终端 ${props.terminalNumber} 环境变量 ${i + 1} 名称`" type="text" placeholder="KEY" class="w-1/3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm outline-none focus:border-blue-400" />
        <input v-model="row.value" :aria-label="`终端 ${props.terminalNumber} 环境变量 ${i + 1} 值`" type="text" placeholder="value" class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm outline-none focus:border-blue-400" />
        <button type="button" :aria-label="`终端 ${props.terminalNumber} 移除环境变量 ${i + 1}`" class="rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500" @click="rows.splice(i, 1)">
          <Icon name="trash" size="sm" />
        </button>
      </div>
    </div>
  </div>
</template>
