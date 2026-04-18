import { create } from 'zustand';

let notifId = 0;

const useNotificationStore = create((set) => ({
  notifications: [],

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

  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));

export default useNotificationStore;
