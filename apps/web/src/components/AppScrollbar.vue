<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 仿 Element el-scrollbar 的滚动容器:
 * 隐藏原生滚动条,右侧渲染细滚动条(悬停或滚动时出现),支持拖拽与轨道点击。
 */
const props = withDefaults(
  defineProps<{
    /** 固定高度,如 '20rem';不传则撑满父容器 */
    height?: string;
    /** 最大高度,如 '20rem' */
    maxHeight?: string;
  }>(),
  { height: undefined, maxHeight: undefined },
);

const wrap = ref<HTMLElement | null>(null);
const thumbHeight = ref(0);
const thumbOffset = ref(0);
const hovered = ref(false);
const scrolled = ref(false);
const dragging = ref(false);
let hideTimer: number | undefined;
let raf = 0;
let observer: MutationObserver | undefined;

const rootStyle = computed(() => ({ height: props.height, maxHeight: props.maxHeight }));
const barVisible = computed(() => hovered.value || dragging.value || scrolled.value);

function update(): void {
  const el = wrap.value;
  if (!el) return;
  const { clientHeight, scrollHeight, scrollTop } = el;
  if (scrollHeight <= clientHeight + 1) {
    thumbHeight.value = 0;
    return;
  }
  thumbHeight.value = Math.max(20, (clientHeight / scrollHeight) * clientHeight);
  const track = clientHeight - thumbHeight.value;
  thumbOffset.value = (scrollTop / (scrollHeight - clientHeight)) * track;
}

function scheduleUpdate(): void {
  if (raf) return;
  raf = window.requestAnimationFrame(() => {
    raf = 0;
    update();
  });
}

function showBar(): void {
  scrolled.value = true;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => (scrolled.value = false), 800);
}

function onScroll(): void {
  scheduleUpdate();
  showBar();
}

function onThumbDown(e: MouseEvent): void {
  const el = wrap.value;
  if (!el) return;
  e.preventDefault();
  dragging.value = true;
  const startY = e.clientY;
  const startOffset = thumbOffset.value;
  const onMove = (ev: MouseEvent): void => {
    const track = el.clientHeight - thumbHeight.value;
    if (track <= 0) return;
    const ratio = (el.scrollHeight - el.clientHeight) / track;
    el.scrollTop = (startOffset + (ev.clientY - startY)) * ratio;
  };
  const onUp = (): void => {
    dragging.value = false;
    showBar(); // 指针若已移出容器,800ms 后恢复自动隐藏
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function onTrackDown(e: MouseEvent): void {
  const el = wrap.value;
  if (!el) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const track = el.clientHeight - thumbHeight.value;
  if (track <= 0) return;
  const target = e.clientY - rect.top - thumbHeight.value / 2;
  el.scrollTop = Math.min(track, Math.max(0, target)) * ((el.scrollHeight - el.clientHeight) / track);
}

onMounted(() => {
  update();
  // 内容/路由切换后重新计算
  observer = new MutationObserver(scheduleUpdate);
  if (wrap.value) observer.observe(wrap.value, { childList: true, characterData: true, subtree: true });
  window.addEventListener('resize', scheduleUpdate);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('resize', scheduleUpdate);
  window.clearTimeout(hideTimer);
  if (raf) window.cancelAnimationFrame(raf);
});

defineExpose({ update });
</script>

<template>
  <div class="relative h-full overflow-hidden" :style="rootStyle" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <div ref="wrap" class="scroll-wrap h-full overflow-y-auto" @scroll="onScroll">
      <slot />
    </div>
    <div
      v-show="thumbHeight > 0"
      class="absolute inset-y-0 right-0.5 z-10 flex w-1.5 items-start transition-opacity duration-200"
      :class="barVisible ? 'opacity-100' : 'opacity-0'"
      @mousedown="onTrackDown"
    >
      <div
        class="w-1.5 cursor-pointer rounded-full bg-slate-400/40 transition-colors hover:bg-slate-400/70"
        :class="dragging ? '!bg-slate-400/80' : ''"
        :style="{ height: `${thumbHeight}px`, transform: `translateY(${thumbOffset}px)` }"
        @mousedown="onThumbDown"
      />
    </div>
  </div>
</template>

<style scoped>
.scroll-wrap {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scroll-wrap::-webkit-scrollbar {
  display: none;
}
</style>
