/**
 * ????????
 *
 * ???? Toast ????????????????????????
 */
import { create } from 'zustand';

let toastId = 0;

/**
 * 轻提示 store。
 *
 * 适合承载无标题、短时长的瞬时反馈，与通知中心职责区分开。
 */
const useToastStore = create((set) => ({
  toasts: [],

  /**
   * 追加一条 toast；默认短暂显示后自动消失。
   */
  toast: (message, duration = 2500) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, duration }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  /**
   * 手动移除指定 toast。
   */
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export default useToastStore;
