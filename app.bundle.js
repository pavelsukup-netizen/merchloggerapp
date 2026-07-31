// ../../workspace/scratch/bc498ecb964b/work/merchloggerapp-main/idb.js
var DB_NAME = "mv_mobile_logger_db";
var DB_VER = 3;
var STORES = {
  meta: "meta",
  // deviceId, ...
  pack: "pack",
  // key="current" -> jobpack json
  drafts: "drafts",
  // key=visitId -> draft
  photos: "photos"
  // key=photoId -> { blob, mime, takenAt, visitId }
};
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const out = fn(store);
    tx.oncomplete = () => {
      db.close();
      resolve(out);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
var IDB = {
  STORES,
  async get(store, key) {
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
  async set(store, key, value) {
    return withStore(store, "readwrite", (st) => st.put(value, key));
  },
  async del(store, key) {
    return withStore(store, "readwrite", (st) => st.delete(key));
  },
  async keys(store) {
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

// ../../workspace/scratch/bc498ecb964b/work/merchloggerapp-main/jobpack.js
var JOBPACK_SCHEMA = "merch.jobpack";
var SUPPORTED_JOBPACK_VERSIONS = /* @__PURE__ */ new Set([1, 2]);
var QUESTION_TYPES_V2 = /* @__PURE__ */ new Set(["checkbox", "text", "number", "select", "photo"]);
var OPS_BY_SOURCE = {
  checkbox: /* @__PURE__ */ new Set(["eq"]),
  selectSingle: /* @__PURE__ */ new Set(["eq", "neq"]),
  selectMulti: /* @__PURE__ */ new Set(["contains", "not_contains"]),
  number: /* @__PURE__ */ new Set(["eq", "neq", "gt", "gte", "lt", "lte"])
};
function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}
function sourceKind(question) {
  if (question?.type === "checkbox") return "checkbox";
  if (question?.type === "number") return "number";
  if (question?.type === "select") return question.multi === true ? "selectMulti" : "selectSingle";
  return null;
}
function validDependencyValue(source, value) {
  if (source.type === "checkbox") return typeof value === "boolean";
  if (source.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (source.type === "select") return typeof value === "string" && (source.options || []).includes(value);
  return false;
}
function validateQuestionV2(question, templateId, index, previousById, previousByKey, errors) {
  const where = `Template ${templateId}, ot\xE1zka ${index + 1}`;
  if (!question || typeof question !== "object") {
    errors.push(`${where}: neplatn\xFD objekt ot\xE1zky`);
    return;
  }
  if (typeof question.id !== "string" || !question.id) errors.push(`${where}: chyb\xED id`);
  if (typeof question.key !== "string" || !question.key) errors.push(`${where}: chyb\xED key`);
  if (typeof question.label !== "string" || !question.label) errors.push(`${where}: chyb\xED label`);
  if (!QUESTION_TYPES_V2.has(question.type)) errors.push(`${where}: nepodporovan\xFD type ${question.type || "(pr\xE1zdn\xFD)"}`);
  if (typeof question.required !== "boolean") errors.push(`${where}: required mus\xED b\xFDt boolean`);
  if (question.partnerIds !== void 0 && (!Array.isArray(question.partnerIds) || question.partnerIds.some((id) => typeof id !== "string"))) {
    errors.push(`${where}: partnerIds mus\xED b\xFDt pole textov\xFDch ID`);
  }
  if (question.help !== void 0 && typeof question.help !== "string") errors.push(`${where}: help mus\xED b\xFDt text`);
  if (question.counter !== void 0 && typeof question.counter !== "boolean") errors.push(`${where}: counter mus\xED b\xFDt boolean`);
  if (question.stepper !== void 0 && typeof question.stepper !== "boolean") errors.push(`${where}: stepper mus\xED b\xFDt boolean`);
  if (question.type === "select") {
    if (!Array.isArray(question.options) || question.options.some((option) => typeof option !== "string")) {
      errors.push(`${where}: select mus\xED m\xEDt options[] z textov\xFDch hodnot`);
    }
    if (question.multi !== void 0 && typeof question.multi !== "boolean") {
      errors.push(`${where}: multi mus\xED b\xFDt boolean`);
    }
  }
  if (question.type === "photo") {
    const min = question.photo?.photosMin;
    const max = question.photo?.photosMax;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
      errors.push(`${where}: photo.photosMin/photosMax nejsou platn\xE9`);
    }
  }
  const dependency = question.dependsOn;
  if (!dependency) return;
  const sourceById = previousById.get(dependency.questionId);
  const sourceByKey = previousByKey.get(dependency.key);
  if (!sourceById) errors.push(`${where}: dependsOn.questionId neodkazuje na d\u0159\xEDv\u011Bj\u0161\xED ot\xE1zku`);
  if (!sourceByKey) errors.push(`${where}: dependsOn.key neodkazuje na d\u0159\xEDv\u011Bj\u0161\xED ot\xE1zku`);
  if (!sourceById || !sourceByKey) return;
  if (sourceById !== sourceByKey) {
    errors.push(`${where}: dependsOn.questionId a key odkazuj\xED na r\u016Fzn\xE9 ot\xE1zky`);
    return;
  }
  const kind = sourceKind(sourceById);
  if (!kind) {
    errors.push(`${where}: typ hlavn\xED ot\xE1zky nesm\xED b\xFDt zdrojem podm\xEDnky`);
    return;
  }
  if (!OPS_BY_SOURCE[kind].has(dependency.op)) {
    errors.push(`${where}: oper\xE1tor ${dependency.op || "(pr\xE1zdn\xFD)"} nen\xED povolen\xFD pro hlavn\xED ot\xE1zku`);
  }
  if (!validDependencyValue(sourceById, dependency.value)) {
    errors.push(`${where}: dependsOn.value m\xE1 neplatn\xFD typ nebo nen\xED v options`);
  }
  if (typeof dependency.clearWhenHidden !== "boolean") {
    errors.push(`${where}: dependsOn.clearWhenHidden mus\xED b\xFDt boolean`);
  }
}
function validateJobPack(pack) {
  const errors = [];
  if (!pack || pack.schema !== JOBPACK_SCHEMA) {
    return [`Neplatn\xE9 schema (\u010Dek\xE1m ${JOBPACK_SCHEMA})`];
  }
  if (!SUPPORTED_JOBPACK_VERSIONS.has(pack.schemaVersion)) {
    return [`Nepodporovan\xE1 verze jobpacku: ${pack.schemaVersion ?? "neuvedena"} (podporuji v1 a v2)`];
  }
  if (!pack.packId) errors.push("Chyb\xED packId");
  if (!pack.createdAt) errors.push("Chyb\xED createdAt");
  if (!pack.merch?.id) errors.push("Chyb\xED merch.id");
  if (!Array.isArray(pack.stores)) errors.push("Chyb\xED stores[]");
  if (!Array.isArray(pack.templates)) errors.push("Chyb\xED templates[]");
  if (!Array.isArray(pack.visits)) errors.push("Chyb\xED visits[]");
  if (pack.schemaVersion === 2) {
    if (!pack.validFrom) errors.push("Chyb\xED validFrom");
    if (!pack.validTo) errors.push("Chyb\xED validTo");
    if (!Array.isArray(pack.features) || !pack.features.includes("conditionalQuestions")) {
      errors.push("Jobpack v2 mus\xED m\xEDt features[] s conditionalQuestions");
    }
    if (!Array.isArray(pack.retailers)) errors.push("Chyb\xED retailers[]");
    if (!Array.isArray(pack.furnitureTypes)) errors.push("Chyb\xED furnitureTypes[]");
  }
  const stores = Array.isArray(pack.stores) ? pack.stores : [];
  const templates = Array.isArray(pack.templates) ? pack.templates : [];
  const visits = Array.isArray(pack.visits) ? pack.visits : [];
  const storeSet = new Set(stores.map((store) => store.sapId));
  const templateSet = new Set(templates.map((template) => template.templateId));
  const visitIds = /* @__PURE__ */ new Set();
  if (pack.schemaVersion === 2) {
    for (const retailer of Array.isArray(pack.retailers) ? pack.retailers : []) {
      if (!retailer?.id || !retailer?.name) errors.push("Retailer mus\xED m\xEDt id a name");
    }
    for (const store of stores) {
      if (!store?.sapId || !store?.name || !store?.retailerId) errors.push("Prodejna mus\xED m\xEDt sapId, name a retailerId");
    }
  }
  for (const visit of visits) {
    const id = visit?.visitId || "(bez ID)";
    if (!visit?.visitId) errors.push("N\xE1v\u0161t\u011Bva bez visitId");
    else if (visitIds.has(visit.visitId)) errors.push(`Duplicitn\xED visitId: ${visit.visitId}`);
    else visitIds.add(visit.visitId);
    if (!visit?.sapId) errors.push(`N\xE1v\u0161t\u011Bva ${id} bez sapId`);
    if (!visit?.templateId) errors.push(`N\xE1v\u0161t\u011Bva ${id} bez templateId`);
    if (!visit?.date) errors.push(`N\xE1v\u0161t\u011Bva ${id} bez date`);
    if (visit?.sapId && !storeSet.has(visit.sapId)) errors.push(`N\xE1v\u0161t\u011Bva ${id} odkazuje na nezn\xE1mou prodejnu ${visit.sapId}`);
    if (visit?.templateId && !templateSet.has(visit.templateId)) errors.push(`N\xE1v\u0161t\u011Bva ${id} odkazuje na nezn\xE1m\xFD checklist ${visit.templateId}`);
    if (pack.schemaVersion === 2 && visit?.status !== "planned") errors.push(`N\xE1v\u0161t\u011Bva ${id}: status mus\xED b\xFDt planned`);
  }
  for (const template of templates) {
    const templateId = template?.templateId || "(bez ID)";
    if (!template?.templateId) errors.push("Checklist bez templateId");
    if (!Array.isArray(template?.blocks)) {
      errors.push(`Template ${templateId}: chyb\xED blocks[]`);
      continue;
    }
    if (pack.schemaVersion === 2) {
      if (!template?.name) errors.push(`Template ${templateId}: chyb\xED name`);
      if (!Number.isFinite(template?.version)) errors.push(`Template ${templateId}: chyb\xED \u010D\xEDseln\xE1 version`);
      template.blocks.forEach((block, blockIndex) => {
        if (!block?.id || !block?.title) errors.push(`Template ${templateId}, blok ${blockIndex + 1}: chyb\xED id nebo title`);
        if (!Array.isArray(block?.questions)) errors.push(`Template ${templateId}, blok ${blockIndex + 1}: chyb\xED questions[]`);
      });
    }
    const questions = template.blocks.flatMap((block) => Array.isArray(block?.questions) ? block.questions : []);
    const ids = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    const previousById = /* @__PURE__ */ new Map();
    const previousByKey = /* @__PURE__ */ new Map();
    questions.forEach((question, index) => {
      if (question?.id) {
        if (ids.has(question.id)) errors.push(`Template ${templateId}: duplicitn\xED question.id ${question.id}`);
        ids.add(question.id);
      }
      if (question?.key) {
        if (keys.has(question.key)) errors.push(`Template ${templateId}: duplicitn\xED question.key ${question.key}`);
        keys.add(question.key);
      }
      if (pack.schemaVersion === 2) {
        validateQuestionV2(question, templateId, index, previousById, previousByKey, errors);
      } else if (!question?.key) {
        errors.push(`Template ${templateId}: ot\xE1zka bez key`);
      }
      if (question?.id && !previousById.has(question.id)) previousById.set(question.id, question);
      if (question?.key && !previousByKey.has(question.key)) previousByKey.set(question.key, question);
    });
  }
  return errors;
}
function normalizeLegacyCondition(condition) {
  let op = condition?.op;
  let value = condition?.value;
  if (!op && condition?.equals !== void 0) {
    op = "eq";
    value = condition.equals;
  }
  if (!op && condition?.notEquals !== void 0) {
    op = "neq";
    value = condition.notEquals;
  }
  if (value === "ANO") value = true;
  if (value === "NE") value = false;
  return { ...condition, op, value };
}
function evaluateCondition(answers, rawCondition, schemaVersion = 2) {
  const condition = schemaVersion === 1 ? normalizeLegacyCondition(rawCondition || {}) : rawCondition || {};
  if (!condition.key || !own(answers, condition.key)) return false;
  const actual = answers[condition.key];
  switch (condition.op) {
    case "eq":
      return schemaVersion === 1 && Array.isArray(actual) ? actual.includes(condition.value) : actual === condition.value;
    case "neq":
      return schemaVersion === 1 && Array.isArray(actual) ? !actual.includes(condition.value) : actual !== condition.value;
    case "contains":
      return Array.isArray(actual) && actual.includes(condition.value);
    case "not_contains":
      return Array.isArray(actual) && !actual.includes(condition.value);
    case "gt":
      return typeof actual === "number" && actual > condition.value;
    case "gte":
      return typeof actual === "number" && actual >= condition.value;
    case "lt":
      return typeof actual === "number" && actual < condition.value;
    case "lte":
      return typeof actual === "number" && actual <= condition.value;
    case "in":
      return Array.isArray(condition.value) && (Array.isArray(actual) ? actual.some((value) => condition.value.includes(value)) : condition.value.includes(actual));
    case "truthy":
      if (Array.isArray(actual)) return actual.length > 0;
      if (actual && typeof actual === "object" && Array.isArray(actual.photoIds)) return actual.photoIds.length > 0;
      return !!actual;
    case "falsy":
      if (Array.isArray(actual)) return actual.length === 0;
      if (actual && typeof actual === "object" && Array.isArray(actual.photoIds)) return actual.photoIds.length === 0;
      return !actual;
    default:
      return false;
  }
}
function isQuestionVisible(question, answers, retailerId, schemaVersion = 2) {
  if (Array.isArray(question?.partnerIds) && question.partnerIds.length && !question.partnerIds.includes(retailerId)) {
    return false;
  }
  const dependency = question?.dependsOn;
  if (!dependency) return true;
  if (dependency.key) return evaluateCondition(answers, dependency, schemaVersion);
  if (schemaVersion === 1 && Array.isArray(dependency.all)) {
    return dependency.all.every((condition) => evaluateCondition(answers, condition, 1));
  }
  if (schemaVersion === 1 && Array.isArray(dependency.any)) {
    return dependency.any.some((condition) => evaluateCondition(answers, condition, 1));
  }
  return false;
}
function pruneHiddenAnswers(template, draft, schemaVersion = 2) {
  const removedKeys = [];
  const answers = draft?.answers || {};
  const questions = (template?.blocks || []).flatMap((block) => block?.questions || []);
  for (const question of questions) {
    if (isQuestionVisible(question, answers, draft?.retailerId || "", schemaVersion)) continue;
    const clearWhenHidden = question?.dependsOn?.clearWhenHidden ?? true;
    const hiddenByPartner = Array.isArray(question?.partnerIds) && question.partnerIds.length && !question.partnerIds.includes(draft?.retailerId || "");
    if ((hiddenByPartner || clearWhenHidden) && own(answers, question.key)) {
      delete answers[question.key];
      removedKeys.push(question.key);
    }
  }
  return removedKeys;
}
function visibleAnswers(template, draft, schemaVersion = 2) {
  const result = {};
  const answers = draft?.answers || {};
  const questions = (template?.blocks || []).flatMap((block) => block?.questions || []);
  for (const question of questions) {
    if (isQuestionVisible(question, answers, draft?.retailerId || "", schemaVersion) && own(answers, question.key)) {
      result[question.key] = answers[question.key];
    }
  }
  return result;
}
function getDayExportState(pack, drafts, date) {
  const scheduled = (pack?.visits || []).filter((visit) => visit.date === date && visit.status !== "cancelled");
  const draftMap = drafts instanceof Map ? drafts : new Map((drafts || []).map((draft) => [draft.visitId, draft]));
  const unresolved = scheduled.filter((visit) => {
    const draft = draftMap.get(visit.visitId);
    const status = draft?.status;
    const belongsToPack = pack?.schemaVersion === 1 || draft?.packId === pack?.packId;
    return !belongsToPack || status !== "done" && status !== "cancelled";
  });
  return {
    scheduled,
    unresolved,
    canExport: scheduled.length > 0 && unresolved.length === 0,
    resolvedDrafts: scheduled.map((visit) => draftMap.get(visit.visitId)).filter((draft) => draft && (pack?.schemaVersion === 1 || draft.packId === pack?.packId))
  };
}

// ../../workspace/scratch/bc498ecb964b/work/merchloggerapp-main/app.js
var RESULTS_SCHEMA = "merch.results";
var SCHEMA_VERSION = 1;
var APP_VERSION = "2026-07-46";
var state = {
  pack: null,
  deviceId: null,
  uiDate: null,
  drafts: /* @__PURE__ */ new Map(),
  // visitId -> draft
  route: { name: "home", visitId: null },
  // UI state
  ui: {
    openMultiKey: null,
    // která multiselect otázka je rozbalená
    msFilter: {},
    // key -> string (filtr multiselectu)
    collapsedBlocks: {}
    // blockKey -> true (sbaleno)
  }
};
function $(sel) {
  return document.querySelector(sel);
}
function rootEl() {
  return document.querySelector("#main") || document.querySelector("#app") || document.body;
}
function nowISO() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayLocal() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[m]);
}
function toast(msg) {
  console.log("[mobile]", msg);
  alert(msg);
}
function toFiniteNumberOrNull(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
async function loadDeviceId() {
  let did = await IDB.get(IDB.STORES.meta, "deviceId");
  if (!did) {
    did = `DEV-${uuid()}`;
    await IDB.set(IDB.STORES.meta, "deviceId", did);
  }
  state.deviceId = did;
}
async function loadPack() {
  state.pack = await IDB.get(IDB.STORES.pack, "current");
}
async function loadDrafts() {
  const keys = await IDB.keys(IDB.STORES.drafts);
  state.drafts = /* @__PURE__ */ new Map();
  for (const k of keys) {
    const d = await IDB.get(IDB.STORES.drafts, k);
    if (d) state.drafts.set(k, d);
  }
}
function storeBySap(sapId) {
  return (state.pack?.stores || []).find((s) => s.sapId === sapId) || null;
}
function tplById(tid) {
  return (state.pack?.templates || []).find((t) => t.templateId === tid) || null;
}
function ensureDraft(visit) {
  const existing = state.drafts.get(visit.visitId);
  const existingBelongsToPack = state.pack?.schemaVersion === 1 || existing?.packId === state.pack?.packId;
  if (existing && existingBelongsToPack) {
    const store = storeBySap(visit.sapId);
    existing.retailerId = store?.retailerId || existing.retailerId || "";
    existing.storeName = store?.name || existing.storeName || "";
    existing.answers = existing.answers || {};
    return existing;
  }
  const st = storeBySap(visit.sapId);
  const tpl = tplById(visit.templateId);
  const d = {
    schemaVersion: 1,
    packId: state.pack?.packId || null,
    visitId: visit.visitId,
    sapId: visit.sapId,
    date: visit.date,
    templateId: visit.templateId,
    templateVersion: tpl?.version ?? 1,
    startedAt: nowISO(),
    submittedAt: null,
    status: "open",
    // open|done|cancelled
    cancelReason: "",
    answers: {},
    furnitureObservations: []
  };
  d.storeName = st?.name || "";
  d.retailerId = st?.retailerId || "";
  state.drafts.set(visit.visitId, d);
  return d;
}
async function saveDraft(d) {
  const tpl = tplById(d.templateId);
  if (tpl) pruneHiddenAnswers(tpl, d, state.pack?.schemaVersion || 1);
  await IDB.set(IDB.STORES.drafts, d.visitId, d);
  state.drafts.set(d.visitId, d);
}
function setDraftAnswer(draft, key, value) {
  const isEmptyString = typeof value === "string" && value.trim() === "";
  const isEmptyArray = Array.isArray(value) && value.length === 0;
  const isEmptyPhoto = value && typeof value === "object" && Array.isArray(value.photoIds) && value.photoIds.length === 0;
  if (value === null || value === void 0 || isEmptyString || isEmptyArray || isEmptyPhoto) {
    delete draft.answers[key];
  } else {
    draft.answers[key] = value;
  }
}
var PHOTO_COMPRESS = {
  enabled: true,
  maxSide: 1600,
  quality: 0.75,
  mime: "image/jpeg"
};
async function compressImageFile(file, opts = PHOTO_COMPRESS) {
  if (!opts.enabled) return { blob: file, mime: file.type || "image/jpeg" };
  if (!file.type || !file.type.startsWith("image/")) {
    return { blob: file, mime: file.type || "application/octet-stream" };
  }
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    bitmap = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  const maxSide = opts.maxSide || 1600;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const mime = opts.mime || "image/jpeg";
  const quality = typeof opts.quality === "number" ? opts.quality : 0.75;
  let outBlob;
  if (canvas.convertToBlob) {
    outBlob = await canvas.convertToBlob({ type: mime, quality });
  } else {
    outBlob = await new Promise((res) => canvas.toBlob(res, mime, quality));
  }
  if (!outBlob) return { blob: file, mime: file.type || "image/jpeg" };
  return { blob: outBlob, mime };
}
async function addPhotosToDB(files, visitId) {
  const photoIds = [];
  for (const f of files) {
    const photoId = uuid();
    const { blob, mime } = await compressImageFile(f);
    await IDB.set(IDB.STORES.photos, photoId, {
      blob,
      mime,
      takenAt: nowISO(),
      visitId,
      originalName: f.name || null,
      originalSize: f.size || null,
      storedSize: blob.size || null
    });
    photoIds.push(photoId);
  }
  return photoIds;
}
async function getPhotoRec(photoId) {
  return await IDB.get(IDB.STORES.photos, photoId);
}
function extFromMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  return "jpg";
}
function collectQuestions(tpl) {
  const out = [];
  for (const b of tpl.blocks || []) {
    for (const q of b.questions || []) out.push(q);
  }
  return out;
}
function isQuestionForPartner(draft, q) {
  const ids = q?.partnerIds;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  const rid = draft?.retailerId || "";
  if (!rid) return false;
  return ids.includes(rid);
}
function isQuestionActive(draft, q) {
  return isQuestionVisible(q, draft?.answers || {}, draft?.retailerId || "", state.pack?.schemaVersion || 1);
}
async function updateSWBadge() {
  const el = $("#swVer");
  if (!el) return;
  if (!("serviceWorker" in navigator)) {
    el.textContent = "SW: \u2014";
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sw = reg?.active || reg?.waiting || reg?.installing;
  if (!sw) {
    el.textContent = "SW: \u2014";
    return;
  }
  const version = await new Promise((res) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) res(null);
    }, 900);
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => {
        done = true;
        clearTimeout(timer);
        res(ev.data?.version || null);
      };
      sw.postMessage({ type: "GET_VERSION" }, [ch.port2]);
    } catch {
      clearTimeout(timer);
      res(null);
    }
  });
  if (version) {
    el.textContent = `SW: ${version}`;
  } else {
    el.textContent = `SW: ${sw.state || "\u2014"}`;
  }
}
function syncTopbarDate(date) {
  const dp = $("#dayPicker");
  if (dp && dp.value !== date) dp.value = date;
  const pill = $("#datePill");
  if (pill) pill.textContent = (date || "\u2014").split("-").reverse().join(". ");
}
function applyMsFilter(key) {
  const qEl = document.querySelector(`.q[data-multi="1"][data-qkey="${CSS.escape(key)}"]`);
  if (!qEl) return;
  const needle = (state.ui.msFilter?.[key] ?? "").trim().toLowerCase();
  const items = qEl.querySelectorAll('[data-msitem="1"]');
  let visible = 0;
  items.forEach((el) => {
    const label = el.getAttribute("data-mslabel") || "";
    const show = !needle || label.includes(needle);
    el.style.display = show ? "" : "none";
    if (show) visible++;
  });
  const pill = qEl.querySelector(`[data-mscount="${CSS.escape(key)}"]`);
  if (pill) {
    pill.textContent = `${visible}/${items.length}`;
  }
}
function render() {
  const root = rootEl();
  const date = state.uiDate || todayLocal();
  const dayExport = state.pack ? getDayExportState(state.pack, state.drafts, date) : null;
  syncTopbarDate(date);
  if (state.route.name === "visit") {
    const visitId = state.route.visitId;
    const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
    if (!visit) {
      root.innerHTML = `<div class="card"><h2>Visit nenalezena</h2><button class="btn" data-nav="home">Zp\u011Bt</button></div>`;
      return;
    }
    const draft = ensureDraft(visit);
    const st = storeBySap(visit.sapId);
    const tpl = tplById(visit.templateId);
    root.innerHTML = `
      <div class="card">
        <h2>${esc(st?.name || visit.sapId)}</h2>
        <div class="row">
          <span class="pill">${esc(visit.date)}</span>
          <span class="pill">${esc(tpl?.name || visit.templateId)}</span>
          <span class="pill warn">${esc(draft.status)}</span>
          <span class="spacer"></span>
          <button class="btn ghost" data-nav="home">Zp\u011Bt</button>
          <button class="btn bad" data-cancelvisit="${esc(visit.visitId)}">Zru\u0161it</button>
          <button class="btn ok" data-done="${esc(visit.visitId)}">Dokon\u010Dit</button>
        </div>
        <p class="small">visitId: ${esc(visit.visitId)}</p>
      </div>

      ${renderTemplateForm(tpl, draft)}
    `;
    hydratePhotoThumbs().catch(() => {
    });
    if (state.ui.openMultiKey) {
      requestAnimationFrame(() => applyMsFilter(state.ui.openMultiKey));
    }
    return;
  }
  root.innerHTML = `
    <div class="panel panelBlue" id="jobpackPanel">
      <div class="card">
        <h2>Job Pack</h2>

        <div class="row">
          <span class="pill">Den: ${esc(date)}</span>
          <span class="spacer"></span>
          ${state.pack ? `<span class="pill ok">Pack \u2713</span>` : `<span class="pill bad">Pack: ne</span>`}
        </div>

        ${state.pack ? `
          <div class="row" style="margin-top:10px">
            <span class="pill">merch: ${esc(state.pack.merch?.id)}</span>
            <span class="pill">packId: ${esc(state.pack.packId)}</span>
            <span class="pill">jobpack v${esc(state.pack.schemaVersion)}</span>
            <span class="pill ${dayExport.unresolved.length ? "warn" : "ok"}">
              uzav\u0159eno ${dayExport.scheduled.length - dayExport.unresolved.length}/${dayExport.scheduled.length}
            </span>
          </div>
        ` : ``}

        <div class="hr"></div>

        <div class="row">
          <input id="filePack" class="inp" type="file" accept="application/json" />
        </div>

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnImport">Import</button>
          <button class="btn ok" id="btnExport"
                  ${state.pack && dayExport?.scheduled.length > 0 && dayExport?.unresolved.length === 0 ? "" : "disabled"}
                  title="${state.pack && dayExport?.unresolved.length ? `Zb\xFDv\xE1 uzav\u0159\xEDt ${dayExport.unresolved.length} n\xE1v\u0161t\u011Bv` : "Export denn\xEDho ZIP"}">
            Export denn\xEDho ZIP
          </button>
        </div>

        ${state.pack && dayExport?.unresolved.length ? `
          <div class="small" style="margin-top:10px;color:#b45309;font-weight:800">
            \u{1F512} Export je zam\u010Den\xFD \u2014 dokon\u010Di nebo zru\u0161 je\u0161t\u011B ${dayExport.unresolved.length} ${dayExport.unresolved.length === 1 ? "n\xE1v\u0161t\u011Bvu" : "n\xE1v\u0161t\u011Bv"}.
          </div>
        ` : ``}

        <div class="small" style="margin-top:10px; opacity:.9">
          Tip: Datum vyb\xEDr\xE1\u0161 naho\u0159e p\u0159es \u{1F4C5} v li\u0161t\u011B.
        </div>
      </div>
    </div>

    <div class="panel panelGreen" id="visitsPanel" style="margin-top:14px">
      <div class="card">
        <h2>N\xE1v\u0161t\u011Bvy</h2>
        ${renderVisits(date)}
      </div>
    </div>
  `;
  bindEvents();
}
function renderVisits(date) {
  if (!state.pack) return `<p class="small">Nejd\u0159\xEDv importuj pack.</p>`;
  const visits = (state.pack.visits || []).filter((v) => v.date === date && v.status !== "cancelled").slice().sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")));
  if (!visits.length) return `<p class="small">Na tenhle den nejsou v packu \u017E\xE1dn\xFD visits.</p>`;
  return `
    <div class="list">
      ${visits.map((v) => {
    const st = storeBySap(v.sapId);
    const tpl = tplById(v.templateId);
    const dr = state.drafts.get(v.visitId);
    const label = dr ? dr.status : "planned";
    const cls = label === "done" ? "ok" : label === "cancelled" ? "bad" : "warn";
    return `
          <div class="item">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <div style="font-weight:900">${esc(st?.name || v.sapId)}</div>
              <span class="pill">${esc(v.startTime || "\u2014")}</span>
              <span class="pill">${esc(tpl?.name || v.templateId)}</span>
              <span class="pill ${cls}">${esc(label)}</span>
              <span class="spacer"></span>
              <button class="btn" data-open="${esc(v.visitId)}">${dr ? "Pokra\u010Dovat" : "Za\u010D\xEDt"}</button>
            </div>
            <div class="meta">visitId: ${esc(v.visitId)}</div>
          </div>
        `;
  }).join("")}
    </div>
  `;
}
function renderTemplateForm(tpl, draft) {
  if (!tpl) return `<div class="card"><p class="small">Template chyb\xED.</p></div>`;
  const blocks = tpl.blocks || [];
  return blocks.map((b, idx) => {
    const qs = b.questions || [];
    const blockKey = String(b.id || b.title || `block_${idx}`);
    const collapsed = !!state.ui.collapsedBlocks?.[blockKey];
    const chev = collapsed ? "\u25BC" : "\u25B2";
    const body = qs.filter((q) => isQuestionForPartner(draft, q)).filter((q) => isQuestionActive(draft, q)).map((q) => renderQuestion(q, draft)).join("");
    return `
      <div class="card" data-block="${esc(blockKey)}">
        <div class="row" style="align-items:center;gap:10px">
          <h2 style="margin:0;flex:1">${esc(b.title || b.id || `Block ${idx + 1}`)}</h2>
          <button class="btn ghost" type="button"
                  data-btoggle="${esc(blockKey)}"
                  aria-expanded="${!collapsed}"
                  style="min-width:44px">
            ${chev}
          </button>
        </div>

        <div class="blockBody" style="${collapsed ? "display:none;" : ""}">
          ${body}
        </div>
      </div>
    `;
  }).join("");
}
function checkboxButtons(key, selected) {
  const yesSel = selected === true;
  const noSel = selected === false;
  const yesStyle = yesSel ? `style="outline:3px solid rgba(16,185,129,.55); outline-offset:2px"` : "";
  const noStyle = noSel ? `style="outline:3px solid rgba(244,63,94,.55); outline-offset:2px"` : "";
  return `
    <div class="row">
      <button class="btn ok" data-bool="true" data-qkey="${esc(key)}" aria-pressed="${yesSel}" ${yesStyle}>ANO</button>
      <button class="btn bad" data-bool="false" data-qkey="${esc(key)}" aria-pressed="${noSel}" ${noStyle}>NE</button>
    </div>
  `;
}
function renderMultiSelectQuestion(q, draft) {
  const key = q.key;
  const opts = q.options || [];
  const cur = draft.answers?.[key];
  const selected = Array.isArray(cur) ? cur : [];
  const isOpen = state.ui.openMultiKey === key;
  const arrow = isOpen ? "\u25B2" : "\u25BC";
  const countPill = selected.length ? `<span class="pill ok">${selected.length} vybr\xE1no</span>` : `<span class="pill">0 vybr\xE1no</span>`;
  const summary = selected.length ? `<div class="small" style="margin-top:6px;opacity:.95">${selected.slice(0, 4).map(esc).join(", ")}${selected.length > 4 ? ` +${selected.length - 4}` : ""}</div>` : ``;
  const filterVal = state.ui.msFilter?.[key] ?? "";
  return `
    <div class="q" data-qtype="select" data-qkey="${esc(key)}" data-multi="1">
      <div class="row" style="align-items:center;gap:10px">
        <div style="flex:1;min-width:200px">
          <div class="ql" style="margin:0">${esc(q.label)} ${q.required ? `<span class="req">*</span>` : ""}</div>
          ${q.help ? `<div class="small">${esc(q.help)}</div>` : ""}
          ${summary}
        </div>

        ${countPill}
        <button class="btn ghost" data-mstoggle="${esc(key)}" aria-expanded="${isOpen}" style="min-width:44px" type="button">
          ${arrow}
        </button>
      </div>

      <div class="hr"></div>

      <div class="msBody" style="${isOpen ? "" : "display:none;"}">
        <div class="row" style="gap:10px;margin-bottom:10px">
          <input class="inp"
                 type="text"
                 inputmode="search"
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false"
                 placeholder="Hledat..."
                 value="${esc(filterVal)}"
                 data-mssearch="1"
                 data-qkey="${esc(key)}" />
          <button class="btn orange" data-msclear="${esc(key)}" type="button">Smazat filtr</button>
          <span class="pill" data-mscount="${esc(key)}">\u2014</span>
        </div>

        <div class="row" style="flex-wrap:wrap;gap:10px" data-mslist="${esc(key)}">
          ${opts.map((o) => {
    const isOn = selected.includes(o);
    return `
              <label class="pill ${isOn ? "ok" : ""}"
                     style="cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:8px"
                     data-msitem="1"
                     data-mslabel="${esc(String(o).toLowerCase())}">
                <input type="checkbox"
                       data-msopt="1"
                       data-qkey="${esc(key)}"
                       value="${esc(o)}"
                       ${isOn ? "checked" : ""} />
                <span>${esc(o)}</span>
              </label>
            `;
  }).join("")}
        </div>
      </div>
    </div>
  `;
}
function renderPhotoQuestion(q, draft) {
  const key = q.key;
  const cfg = q.photo || {};
  const min = Number.isFinite(cfg.photosMin) ? cfg.photosMin : 1;
  const max = Number.isFinite(cfg.photosMax) ? cfg.photosMax : 10;
  const cur = draft.answers?.[key];
  const ids = cur && typeof cur === "object" && Array.isArray(cur.photoIds) ? cur.photoIds : [];
  return `
    <div class="q" data-qtype="photo" data-qkey="${esc(key)}" data-min="${esc(min)}" data-max="${esc(max)}">
      <div class="ql">${esc(q.label)} ${q.required ? `<span class="req">*</span>` : ""}</div>
      ${q.help ? `<div class="small">${esc(q.help)}</div>` : ""}

      <div class="hr"></div>

      <div class="row">
        <input class="inp" type="file" accept="image/*" multiple data-phinp="${esc(key)}" />
        <button class="btn" data-phadd="${esc(key)}" type="button">P\u0159idat fotky</button>
        <span class="pill">fotky: ${ids.length} / ${max}</span>
        <span class="pill">${min}-${max}</span>
      </div>

      <div class="photoGrid">
        ${ids.map((pid) => `
          <div class="ph" data-phid="${esc(pid)}">
            <img alt="${esc(pid)}" src="" />
            <button class="btn ghost" data-phrm="${esc(pid)}" data-qkey="${esc(key)}" type="button">\u2715</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
function renderFurnitureTrigger(q, draft) {
  const key = q.key;
  const gate = typeof draft.answers?.[key] === "string" ? draft.answers[key] : "";
  const tr = q.trigger || {};
  const whenValue = tr.whenValue || "ANO";
  const show = gate === whenValue;
  const allowMultiple = !!tr.form?.allowMultiple;
  const requireDescription = !!tr.form?.requireDescription;
  const photosMin = Number.isFinite(tr.form?.photosMin) ? tr.form.photosMin : 1;
  const photosMax = Number.isFinite(tr.form?.photosMax) ? tr.form.photosMax : 10;
  const obs = Array.isArray(draft.furnitureObservations) ? draft.furnitureObservations : [];
  const canAddObs = allowMultiple ? true : obs.length < 1;
  return `
    <div class="q" data-qtype="furniture_trigger" data-qkey="${esc(key)}">
      <div class="ql">${esc(q.label)} ${q.required ? `<span class="req">*</span>` : ""}</div>
      ${q.help ? `<div class="small">${esc(q.help)}</div>` : ""}

      <div class="hr"></div>

      <label>Odpov\u011B\u010F</label>
      <select class="inp" data-gate="1" data-qkey="${esc(key)}">
        <option value="">\u2014</option>
        ${(tr.gateOptions || ["NE", "ANO"]).map((o) => `<option value="${esc(o)}" ${o === gate ? "selected" : ""}>${esc(o)}</option>`).join("")}
      </select>

      ${show ? `
        <div class="hr"></div>
        <div class="row">
          <span class="pill warn">Eviduj atypick\xFD n\xE1bytek</span>
          <span class="pill">${photosMin}-${photosMax} fotek</span>
          ${requireDescription ? `<span class="pill bad">popis povinn\xFD</span>` : `<span class="pill">popis voliteln\xFD</span>`}
          <span class="spacer"></span>
          <button class="btn ok" data-addobs="${esc(key)}" ${canAddObs ? "" : "disabled"} type="button">P\u0159idat z\xE1znam</button>
        </div>

        <div class="list">
          ${obs.map((o) => renderFurnitureObs(o, { allowMultiple, requireDescription, photosMin, photosMax })).join("")}
        </div>
      ` : ``}
    </div>
  `;
}
function renderFurnitureObs(o, rules) {
  const qty = Number.isFinite(Number(o.quantity)) ? Number(o.quantity) : 1;
  const photosCount = (o.photoIds || []).length;
  return `
    <div class="item">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="font-weight:900">ATYP</div>
        <span class="pill">qty: ${esc(qty)}</span>
        <span class="pill">fotky: ${esc(photosCount)}</span>
        <span class="pill">${esc(rules.photosMin)}-${esc(rules.photosMax)}</span>
        <span class="spacer"></span>
        <button class="btn ghost" data-delobs="${esc(o.id)}" type="button">Smazat</button>
      </div>

      <label>N\xE1zev (atypLabel)</label>
      <input class="inp" data-obsfield="atypLabel" data-obsid="${esc(o.id)}" value="${esc(o.atypLabel || "")}" />

      <label>Popis ${rules.requireDescription ? `<span class="req">*</span>` : ""}</label>
      <textarea data-obsfield="description" data-obsid="${esc(o.id)}">${esc(o.description || "")}</textarea>

      ${rules.allowMultiple ? `
        <label>Mno\u017Estv\xED <span class="req">*</span></label>
        <input class="inp" type="number" min="1" data-obsfield="quantity" data-obsid="${esc(o.id)}" value="${esc(String(qty))}" />
      ` : ``}

      <div class="hr"></div>
      <div class="row">
        <input class="inp" type="file" accept="image/*" multiple data-obsphinp="${esc(o.id)}"/>
        <button class="btn" data-obsphadd="${esc(o.id)}" type="button">P\u0159idat fotky</button>
      </div>

      <div class="photoGrid">
        ${(o.photoIds || []).map((pid) => `
          <div class="ph" data-phid="${esc(pid)}">
            <img alt="${esc(pid)}" src="" />
            <button class="btn ghost" data-obsphrm="${esc(pid)}" data-obsid="${esc(o.id)}" type="button">\u2715</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
function renderQuestion(q, draft) {
  const key = q.key;
  const val = draft.answers?.[key];
  const req = q.required ? `<span class="req">*</span>` : "";
  const help = q.help ? `<div class="small">${esc(q.help)}</div>` : "";
  if (q.type === "checkbox") {
    const selected = val === true ? true : val === false ? false : null;
    return `
      <div class="q" data-qtype="checkbox" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        ${checkboxButtons(key, selected)}
      </div>
    `;
  }
  if (q.type === "text") {
    return `
      <div class="q" data-qtype="text" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <textarea>${esc(typeof val === "string" ? val : "")}</textarea>
      </div>
    `;
  }
  if (q.type === "number") {
    const num = typeof val === "number" && Number.isFinite(val) ? val : 0;
    const isCounter = q.counter === true || q.stepper === true;
    if (isCounter) {
      return `
        <div class="q" data-qtype="number" data-qkey="${esc(key)}" data-counter="1">
          <div class="ql">${esc(q.label)} ${req}</div>
          ${help}
          <div class="row" style="gap:10px;flex-wrap:nowrap">
            <button class="btn ghost" type="button" data-stepminus="${esc(key)}" aria-label="Sn\xED\u017Eit">\u2212</button>
            <input class="inp" type="number" value="${esc(String(num))}" style="text-align:center" />
            <button class="btn ghost" type="button" data-stepplus="${esc(key)}" aria-label="Zv\xFD\u0161it">+</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="q" data-qtype="number" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <input class="inp" type="number" value="${esc(typeof val === "number" ? String(val) : "")}"/>
      </div>
    `;
  }
  if (q.type === "select") {
    if (q.multi === true) return renderMultiSelectQuestion(q, draft);
    const opts = q.options || [];
    const v = typeof val === "string" ? val : "";
    return `
      <div class="q" data-qtype="select" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <select class="inp">
          <option value="">\u2014</option>
          ${opts.map((o) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (q.type === "photo") return renderPhotoQuestion(q, draft);
  if (q.type === "furniture_trigger") return renderFurnitureTrigger(q, draft);
  return `
    <div class="q">
      <div class="ql">${esc(q.label)} <span class="pill">type: ${esc(q.type)}</span></div>
      <div class="small">Tenhle typ zat\xEDm UI nepodporuje.</div>
    </div>
  `;
}
async function hydratePhotoThumbs() {
  const imgNodes = document.querySelectorAll(".ph[data-phid] img");
  for (const img of imgNodes) {
    const holder = img.closest(".ph");
    const pid = holder?.getAttribute("data-phid");
    if (!pid) continue;
    const rec = await getPhotoRec(pid);
    if (rec?.blob) {
      img.src = URL.createObjectURL(rec.blob);
    }
  }
}
function validateDraftBeforeDone(draft) {
  const tpl = tplById(draft.templateId);
  if (!tpl) return ["Chyb\xED template v packu (fail-fast)."];
  const errors = [];
  const qs = collectQuestions(tpl);
  for (const q of qs) {
    if (!isQuestionForPartner(draft, q)) continue;
    if (!isQuestionActive(draft, q)) continue;
    const key = q.key;
    const v = draft.answers?.[key];
    if (q.type === "checkbox") {
      if (q.required && v !== true && v !== false) errors.push(`Chyb\xED odpov\u011B\u010F ANO/NE: ${q.label}`);
      continue;
    }
    if (q.type === "text") {
      if (q.required && (typeof v !== "string" || v.trim() === "")) errors.push(`Chyb\xED text: ${q.label}`);
      continue;
    }
    if (q.type === "number") {
      const isNum = typeof v === "number" && Number.isFinite(v);
      if (q.required && !isNum) errors.push(`Chyb\xED \u010D\xEDslo: ${q.label}`);
      continue;
    }
    if (q.type === "select") {
      if (q.multi === true) {
        const arr = Array.isArray(v) ? v : [];
        if (q.required && arr.length === 0) errors.push(`Chyb\xED v\xFDb\u011Br (multi): ${q.label}`);
      } else {
        if (q.required && (typeof v !== "string" || v.trim() === "")) errors.push(`Chyb\xED v\xFDb\u011Br: ${q.label}`);
      }
      continue;
    }
    if (q.type === "photo") {
      const cfg = q.photo || {};
      const min = Number.isFinite(cfg.photosMin) ? cfg.photosMin : 1;
      const max = Number.isFinite(cfg.photosMax) ? cfg.photosMax : 10;
      const ids = v && typeof v === "object" && Array.isArray(v.photoIds) ? v.photoIds : [];
      if (q.required && ids.length < min) errors.push(`Chyb\xED fotky (min ${min}): ${q.label}`);
      if (ids.length > max) errors.push(`Moc fotek (max ${max}): ${q.label}`);
      continue;
    }
    if (q.type === "furniture_trigger") {
      if (q.required && (typeof v !== "string" || v.trim() === "")) errors.push(`Chyb\xED odpov\u011B\u010F (NE/ANO): ${q.label}`);
      const tr = q.trigger || {};
      const when = tr.whenValue || "ANO";
      if (v === when) {
        const obs = Array.isArray(draft.furnitureObservations) ? draft.furnitureObservations : [];
        if (!obs.length) errors.push(`Mus\xED\u0161 p\u0159idat aspo\u0148 1 z\xE1znam atyp n\xE1bytku: ${q.label}`);
        const requireDescription = !!tr.form?.requireDescription;
        const allowMultiple = !!tr.form?.allowMultiple;
        const photosMin = Number.isFinite(tr.form?.photosMin) ? tr.form.photosMin : 1;
        const photosMax = Number.isFinite(tr.form?.photosMax) ? tr.form.photosMax : 10;
        for (const o of obs) {
          const pcount = (o.photoIds || []).length;
          if (pcount < photosMin) errors.push(`ATYP: chyb\xED fotky (min ${photosMin}).`);
          if (pcount > photosMax) errors.push(`ATYP: moc fotek (max ${photosMax}).`);
          if (requireDescription) {
            const has = o.description && o.description.trim() || o.atypLabel && o.atypLabel.trim();
            if (!has) errors.push(`ATYP: chyb\xED popis nebo n\xE1zev.`);
          }
          if (allowMultiple) {
            const qty = Number(o.quantity);
            if (!Number.isFinite(qty) || qty < 1) errors.push(`ATYP: mno\u017Estv\xED mus\xED b\xFDt >= 1.`);
          }
        }
      }
      continue;
    }
  }
  return errors;
}
async function exportDayZip(date) {
  if (!state.pack) {
    toast("Nejd\u0159\xEDv importuj pack.");
    return;
  }
  if (typeof window.JSZip !== "function") {
    toast("JSZip nen\xED dostupn\xFD.");
    return;
  }
  const merchId = state.pack.merch?.id || "unknown";
  const dayExport = getDayExportState(state.pack, state.drafts, date);
  if (!dayExport.scheduled.length) {
    toast("Na tenhle den nejsou napl\xE1novan\xE9 \u017E\xE1dn\xE9 n\xE1v\u0161t\u011Bvy.");
    return;
  }
  if (dayExport.unresolved.length) {
    const stores = dayExport.unresolved.slice(0, 5).map((visit) => storeBySap(visit.sapId)?.name || visit.sapId);
    const more = dayExport.unresolved.length > stores.length ? ` a dal\u0161\xEDch ${dayExport.unresolved.length - stores.length}` : "";
    toast(`Export zablokov\xE1n. Nejd\u0159\xEDv dokon\u010Di nebo zru\u0161 v\u0161ech ${dayExport.unresolved.length} rozpracovan\xFDch n\xE1v\u0161t\u011Bv: ${stores.join(", ")}${more}.`);
    return;
  }
  const drafts = dayExport.resolvedDrafts;
  const exportAnswers = /* @__PURE__ */ new Map();
  for (const draft of drafts) {
    const template = tplById(draft.templateId);
    if (!template) {
      toast(`Export zablokov\xE1n: chyb\xED checklist ${draft.templateId}.`);
      return;
    }
    const store = storeBySap(draft.sapId);
    draft.retailerId = store?.retailerId || draft.retailerId || "";
    pruneHiddenAnswers(template, draft, state.pack.schemaVersion || 1);
    exportAnswers.set(draft.visitId, visibleAnswers(template, draft, state.pack.schemaVersion || 1));
    await saveDraft(draft);
  }
  const exportId = uuid();
  const createdAt = nowISO();
  const photoSet = /* @__PURE__ */ new Set();
  for (const d of drafts) {
    for (const vv of Object.values(exportAnswers.get(d.visitId) || {})) {
      if (vv && typeof vv === "object" && Array.isArray(vv.photoIds)) vv.photoIds.forEach((pid) => photoSet.add(pid));
    }
    for (const o of d.furnitureObservations || []) {
      (o.photoIds || []).forEach((pid) => photoSet.add(pid));
    }
  }
  const zip = new window.JSZip();
  const photosFolder = zip.folder("photos");
  const photosMeta = [];
  for (const pid of [...photoSet]) {
    const rec = await getPhotoRec(pid);
    const mime = rec?.mime || "image/jpeg";
    const ext = extFromMime(mime);
    const fileName = `photos/${pid}.${ext}`;
    photosMeta.push({ photoId: pid, fileName, mime, takenAt: rec?.takenAt || null });
    if (rec?.blob) {
      photosFolder.file(`${pid}.${ext}`, await rec.blob.arrayBuffer());
    }
  }
  const manifest = {
    schema: RESULTS_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    exportId,
    deviceId: state.deviceId,
    merchId,
    date,
    createdAt,
    packRef: { packId: state.pack.packId, checksum: state.pack.checksum?.value || null },
    photos: photosMeta,
    visits: drafts.map((d) => ({
      visitId: d.visitId,
      sapId: d.sapId,
      date: d.date,
      startedAt: d.startedAt,
      submittedAt: d.submittedAt,
      status: d.status === "cancelled" ? "cancelled" : "done",
      cancelReason: d.status === "cancelled" ? d.cancelReason || "" : void 0,
      templateId: d.templateId,
      templateVersion: d.templateVersion,
      answers: exportAnswers.get(d.visitId) || {},
      furnitureObservations: (d.furnitureObservations || []).map((o) => ({
        id: o.id,
        typeId: "ATYP",
        atypLabel: o.atypLabel || "",
        description: o.description || "",
        quantity: o.quantity ?? 1,
        photoIds: o.photoIds || [],
        classifiedTypeId: null
      }))
    }))
  };
  const finalCheck = getDayExportState(state.pack, state.drafts, date);
  if (finalCheck.unresolved.length || finalCheck.scheduled.length !== drafts.length) {
    toast("Export zablokov\xE1n: stav n\xE1v\u0161t\u011Bv se zm\u011Bnil. Zkontroluj, \u017Ee jsou v\u0161echny dokon\u010Den\xE9 nebo zru\u0161en\xE9.");
    return;
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `results_${date}_${merchId}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
  toast("Export hotovej.");
}
function bindEvents() {
  document.onclick = async (e) => {
    const t = e.target;
    const calLabel = t.closest("label.iconBtn");
    if (calLabel && calLabel.querySelector("#dayPicker")) {
      const dp = calLabel.querySelector("#dayPicker");
      if (typeof dp.showPicker === "function") dp.showPicker();
      else {
        dp.focus();
        dp.click();
      }
      return;
    }
    const bToggle = t.closest("[data-btoggle]");
    if (bToggle) {
      const blockKey = bToggle.getAttribute("data-btoggle");
      if (!blockKey) return;
      state.ui.collapsedBlocks = state.ui.collapsedBlocks || {};
      state.ui.collapsedBlocks[blockKey] = !state.ui.collapsedBlocks[blockKey];
      render();
      return;
    }
    const nav = t.closest("[data-nav]");
    if (nav) {
      state.route = { name: "home", visitId: null };
      state.ui.openMultiKey = null;
      render();
      return;
    }
    const msToggle = t.closest("[data-mstoggle]");
    if (msToggle) {
      const key = msToggle.getAttribute("data-mstoggle");
      state.ui.openMultiKey = state.ui.openMultiKey === key ? null : key;
      render();
      requestAnimationFrame(() => {
        if (state.ui.openMultiKey) {
          applyMsFilter(key);
          const inp = document.querySelector(`input[data-mssearch="1"][data-qkey="${CSS.escape(key)}"]`);
          inp?.focus();
          try {
            inp?.setSelectionRange(inp.value.length, inp.value.length);
          } catch {
          }
        }
      });
      return;
    }
    const msClear = t.closest("[data-msclear]");
    if (msClear) {
      const key = msClear.getAttribute("data-msclear");
      if (!key) return;
      state.ui.msFilter[key] = "";
      const qEl = document.querySelector(`.q[data-multi="1"][data-qkey="${CSS.escape(key)}"]`);
      const inp = qEl?.querySelector(`input[data-mssearch="1"][data-qkey="${CSS.escape(key)}"]`);
      if (inp) inp.value = "";
      applyMsFilter(key);
      inp?.focus();
      return;
    }
    if (t.id === "btnImport") {
      const f = $("#filePack")?.files?.[0];
      if (!f) {
        toast("Vyber soubor jobpacku.");
        return;
      }
      const txt = await f.text();
      let pack;
      try {
        pack = JSON.parse(txt);
      } catch {
        toast("Tohle nen\xED validn\xED JSON.");
        return;
      }
      const errs = validateJobPack(pack);
      if (errs.length) {
        console.error(errs);
        toast("Pack odm\xEDtnut: " + errs[0]);
        return;
      }
      await IDB.set(IDB.STORES.pack, "current", pack);
      state.pack = pack;
      toast("Pack importov\xE1n.");
      render();
      return;
    }
    if (t.id === "btnExport") {
      const d = $("#dayPicker")?.value || state.uiDate || todayLocal();
      await exportDayZip(d);
      return;
    }
    const open = t.closest("[data-open]");
    if (open) {
      const visitId = open.getAttribute("data-open");
      state.route = { name: "visit", visitId };
      state.ui.openMultiKey = null;
      render();
      return;
    }
    const boolBtn = t.closest("[data-bool]");
    if (boolBtn) {
      const key = boolBtn.getAttribute("data-qkey");
      const val = boolBtn.getAttribute("data-bool") === "true";
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit || !key) return;
      const d = ensureDraft(visit);
      setDraftAnswer(d, key, val);
      await saveDraft(d);
      render();
      return;
    }
    const stepMinus = t.closest("[data-stepminus]");
    if (stepMinus) {
      const key = stepMinus.getAttribute("data-stepminus");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit || !key) return;
      const d = ensureDraft(visit);
      const cur = toFiniteNumberOrNull(d.answers?.[key]);
      const safeCur = Number.isFinite(cur) ? cur : 0;
      setDraftAnswer(d, key, Math.max(0, safeCur - 1));
      await saveDraft(d);
      render();
      return;
    }
    const stepPlus = t.closest("[data-stepplus]");
    if (stepPlus) {
      const key = stepPlus.getAttribute("data-stepplus");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit || !key) return;
      const d = ensureDraft(visit);
      const cur = toFiniteNumberOrNull(d.answers?.[key]);
      const safeCur = Number.isFinite(cur) ? cur : 0;
      setDraftAnswer(d, key, safeCur + 1);
      await saveDraft(d);
      render();
      return;
    }
    const phAdd = t.closest("[data-phadd]");
    if (phAdd) {
      const key = phAdd.getAttribute("data-phadd");
      const inp = document.querySelector(`input[data-phinp="${CSS.escape(key)}"]`);
      const files = inp?.files ? [...inp.files] : [];
      if (!files.length) {
        toast("Vyber fotky (galerie nebo kamera).");
        return;
      }
      const qEl = t.closest('.q[data-qtype="photo"]');
      const max = Number(qEl?.getAttribute("data-max") || "10");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);
      const cur = d.answers[key];
      const ids = cur && typeof cur === "object" && Array.isArray(cur.photoIds) ? cur.photoIds : [];
      if (ids.length >= max) {
        toast(`U\u017E m\xE1\u0161 max ${max} fotek.`);
        return;
      }
      const remaining = Math.max(0, max - ids.length);
      const toAdd = files.slice(0, remaining);
      const newIds = await addPhotosToDB(toAdd, visitId);
      setDraftAnswer(d, key, { photoIds: [...ids, ...newIds] });
      await saveDraft(d);
      render();
      return;
    }
    const phRm = t.closest("[data-phrm]");
    if (phRm) {
      const pid = phRm.getAttribute("data-phrm");
      const key = phRm.getAttribute("data-qkey");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);
      const cur = d.answers[key];
      const ids = cur && typeof cur === "object" && Array.isArray(cur.photoIds) ? cur.photoIds : [];
      setDraftAnswer(d, key, { photoIds: ids.filter((x) => x !== pid) });
      await saveDraft(d);
      render();
      return;
    }
    const addObs = t.closest("[data-addobs]");
    if (addObs) {
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);
      d.furnitureObservations = d.furnitureObservations || [];
      d.furnitureObservations.push({
        id: uuid(),
        typeId: "ATYP",
        atypLabel: "",
        description: "",
        quantity: 1,
        photoIds: [],
        classifiedTypeId: null
      });
      await saveDraft(d);
      render();
      return;
    }
    const delObs = t.closest("[data-delobs]");
    if (delObs) {
      const obsId = delObs.getAttribute("data-delobs");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);
      d.furnitureObservations = (d.furnitureObservations || []).filter((o) => o.id !== obsId);
      await saveDraft(d);
      render();
      return;
    }
    const obsPhAdd = t.closest("[data-obsphadd]");
    if (obsPhAdd) {
      const obsId = obsPhAdd.getAttribute("data-obsphadd");
      const inp = document.querySelector(`input[data-obsphinp="${CSS.escape(obsId)}"]`);
      const files = inp?.files ? [...inp.files] : [];
      if (!files.length) {
        toast("Vyber fotky k atypu.");
        return;
      }
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);
      const obs = (d.furnitureObservations || []).find((o) => o.id === obsId);
      if (!obs) {
        toast("Z\xE1znam atypu nenalezen.");
        return;
      }
      const newIds = await addPhotosToDB(files, visitId);
      obs.photoIds = [...obs.photoIds || [], ...newIds];
      if (inp) inp.value = "";
      await saveDraft(d);
      render();
      return;
    }
    const obsPhRm = t.closest("[data-obsphrm]");
    if (obsPhRm) {
      const pid = obsPhRm.getAttribute("data-obsphrm");
      const obsId = obsPhRm.getAttribute("data-obsid");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);
      const obs = (d.furnitureObservations || []).find((o) => o.id === obsId);
      if (!obs) return;
      obs.photoIds = (obs.photoIds || []).filter((x) => x !== pid);
      await saveDraft(d);
      render();
      return;
    }
    const doneBtn = t.closest("[data-done]");
    if (doneBtn) {
      const visitId = doneBtn.getAttribute("data-done");
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) {
        toast("Visit nenalezena.");
        return;
      }
      const d = ensureDraft(visit);
      const errs = validateDraftBeforeDone(d);
      if (errs.length) {
        toast(errs[0]);
        return;
      }
      d.status = "done";
      d.submittedAt = nowISO();
      await saveDraft(d);
      state.route = { name: "home", visitId: null };
      state.ui.openMultiKey = null;
      render();
      return;
    }
    const cancelBtn = t.closest("[data-cancelvisit]");
    if (cancelBtn) {
      const visitId = cancelBtn.getAttribute("data-cancelvisit");
      const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
      if (!visit) {
        toast("Visit nenalezena.");
        return;
      }
      const d = ensureDraft(visit);
      d.status = "cancelled";
      d.submittedAt = nowISO();
      d.cancelReason = "cancelled_by_user";
      await saveDraft(d);
      state.route = { name: "home", visitId: null };
      state.ui.openMultiKey = null;
      render();
      return;
    }
  };
  document.onchange = async (e) => {
    const t = e.target;
    if (t.id === "dayPicker") {
      state.uiDate = t.value || todayLocal();
      render();
      return;
    }
    if (t.matches('input[data-msopt="1"]')) {
      const key2 = t.getAttribute("data-qkey");
      const opt = t.value;
      const checked = t.checked;
      const visitId2 = state.route.visitId;
      const visit2 = (state.pack?.visits || []).find((v) => v.visitId === visitId2);
      if (!visit2 || !key2) return;
      const d2 = ensureDraft(visit2);
      const cur = d2.answers?.[key2];
      const arr = Array.isArray(cur) ? [...cur] : [];
      const next = checked ? Array.from(/* @__PURE__ */ new Set([...arr, opt])) : arr.filter((x) => x !== opt);
      setDraftAnswer(d2, key2, next);
      await saveDraft(d2);
      render();
      return;
    }
    if (t.matches('select[data-gate="1"]')) {
      const key2 = t.getAttribute("data-qkey");
      const visitId2 = state.route.visitId;
      const visit2 = (state.pack?.visits || []).find((v) => v.visitId === visitId2);
      if (!visit2 || !key2) return;
      const d2 = ensureDraft(visit2);
      setDraftAnswer(d2, key2, t.value || null);
      await saveDraft(d2);
      render();
      return;
    }
    const q = t.closest(".q");
    if (!q) return;
    const key = q.getAttribute("data-qkey");
    const type = q.getAttribute("data-qtype");
    const visitId = state.route.visitId;
    const visit = (state.pack?.visits || []).find((v) => v.visitId === visitId);
    if (!visit || !key) return;
    const d = ensureDraft(visit);
    if (type === "text") {
      setDraftAnswer(d, key, t.value ?? null);
      await saveDraft(d);
      return;
    }
    if (type === "number") {
      setDraftAnswer(d, key, toFiniteNumberOrNull(t.value));
      await saveDraft(d);
      render();
      return;
    }
    if (type === "select") {
      if (q.getAttribute("data-multi") === "1") return;
      setDraftAnswer(d, key, t.value || null);
      await saveDraft(d);
      render();
      return;
    }
    if (t.matches("[data-obsfield]")) {
      const obsId = t.getAttribute("data-obsid");
      const field = t.getAttribute("data-obsfield");
      const obs = (d.furnitureObservations || []).find((o) => o.id === obsId);
      if (!obs) return;
      if (field === "quantity") {
        const n = Number(t.value);
        obs.quantity = Number.isFinite(n) && n >= 1 ? n : 1;
      } else {
        obs[field] = t.value ?? "";
      }
      await saveDraft(d);
      return;
    }
  };
  document.oninput = (e) => {
    const t = e.target;
    if (!t) return;
    if (t.matches('input[data-mssearch="1"]')) {
      const key = t.getAttribute("data-qkey");
      if (!key) return;
      state.ui.msFilter[key] = t.value ?? "";
      applyMsFilter(key);
      return;
    }
  };
}
async function boot() {
  state.uiDate = todayLocal();
  await loadDeviceId();
  await loadPack();
  await loadDrafts();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then((registration) => {
      registration.update().catch(() => {
      });
      const appVer = document.querySelector("#appVer");
      if (appVer) appVer.textContent = `App: ${APP_VERSION}`;
      updateSWBadge().catch(() => {
      });
    }).catch(() => {
      const swVer = document.querySelector("#swVer");
      if (swVer) swVer.textContent = "SW: off";
    });
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      setTimeout(() => updateSWBadge().catch(() => {
      }), 300);
    });
  }
  await updateSWBadge().catch(() => {
  });
  render();
  bindEvents();
}
boot().catch((error) => {
  console.error("[mobile] Kritick\xE1 chyba p\u0159i startu aplikace:", error);
  const root = rootEl();
  root.innerHTML = `
    <div class="card">
      <h2>Aplikaci se nepoda\u0159ilo spustit</h2>
      <p class="small">Na\u010D\xEDt\xE1n\xED skon\u010Dilo chybou. Obnov str\xE1nku; pokud probl\xE9m z\u016Fstane, zkontroluj, \u017Ee je nasazen\xE1 verze ${esc(APP_VERSION)}.</p>
      <pre style="white-space:pre-wrap;word-break:break-word">${esc(error?.message || error || "Nezn\xE1m\xE1 chyba")}</pre>
      <button class="btn primary" type="button" onclick="location.reload()">Obnovit aplikaci</button>
    </div>
  `;
});
