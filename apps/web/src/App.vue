<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppScrollbar from './components/AppScrollbar.vue';
import AppSidebar from './components/AppSidebar.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import Toasts from './components/Toasts.vue';
import SettingsModal from './components/SettingsModal.vue';
import { initStore } from './stores/app.js';

const settingsOpen = ref(false);

onMounted(() => {
  void initStore().catch((err) => console.error('[spark] 初始化失败:', err));
});
</script>

<template>
  <div class="app-shell">
    <AppSidebar @open-settings="settingsOpen = true" />
    <main class="app-main">
      <router-view v-slot="{ Component, route }">
        <AppScrollbar v-if="route.name === 'home' || route.name === 'resources'">
          <component :is="Component" class="page-view" />
        </AppScrollbar>
        <component :is="Component" v-else class="page-view" />
      </router-view>
    </main>
    <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />
    <ConfirmDialog />
    <Toasts />
  </div>
</template>
