<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue';
import Icon from './Icon.vue';

export interface SelectOption {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    /** md 与表单输入框一致,sm 用于紧凑场景 */
    size?: 'sm' | 'md';
    /** 列表页筛选用 xl,表单内用 lg */
    rounded?: 'lg' | 'xl';
  }>(),
  { placeholder: '', disabled: false, size: 'md', rounded: 'lg' },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const popupStyle = ref<CSSProperties>({ visibility: 'hidden' });

const selected = computed(() => props.options.find((o) => o.value === props.modelValue));
// 选项里找不到时(如分组刚被删除)回退显示原始值
const displayLabel = computed(() => selected.value?.label ?? props.modelValue);
const isPlaceholder = computed(() => !props.modelValue);

async function toggle(): Promise<void> {
  if (props.disabled) return;
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  activeIndex.value = props.options.findIndex((o) => o.value === props.modelValue);
  await nextTick();
  updatePosition();
  await nextTick();
  scrollActiveIntoView();
}

function updatePosition(): void {
  if (!open.value || !trigger.value || !popup.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const above = Math.max(0, rect.top - margin - gap);
  const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
  const desiredHeight = Math.min(240, popup.value.scrollHeight + 2);
  const dropUp = below < desiredHeight && above > below;
  const maxHeight = Math.min(240, dropUp ? above : below);
  const height = Math.min(desiredHeight, maxHeight);
  const width = Math.min(rect.width, Math.max(0, window.innerWidth - margin * 2));
  popupStyle.value = {
    top: `${dropUp ? rect.top - gap - height : rect.bottom + gap}px`,
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - margin - width))}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    visibility: 'visible',
  };
}

function close(): void {
  open.value = false;
  activeIndex.value = -1;
  popupStyle.value = { visibility: 'hidden' };
}

function select(option: SelectOption): void {
  emit('update:modelValue', option.value);
  close();
  trigger.value?.focus();
}

function move(delta: number): void {
  const n = props.options.length;
  if (!n) return;
  if (activeIndex.value < 0) activeIndex.value = delta > 0 ? 0 : n - 1;
  else activeIndex.value = (activeIndex.value + delta + n) % n;
  void nextTick(scrollActiveIntoView);
}

function scrollActiveIntoView(): void {
  const list = popup.value;
  const option = list?.querySelector<HTMLElement>('[data-active="true"]');
  if (!list || !option) return;
  // 只滚动选项列表，避免 scrollIntoView 连带滚动弹框或页面。
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) return;
  if (!open.value) {
    // Enter/Space 交给按钮原生 click 触发 toggle,这里只接管方向键
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void toggle();
    }
    return;
  }
  switch (e.key) {
    case 'Escape':
      // 只关下拉,不冒泡到 Modal 的 document 级 Escape 监听(否则整个弹窗被一并关闭)
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.value?.focus();
      break;
    case 'ArrowDown':
      e.preventDefault();
      move(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      move(-1);
      break;
    case 'Home':
      e.preventDefault();
      activeIndex.value = 0;
      move(0);
      break;
    case 'End':
      e.preventDefault();
      activeIndex.value = props.options.length - 1;
      move(0);
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (activeIndex.value >= 0 && activeIndex.value < props.options.length) {
        select(props.options[activeIndex.value]);
      }
      break;
    case 'Tab':
      close();
      break;
  }
}

function onDocMousedown(e: MouseEvent): void {
  if (!open.value) return;
  const target = e.target as Node;
  if (!root.value?.contains(target) && !popup.value?.contains(target)) close();
}

function onScroll(e: Event): void {
  if (popup.value?.contains(e.target as Node)) return;
  // 外部容器滚动时收起，避免浮层留在已被裁剪的选择框旁。
  close();
}

watch(() => props.disabled, (disabled) => { if (disabled) close(); });
watch(() => props.options, () => { void nextTick(updatePosition); }, { deep: true });

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', updatePosition);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', updatePosition);
});
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="disabled"
      class="flex w-full items-center justify-between gap-2 border border-slate-200 bg-white text-left text-slate-600 outline-none transition-colors hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
      :class="[size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm', rounded === 'xl' ? 'rounded-xl' : 'rounded-lg']"
      @click="toggle"
    >
      <span class="min-w-0 flex-1 truncate" :class="isPlaceholder ? 'text-slate-400' : ''">{{ displayLabel || placeholder }}</span>
      <Icon name="chevronDown" size="sm" class="shrink-0 text-slate-400 transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>

    <Teleport to="body">
      <div
        v-show="open"
        ref="popup"
        role="listbox"
        class="fixed z-[60] overflow-y-auto overscroll-contain rounded-xl border border-slate-100 bg-white py-1 shadow-xl shadow-slate-900/5"
        :style="popupStyle"
        @keydown="onKeydown"
      >
        <div v-if="!options.length" class="px-3 py-2 text-xs text-slate-400">暂无选项</div>
        <button
          v-for="(o, i) in options"
          :key="o.value"
          type="button"
          role="option"
          :aria-selected="o.value === modelValue"
          :data-active="i === activeIndex"
          class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors"
          :class="i === activeIndex ? 'bg-slate-100' : ''"
          @click="select(o)"
          @mousemove="activeIndex = i"
        >
          <span class="min-w-0 truncate" :class="o.value === modelValue ? 'font-medium text-blue-600' : 'text-slate-600'">{{ o.label }}</span>
          <Icon v-if="o.value === modelValue" name="check" size="sm" class="shrink-0 text-blue-500" />
        </button>
      </div>
    </Teleport>
  </div>
</template>
