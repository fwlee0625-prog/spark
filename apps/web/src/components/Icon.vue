<script setup lang="ts">
import { ICONS, type IconName } from './icons.js';

const props = withDefaults(defineProps<{ name: IconName; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' });

const sizeClass = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' }[props.size];
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.6"
    stroke="currentColor"
    :class="sizeClass"
    aria-hidden="true"
  >
    <path v-for="(d, i) in ICONS[props.name]" :key="i" stroke-linecap="round" stroke-linejoin="round" :d="d" />
  </svg>
</template>
