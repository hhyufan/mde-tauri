/**
 * ?????????
 *
 * ??????????????????? ID?????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 当前设备稳定使用的唯一标识。
 *
 * 它会在首次访问时生成一次，并持久化到 localStorage。
 * 云同步层在每次推送时都会带上这个 id，服务端据此记录
 * 每台设备把文档落在哪个本地绝对路径上：
 * `SyncDocument.devicePaths[deviceId] = absoluteLocalPath`。
 *
 * 如果用户重装应用或清空本地存储，就会生成新的设备 id。
 * 这是刻意保留的行为，因为新的安装实例并不持有旧的本地文件，
 * 需要重新通过“外部文档首次保存”的流程完成绑定。
 */
function newDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `dev_${crypto.randomUUID()}`;
  }
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const useDeviceStore = create(
  persist(
    (set, get) => ({
      deviceId: '',

      /** 返回当前设备 id；若尚不存在，则即时生成并持久化。 */
      getId: () => {
        const cur = get().deviceId;
        if (cur) return cur;
        const id = newDeviceId();
        set({ deviceId: id });
        return id;
      },
    }),
    {
      name: 'mde-device-id',
    },
  ),
);

export default useDeviceStore;
