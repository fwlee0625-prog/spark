import { reactive } from 'vue';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  danger: boolean;
  resolve: ((v: boolean) => void) | null;
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  confirmText: '确认',
  danger: false,
  resolve: null,
});

/** 全局二次确认,返回 Promise<boolean> */
export function confirmAction(opts: {
  title?: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    state.open = true;
    state.title = opts.title ?? '确认操作';
    state.message = opts.message;
    state.confirmText = opts.confirmText ?? '确认';
    state.danger = opts.danger ?? false;
    state.resolve = resolve;
  });
}

export function useConfirmState(): ConfirmState {
  return state;
}

function settle(v: boolean): void {
  state.resolve?.(v);
  state.resolve = null;
  state.open = false;
}

export function acceptConfirm(): void {
  settle(true);
}

export function cancelConfirm(): void {
  settle(false);
}
