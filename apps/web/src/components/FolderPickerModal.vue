<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FsListing } from '@spark/shared';
import { api } from '../api/client.js';
import Icon from './Icon.vue';
import Modal from './Modal.vue';

const props = defineProps<{ open: boolean; initialDir?: string }>();
const emit = defineEmits<{ close: []; select: [dir: string] }>();

const listing = ref<FsListing | null>(null);
const loading = ref(false);
const error = ref('');
const showHidden = ref(false);
const jumpPath = ref('');

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = '';
      showHidden.value = false;
      void load(props.initialDir?.trim() || '~');
    }
  },
);

/** dir 为空或 ~ 时服务端返回主目录 */
async function load(dir: string): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    listing.value = await api.listDir(dir || '~', showHidden.value);
    jumpPath.value = listing.value.path;
  } catch (err) {
    // 加载失败保持停留在当前目录,仅提示原因
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

const breadcrumbs = computed(() => {
  const p = listing.value?.path ?? '';
  const segs = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of p.split('/').filter(Boolean)) {
    acc += `/${part}`;
    segs.push({ label: part, path: acc });
  }
  return segs;
});

function enter(dir: string): void {
  void load(dir);
}

function choose(): void {
  if (!listing.value || loading.value) return;
  emit('select', listing.value.path);
  emit('close');
}
</script>

<template>
  <Modal :open="open" title="选择项目目录" width="max-w-xl" @close="emit('close')">
    <div class="space-y-3">
      <!-- 面包屑 + 快捷操作 -->
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!listing?.parent || loading"
          title="上级目录"
          @click="enter(listing!.parent!)"
        >
          <Icon name="arrowUp" size="sm" />
        </button>
        <button
          type="button"
          class="rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="loading"
          title="主目录"
          @click="enter('~')"
        >
          <Icon name="home" size="sm" />
        </button>
        <div class="ml-1 flex h-10 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
          <template v-for="(seg, i) in breadcrumbs" :key="seg.path">
            <span v-if="i" class="px-0.5 text-slate-300">/</span>
            <button
              type="button"
              class="rounded px-1 py-0.5 transition-colors hover:bg-slate-200 hover:text-slate-700"
              :class="i === breadcrumbs.length - 1 ? 'font-medium text-slate-700' : 'text-slate-500'"
              @click="enter(seg.path)"
            >
              {{ seg.label }}
            </button>
          </template>
        </div>
        <button
          type="button"
          class="rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="loading || !listing"
          title="刷新"
          @click="enter(listing!.path)"
        >
          <Icon name="refresh" size="sm" />
        </button>
      </div>

      <!-- 直接输入路径跳转 -->
      <form class="flex gap-2" @submit.prevent="enter(jumpPath.trim())">
        <input
          v-model="jumpPath"
          type="text"
          spellcheck="false"
          placeholder="输入绝对路径,如 /Users/me/code,支持 ~"
          class="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="submit"
          class="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          :disabled="loading"
        >
          前往
        </button>
      </form>

      <!-- 子目录列表 -->
      <div class="h-72 overflow-y-auto rounded-xl border border-slate-100 [scrollbar-gutter:stable]">
        <p v-if="error" class="px-3 py-2 text-xs text-red-500">{{ error }}</p>
        <div v-if="loading" class="flex h-full items-center justify-center text-sm text-slate-400">加载中…</div>
        <template v-else-if="listing">
          <button
            v-for="d in listing.dirs"
            :key="d.path"
            type="button"
            class="group flex w-full items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-blue-50"
            @click="enter(d.path)"
          >
            <Icon name="folder" size="sm" class="shrink-0 text-blue-400" />
            <span class="min-w-0 flex-1 truncate text-slate-600">{{ d.name }}</span>
            <Icon name="chevronRight" size="sm" class="shrink-0 text-slate-300 transition-colors group-hover:text-blue-400" />
          </button>
          <div v-if="!listing.dirs.length" class="flex h-full flex-col items-center justify-center gap-1 text-sm text-slate-400">
            <p>没有子目录</p>
            <p class="text-xs text-slate-300">可以直接点击下方「选择此目录」</p>
          </div>
        </template>
      </div>

      <div class="flex items-center justify-between gap-3">
        <label class="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-500">
          <input
            v-model="showHidden"
            type="checkbox"
            class="h-3.5 w-3.5 accent-blue-500"
            @change="listing && enter(listing.path)"
          />
          显示隐藏目录
        </label>
        <p class="min-w-0 truncate font-mono text-xs text-slate-400" :title="listing?.path">{{ listing?.path }}</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="emit('close')">
        取消
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        :disabled="!listing || loading"
        @click="choose"
      >
        选择此目录
      </button>
    </template>
  </Modal>
</template>
