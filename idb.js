// idb.js — IndexedDB wrapper pro mobile logger (v1)
const DB_NAME = "mv_mobile_logger_db";
const DB_VER = 3;

export const STORES = {
  meta: "meta",       // deviceId, ...
  pack: "pack",       // key="current" -> jobpack json
  drafts: "drafts",   // key=visitId -> draft
  photos: "photos",   // key=photoId -> { blob, mime, takenAt, visitId }
};

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)){
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const out = fn(store);
    tx.oncomplete = () => { db.close(); resolve(out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const IDB = {
  STORES,

  async get(store, key){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const st = tx.objectStore(store);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  },

  async set(store, key, value){
    return withStore(store, "readwrite", (st) => st.put(value, key));
  },

  async del(store, key){
    return withStore(store, "readwrite", (st) => st.delete(key));
  },

  async keys(store){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const st = tx.objectStore(store);
      const req = st.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }
};
