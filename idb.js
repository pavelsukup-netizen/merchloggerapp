// idb.js — jednoduchý wrapper nad IndexedDB (v1 kontrakt)
const DB_NAME = "mv_mobile_logger_db";
const DB_VER = 2;

const STORES = {
  meta: "meta",     // key -> any (deviceId, lastExportDate, ...)
  pack: "pack",     // key="current" -> jobpack json
  drafts: "drafts", // key=visitId -> draft result (rozpracovaný / hotový)
  photos: "photos", // key=photoId -> { blob, mime, takenAt, visitId }
};

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      for (const k of Object.values(STORES)){
        if (!db.objectStoreNames.contains(k)) db.createObjectStore(k);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const out = fn(s);
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export const IDB = {
  STORES,

  async get(store, key){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, "readonly");
      const s = t.objectStore(store);
      const req = s.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
  },

  async set(store, key, value){
    return tx(store, "readwrite", (s) => s.put(value, key));
  },

  async del(store, key){
    return tx(store, "readwrite", (s) => s.delete(key));
  },

  async keys(store){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, "readonly");
      const s = t.objectStore(store);
      const req = s.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
  },

  async all(store){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, "readonly");
      const s = t.objectStore(store);
      const req = s.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
  }
};
