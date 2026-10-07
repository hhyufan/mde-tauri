// 图片单独存入 IndexedDB，避免大图挤占配置的 localStorage 配额。
let database;

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('mde-backgrounds', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      database = null;
      throw error;
    });
  }
  return database;
}

async function transact(mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('images', mode);
    const request = run(transaction.objectStore('images'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveBackgroundImage(blob) {
  const id = crypto.randomUUID();
  await transact('readwrite', (store) => store.put(blob, id));
  return id;
}

export function readBackgroundImage(id) {
  return transact('readonly', (store) => store.get(id));
}

export function deleteBackgroundImage(id) {
  return id ? transact('readwrite', (store) => store.delete(id)) : Promise.resolve();
}

export function validateBackgroundImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid image'));
    };
    image.src = url;
  });
}

export function getBackgroundTransparency(values, theme) {
  const value = values?.[theme];
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 80;
}
