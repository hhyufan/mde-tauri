// 图片单独存入 IndexedDB，避免大图挤占配置的 localStorage 配额。
let database;

const DB_NAME = 'mokidown-backgrounds';
const STORE_NAME = 'images';

/**
 * 品牌更名（MDE → MokiDown）前的旧库名。
 *
 * 库里存的是用户选过的背景图（配置里的 backgroundImage 存的是它的 id），
 * 只在“新库还没有任何图片”时把旧库的图片复制过来，复制完成保留旧库不删除。
 */
const LEGACY_DB_NAME = 'mde-backgrounds';

function openStore(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 打开一个“已经存在”的旧库。
 *
 * 旧库从未创建过时，indexedDB.open 会新造一个空库；这里在 onupgradeneeded 里中止
 * 这次升级事务，从而既不产生垃圾库，也能用 onerror 明确判定“旧库不存在”。
 */
function openLegacyStore() {
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = () => {
      try {
        request.transaction.abort();
      } catch {
        /* 已经无法中止时交给 onerror 分支处理 */
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function countImages(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

function readImages(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
    const records = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      records.push([cursor.key, cursor.value]);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function writeImages(db, records) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const [key, value] of records) store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * 一次性迁移：把旧库里的背景图复制到新库。
 *
 * 只有新库为空、且旧库确实存在时才执行；任何失败都只当作“没有可迁移的数据”，
 * 不影响背景图功能本身（最坏情况是用户重新选一次图片）。
 */
async function copyLegacyImages(target) {
  if (await countImages(target)) return;
  const legacy = await openLegacyStore();
  if (!legacy) return;
  let records = [];
  try {
    records = await readImages(legacy);
  } catch {
    // 旧库存在但没有 images 对象仓库：没有可迁移的数据。
    records = [];
  }
  legacy.close();
  if (!records.length) return;
  await writeImages(target, records);
}

function openDatabase() {
  if (!database) {
    database = openStore(DB_NAME)
      .then(async (db) => {
        await copyLegacyImages(db).catch(() => {});
        return db;
      })
      .catch((error) => {
        database = null;
        throw error;
      });
  }
  return database;
}

async function transact(mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
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
