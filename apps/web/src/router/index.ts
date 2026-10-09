import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/projects', name: 'projects', component: () => import('../views/ProjectListView.vue') },
    { path: '/ports', name: 'ports', component: () => import('../views/PortView.vue') },
    { path: '/settings', redirect: '/' },
  ],
});
