import { reactive } from 'vue';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let nextId = 1;
export const toasts = reactive<Toast[]>([]);

export function toast(message: string, type: Toast['type'] = 'info'): void {
  const id = nextId++;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, 3500);
}
