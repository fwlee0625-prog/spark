<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import type { ShellMode } from "@spark/shared";
import { api } from "../api/client.js";
import { refreshSettings, store } from "../stores/app.js";
import { toast } from "../composables/toast.js";
import Icon from "./Icon.vue";
import Modal from "./Modal.vue";
import Tooltip from "./Tooltip.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const saving = ref(false);

const form = reactive({
  shellMode: "login" as ShellMode,
  logMaxLines: 5000,
  autoRestartMax: 3,
  stopProjectsOnExit: false,
});

watch(
  () => [props.open, store.settings] as const,
  ([open, s]) => {
    if (open && s) {
      form.stopProjectsOnExit = s.stopProjectsOnExit;
      form.shellMode = s.shellMode;
      form.logMaxLines = s.logMaxLines;
      form.autoRestartMax = s.autoRestartMax;
    }
  },
  { immediate: true },
);

const modeOptions: { value: ShellMode; title: string }[] = [
  { value: "login", title: "登录 shell" },
  { value: "non-login", title: "非登录 shell" },
  { value: "direct", title: "直接 spawn" },
];

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    await api.updateSettings({ ...form });
    await refreshSettings();
    toast("设置已保存", "success");
    emit("close");
  } catch (err) {
    toast(`保存失败:${(err as Error).message}`, "error");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="设置" width="max-w-5xl" @close="emit('close')">
    <template #title-extra><Tooltip label="设置说明" content="调整退出行为、启动方式与日志策略，保存后立即生效。" /></template>

    <div class="space-y-4">
      <section class="glass-card rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="text-sm font-semibold text-slate-700">退出行为</h2>
        <label class="mt-3 flex cursor-pointer items-start gap-3">
          <input v-model="form.stopProjectsOnExit" type="checkbox" class="mt-1 h-4 w-4 accent-blue-500" />
          <span>
            <span class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">退出 Spark 时停止所有项目<Tooltip label="退出行为说明" content="默认关闭：项目会在后台继续运行，Spark 下次启动时自动扫描并同步状态。开启后，关闭或重启 Spark 会停止所有项目。关闭浏览器页面不受此设置影响。
Spark 关闭期间不执行崩溃自动重启；重新打开后恢复管理。" /></span>
          </span>
        </label>
      </section>

      <!-- Shell 启动方式 -->
      <section class="glass-card rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="flex items-center gap-1.5 text-sm font-semibold text-slate-700">Shell 启动方式<Tooltip label="Shell 启动方式说明" content="决定项目命令以什么方式执行，影响 PATH、nvm、pyenv、conda 等环境。&#10;&#10;登录 shell (zsh -ilc)：加载 .zshrc，PATH/nvm/pyenv 与终端一致（默认）&#10;非登录 shell (zsh -lc)：跳过 .zshrc，.zshrc 过重导致启动慢时可切换&#10;直接 spawn (/bin/sh -c)：最快，但可能缺少自定义 PATH" /></h2>
        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label
            v-for="opt in modeOptions"
            :key="opt.value"
            class="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3"
            :class="
              form.shellMode === opt.value
                ? 'border-blue-300 bg-blue-50/60'
                : 'border-slate-200 hover:bg-slate-50'
            "
          >
            <input
              v-model="form.shellMode"
              type="radio"
              :value="opt.value"
              class="h-4 w-4 accent-blue-500"
            />
            <span class="text-sm font-medium text-slate-700">{{ opt.title }}</span>
          </label>
        </div>
      </section>

      <!-- 日志与重启 -->
      <section class="glass-card rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="text-sm font-semibold text-slate-700">日志与崩溃重启</h2>
        <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">每项目日志保留行数<Tooltip label="日志保留行数说明" content="环形缓冲，超出后丢弃最旧的行（100-100000）。" /></label>
            <input
              v-model.number="form.logMaxLines"
              type="number"
              min="100"
              max="100000"
              step="100"
              class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">崩溃自动重启次数上限<Tooltip label="自动重启次数说明" content="仅对开启「自动重启」的项目生效，指数退避重试。" /></label>
            <input
              v-model.number="form.autoRestartMax"
              type="number"
              min="0"
              max="10"
              class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      </section>

      <!-- 数据目录 -->
      <section class="glass-card rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="flex items-center gap-1.5 text-sm font-semibold text-slate-700">数据存储<Tooltip label="数据存储说明" content="projects.json（项目与分组）、settings.json（应用设置）；写入采用临时文件 + rename，可直接备份迁移。" /></h2>
        <div
          class="mt-3 flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3"
        >
          <Icon name="folder" size="sm" class="mt-0.5 text-slate-400" />
          <div class="min-w-0 text-xs leading-5 text-slate-500">
            <p>
              配置文件目录:<span class="break-all font-mono text-slate-700">{{
                store.settings?.dataDir ?? "…"
              }}</span>
            </p>
          </div>
        </div>
      </section>
    </div>
    <template #footer>
      <button
        type="button"
        class="rounded-xl px-4 py-2 text-sm text-slate-500 hover:bg-slate-100"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        type="button"
        :disabled="saving"
        class="rounded-xl bg-blue-500 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        @click="save"
      >
        {{ saving ? "保存中…" : "保存设置" }}
      </button>
    </template>
  </Modal>
</template>
