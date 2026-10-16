<script setup lang="ts">
import { useRoute } from 'vue-router';
import { store } from '../stores/app.js';
import Icon from './Icon.vue';

const route = useRoute();
const emit = defineEmits<{ 'open-settings': [] }>();

const nav = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/projects', label: '项目列表', icon: 'list' },
  { to: '/ports', label: '端口管理', icon: 'ports' },
  { to: '/logs', label: '软件日志', icon: 'terminal' },
] as const;
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-brand">
      <img class="brand-icon" src="/logo.png" alt="Spark" width="40" height="40" />
      <span>本地项目管理</span>
    </div>
    <nav class="sidebar-nav">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="sidebar-link"
        :class="{ 'is-active': route.path === item.to }"
        :aria-current="route.path === item.to ? 'page' : undefined"
      >
        <Icon :name="item.icon" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div class="sidebar-footer">
      <button type="button" class="sidebar-link min-w-0 flex-1 text-left" aria-label="设置" aria-haspopup="dialog" @click="emit('open-settings')">
        <Icon name="cog" /><span>设置</span>
      </button>
      <div class="connection-status" :class="{ 'is-connected': store.connected }" role="status" :title="store.connected ? '实时连接正常' : '等待连接…'">
        <span class="connection-dot" aria-hidden="true"></span>
        <span class="sr-only">{{ store.connected ? '实时连接正常' : '等待连接…' }}</span>
      </div>
    </div>
  </aside>
</template>
