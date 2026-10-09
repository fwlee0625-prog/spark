<script setup lang="ts">
import { computed } from 'vue';
import { typeMeta } from '../utils/format.js';

const props = defineProps<{ type: string }>();
const meta = computed(() => typeMeta(props.type));
</script>

<template>
  <span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium" :class="meta.badgeClass">
    {{ meta.label }}
  </span>
</template>
