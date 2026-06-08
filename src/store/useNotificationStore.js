/**
 * ?????????
 *
 * ??????????????????????????????
 */
import { create } from 'zustand';

let notifId = 0;

/**
 * 全局通知中心 store。
 *
 * 管理带标题的通知队列，并在指定时长后自动移除，供顶部通知容器统一渲染。
 */
const useNotificationStore = create((set) => ({
  notifications: [],

  /**
   * 追加一条通知；`duration <= 0` 时保持常驻，等待手动关闭。
   */
  notify: (type, title, message = '', duration = 4000) => {
    const id = ++notifId;
    set((state) => ({
      notifications: [...state.notifications, { id, type, title, message, duration }],
    }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }
  },

  /**
   * 按通知 ID 主动关闭指定项。
   */
  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));

export default useNotificationStore;
