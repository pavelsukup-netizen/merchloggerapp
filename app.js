import { IDB } from "./idb.js";

const JOBPACK_SCHEMA = "merch.jobpack";
const RESULTS_SCHEMA = "merch.results";
const SCHEMA_VERSION = 1;

const state = {
  pack: null,
  deviceId: null,
  uiDate: null,
  drafts: new Map(),   // visitId -> draft
  route: { name: "home", visitId: null }
};

function $(sel){ return document.querySelector(sel); }
function rootEl(){
  return document.querySelector("#main") || document.querySelector("#app") || document.body;
}
function nowISO(){ return new Date().toISOString(); }
function pad2(n){ return String(n).padStart(2, "0"); }
function todayLocal(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function uuid(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0;
    const v = c === "x" ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[m]);
}
function toast(msg){
  console.log("[mobile]", msg);
  alert(msg);
}

/* ----------------- jobpack validation ----------------- */
function validateJobPack(pack){
  const errors = [];
  if (!pack || pack.schema !== JOBPACK_SCHEMA || pack.schemaVersion !== 1){
    errors.push(`schema/schemaVersion nesedí (čekám ${JOBPACK_SCHEMA} v1)`);
    return errors;
  }
  if (!pack.packId) errors.push("Chybí packId");
  if (!pack.createdAt) errors.push("Chybí createdAt");
  if (!pack.merch?.id) errors.push("Chybí merch.id");
  if (!Array.isArray(pack.stores) || !pack.stores.length) errors.push("Chybí stores[]");
  if (!Array.isArray(pack.templates) || !pack.templates.length) errors.push("Chybí templates[]");
  if (!Array.isArray(pack.visits) || !pack.visits.length) errors.push("Chybí visits[]");

  const storeSet = new Set((pack.stores||[]).map(s => s.sapId));
  const tplSet = new Set((pack.templates||[]).map(t => t.templateId));

  for (const v of (pack.visits||[])){
    if (!v.visitId) errors.push("Visit bez visitId");
    if (!v.sapId) errors.push(`Visit ${v.visitId||"(no id)"} bez sapId`);
    if (!v.templateId) errors.push(`Visit ${v.visitId||"(no id)"} bez templateId`);
    if (!v.date) errors.push(`Visit ${v.visitId||"(no id)"} bez date`);
    if (v.sapId && !storeSet.has(v.sapId)) errors.push(`Visit ${v.visitId} odkazuje na neznámý store sapId: ${v.sapId}`);
    if (v.templateId && !tplSet.has(v.templateId)) errors.push(`Visit ${v.visitId} odkazuje na neznámý templateId: ${v.templateId}`);
  }

  for (const t of (pack.templates||[])){
    const keys = new Set();
    const dups = new Set();
    for (const b of (t.blocks||[])){
      for (const q of (b.questions||[])){
        if (!q.key) errors.push(`Template ${t.templateId}: otázka bez key`);
        if (q.key){
          if (keys.has(q.key)) dups.add(q.key);
          keys.add(q.key);
        }
      }
    }
    if (dups.size) errors.push(`Template ${t.templateId}: duplicitní question.key: ${[...dups].join(", ")}`);
  }

  return errors;
}

/* ----------------- persistence ----------------- */
async function loadDeviceId(){
  let did = await IDB.get(IDB.STORES.meta, "deviceId");
  if (!did){
    did = `DEV-${uuid()}`;
    await IDB.set(IDB.STORES.meta, "deviceId", did);
  }
  state.deviceId = did;
}
async function loadPack(){
  state.pack = await IDB.get(IDB.STORES.pack, "current");
}
async function loadDrafts(){
  const keys = await IDB.keys(IDB.STORES.drafts);
  state.drafts = new Map();
  for (const k of keys){
    const d = await IDB.get(IDB.STORES.drafts, k);
    if (d) state.drafts.set(k, d);
  }
}

function storeBySap(sapId){
  return (state.pack?.stores || []).find(s => s.sapId === sapId) || null;
}
function tplById(tid){
  return (state.pack?.templates || []).find(t => t.templateId === tid) || null;
}

function ensureDraft(visit){
  const existing = state.drafts.get(visit.visitId);
  if (existing) return existing;

  const st = storeBySap(visit.sapId);
  const tpl = tplById(visit.templateId);

  const d = {
    schemaVersion: 1,
    visitId: visit.visitId,
    sapId: visit.sapId,
    date: visit.date,
    templateId: visit.templateId,
    templateVersion: tpl?.version ?? 1,
    startedAt: nowISO(),
    submittedAt: null,
    status: "open", // open|done|cancelled
    cancelReason: "",
    answers: {},
    furnitureObservations: []
  };

  d.storeName = st?.name || "";
  d.retailerId = st?.retailerId || "";

  state.drafts.set(visit.visitId, d);
  return d;
}

async function saveDraft(d){
  await IDB.set(IDB.STORES.drafts, d.visitId, d);
  state.drafts.set(d.visitId, d);
}

/* ----------------- photos ----------------- */
const PHOTO_COMPRESS = {
  enabled: true,
  maxSide: 1600,
  quality: 0.75,
  mime: "image/jpeg"
};

async function compressImageFile(file, opts = PHOTO_COMPRESS){
  if (!opts.enabled) return { blob: file, mime: file.type || "image/jpeg" };
  if (!file.type || !file.type.startsWith("image/")) {
    return { blob: file, mime: file.type || "application/octet-stream" };
  }

  let bitmap = null;
  try { bitmap = await createImageBitmap(file); } catch { bitmap = null; }

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

  const canvas = (typeof OffscreenCanvas !== "undefined")
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, w, h);

  const mime = opts.mime || "image/jpeg";
  const quality = (typeof opts.quality === "number") ? opts.quality : 0.75;

  let outBlob;
  if (canvas.convertToBlob) {
    outBlob = await canvas.convertToBlob({ type: mime, quality });
  } else {
    outBlob = await new Promise(res => canvas.toBlob(res, mime, quality));
  }

  if (!outBlob) return { blob: file, mime: file.type || "image/jpeg" };
  return { blob: outBlob, mime };
}

async function addPhotosToDB(files, visitId){
  const photoIds = [];
  for (const f of files){
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

async function getPhotoRec(photoId){
  return await IDB.get(IDB.STORES.photos, photoId);
}

function extFromMime(mime){
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  return "jpg";
}

/* ----------------- template traversal ----------------- */
function collectQuestions(tpl){
  const out = [];
  for (const b of (tpl.blocks||[])){
    for (const q of (b.questions||[])) out.push(q);
  }
  return out;
}
function getAnswerValue(draft, key){
  return (draft?.answers || {})[key];
}

function normalizeCond(cond){
  let op = cond?.op;
  let value = cond?.value;

  if (!op && cond && cond.equals !== undefined) { op = "eq"; value = cond.equals; }
  if (!op && cond && cond.notEquals !== undefined) { op = "neq"; value = cond.notEquals; }

  if (value === "ANO") value = true;
  if (value === "NE") value = false;

  return { ...cond, op, value };
}

function evalCond(draft, condRaw){
  const cond = normalizeCond(condRaw || {});
  const v = getAnswerValue(draft, cond.key);

  switch (cond.op) {
    case "eq":  return v === cond.value;
    case "neq": return v !== cond.value;
    case "in":  return Array.isArray(cond.value) ? cond.value.includes(v) : false;
    case "truthy":
      if (typeof v === "boolean") return v === true;
      if (typeof v === "string") return v.trim().length > 0;
      if (v && typeof v === "object" && Array.isArray(v.photoIds)) return v.photoIds.length > 0;
      return !!v;
    case "falsy":
      if (typeof v === "boolean") return v === false;
      if (typeof v === "string") return v.trim().length === 0;
      if (v && typeof v === "object" && Array.isArray(v.photoIds)) return v.photoIds.length === 0;
      return !v;
    default:
      return true;
  }
}

function isQuestionActive(draft, q){
  const d = q?.dependsOn;
  if (!d) return true;
  if (d.key) return evalCond(draft, d);
  if (Array.isArray(d.all)) return d.all.every(c => evalCond(draft, c));
  if (Array.isArray(d.any)) return d.any.some(c => evalCond(draft, c));
  return true;
}

/* ----------------- SW version badge ----------------- */
async function updateSWBadge(){
  const el = $("#swVer");
  if (!el) return;

  if (!("serviceWorker" in navigator)){
    el.textContent = "SW: —";
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  const sw = reg?.active || reg?.waiting || reg?.installing;
  if (!sw){
    el.textContent = "SW: —";
    return;
  }

  // zkus získat verzi přes message (nejspolehlivější)
  const version = await new Promise((res) => {
    let done = false;
    const timer = setTimeout(() => { if(!done) res(null); }, 900);

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

  if (version){
    el.textContent = `SW: ${version}`;
  } else {
    // fallback (když sw.js ještě neumí odpovědět)
    el.textContent = `SW: ${sw.state || "—"}`;
  }
}

/* ----------------- topbar date sync ----------------- */
function syncTopbarDate(date){
  const dp = $("#dayPicker");
  if (dp && dp.value !== date) dp.value = date;
}

/* ----------------- render ----------------- */
function render(){
  const root = rootEl();
  const date = state.uiDate || todayLocal();

  syncTopbarDate(date);

  if (state.route.name === "visit"){
    const visitId = state.route.visitId;
    const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
    if (!visit){
      root.innerHTML = `<div class="card"><h2>Visit nenalezena</h2><button class="btn" data-nav="home">Zpět</button></div>`;
      bindEvents();
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
          <button class="btn ghost" data-nav="home">Zpět</button>
          <button class="btn bad" data-cancelvisit="${esc(visit.visitId)}">Zrušit</button>
          <button class="btn ok" data-done="${esc(visit.visitId)}">Dokončit</button>
        </div>
        <p class="small">visitId: ${esc(visit.visitId)}</p>
      </div>

      ${renderTemplateForm(tpl, draft)}
    `;

    hydratePhotoThumbs().catch(()=>{});
    bindEvents();
    return;
  }

  // HOME (bez Advanced)
  root.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div>
          <h2>Job Pack</h2>
          <div class="small">Den: <b>${esc(date)}</b></div>
        </div>
        <div class="cardActions">
          ${state.pack ? `<span class="pill ok">Pack ✓</span>` : `<span class="pill bad">Pack: ne</span>`}
        </div>
      </div>

      <div class="row">
        ${state.pack ? `<span class="pill">merch: <b>${esc(state.pack.merch?.id)}</b></span>` : ``}
        ${state.pack ? `<span class="pill">packId: <b class="mono">${esc(state.pack.packId)}</b></span>` : ``}
      </div>

      <div class="hr"></div>

      <div class="toolbar">
        <label class="btn fileBtn">
          <input id="filePack" type="file" accept="application/json" />
          Vybrat jobpack
        </label>

        <button class="btn ok" id="btnImport">Import</button>
        <button class="btn ok" id="btnExport" ${state.pack ? "" : "disabled"}>Export denního ZIP</button>
      </div>
    </div>

    <div class="card">
      <div class="cardHeader">
        <div>
          <h2>Návštěvy</h2>
          <div class="small">${esc(date)}</div>
        </div>
      </div>
      ${renderVisits(date)}
    </div>
  `;

  bindEvents();
}

function renderVisits(date){
  if (!state.pack) return `<p class="small">Nejdřív importuj pack.</p>`;

  const visits = (state.pack.visits || [])
    .filter(v => v.date === date && v.status !== "cancelled")
    .slice()
    .sort((a,b) => String(a.startTime||"99:99").localeCompare(String(b.startTime||"99:99")));

  if (!visits.length) return `<p class="small">Na tenhle den nejsou v packu žádný visits.</p>`;

  return `
    <div class="list">
      ${visits.map(v => {
        const st = storeBySap(v.sapId);
        const tpl = tplById(v.templateId);
        const dr = state.drafts.get(v.visitId);
        const label = dr ? dr.status : "planned";
        const cls = label === "done" ? "ok" : label === "cancelled" ? "bad" : "warn";
        return `
          <div class="item">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <div style="font-weight:900">${esc(st?.name || v.sapId)}</div>
              <span class="pill">${esc(v.startTime || "—")}</span>
              <span class="pill">${esc(tpl?.name || v.templateId)}</span>
              <span class="pill ${cls}">${esc(label)}</span>
              <span class="spacer"></span>
              <button class="btn" data-open="${esc(v.visitId)}">${dr ? "Pokračovat" : "Začít"}</button>
            </div>
            <div class="meta">visitId: ${esc(v.visitId)}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderTemplateForm(tpl, draft){
  if (!tpl) return `<div class="card"><p class="small">Template chybí.</p></div>`;

  const blocks = tpl.blocks || [];
  return blocks.map(b => {
    const qs = b.questions || [];
    return `
      <div class="card">
        <h2>${esc(b.title || b.id)}</h2>
        ${qs.filter(q => isQuestionActive(draft, q)).map(q => renderQuestion(q, draft)).join("")}
      </div>
    `;
  }).join("");
}

/* ----------------- question renderers ----------------- */
function checkboxButtons(key, selected){
  const yesSel = selected === true;
  const noSel  = selected === false;

  const yesStyle = yesSel ? `style="outline:3px solid rgba(16,185,129,.55); outline-offset:2px"` : "";
  const noStyle  = noSel  ? `style="outline:3px solid rgba(244,63,94,.55); outline-offset:2px"` : "";

  return `
    <div class="row">
      <button class="btn ok" data-bool="true" data-qkey="${esc(key)}" aria-pressed="${yesSel}" ${yesStyle}>ANO</button>
      <button class="btn bad" data-bool="false" data-qkey="${esc(key)}" aria-pressed="${noSel}" ${noStyle}>NE</button>
    </div>
  `;
}

function renderPhotoQuestion(q, draft){
  const key = q.key;
  const cfg = q.photo || {};
  const min = Number.isFinite(cfg.photosMin) ? cfg.photosMin : 1;
  const max = Number.isFinite(cfg.photosMax) ? cfg.photosMax : 10;

  const cur = draft.answers?.[key];
  const ids = (cur && typeof cur === "object" && Array.isArray(cur.photoIds)) ? cur.photoIds : [];

  return `
    <div class="q" data-qtype="photo" data-qkey="${esc(key)}" data-min="${esc(min)}" data-max="${esc(max)}">
      <div class="ql">${esc(q.label)} ${q.required ? `<span class="req">*</span>` : ""}</div>
      ${q.help ? `<div class="small">${esc(q.help)}</div>` : ""}

      <div class="hr"></div>

      <div class="row">
        <input class="inp" type="file" accept="image/*" multiple data-phinp="${esc(key)}" />
        <button class="btn" data-phadd="${esc(key)}">Přidat fotky</button>
        <span class="pill">fotky: ${ids.length} / ${max}</span>
        <span class="pill">${min}-${max}</span>
      </div>

      <div class="photoGrid">
        ${ids.map(pid => `
          <div class="ph" data-phid="${esc(pid)}">
            <img alt="${esc(pid)}" src="" />
            <button class="btn ghost" data-phrm="${esc(pid)}" data-qkey="${esc(key)}">✕</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderFurnitureTrigger(q, draft){
  const key = q.key;
  const gate = (typeof draft.answers?.[key] === "string") ? draft.answers[key] : "";
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

      <label>Odpověď</label>
      <select class="inp" data-gate="1" data-qkey="${esc(key)}">
        <option value="">—</option>
        ${(tr.gateOptions || ["NE","ANO"]).map(o => `<option value="${esc(o)}" ${o===gate?"selected":""}>${esc(o)}</option>`).join("")}
      </select>

      ${show ? `
        <div class="hr"></div>
        <div class="row">
          <span class="pill warn">Eviduj atypický nábytek</span>
          <span class="pill">${photosMin}-${photosMax} fotek</span>
          ${requireDescription ? `<span class="pill bad">popis povinný</span>` : `<span class="pill">popis volitelný</span>`}
          <span class="spacer"></span>
          <button class="btn ok" data-addobs="${esc(key)}" ${canAddObs ? "" : "disabled"}>Přidat záznam</button>
        </div>

        <div class="list">
          ${obs.map(o => renderFurnitureObs(o, { allowMultiple, requireDescription, photosMin, photosMax })).join("")}
        </div>
      ` : ``}
    </div>
  `;
}

function renderFurnitureObs(o, rules){
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
        <button class="btn ghost" data-delobs="${esc(o.id)}">Smazat</button>
      </div>

      <label>Název (atypLabel)</label>
      <input class="inp" data-obsfield="atypLabel" data-obsid="${esc(o.id)}" value="${esc(o.atypLabel || "")}" />

      <label>Popis ${rules.requireDescription ? `<span class="req">*</span>` : ""}</label>
      <textarea data-obsfield="description" data-obsid="${esc(o.id)}">${esc(o.description || "")}</textarea>

      ${rules.allowMultiple ? `
        <label>Množství <span class="req">*</span></label>
        <input class="inp" type="number" min="1" data-obsfield="quantity" data-obsid="${esc(o.id)}" value="${esc(String(qty))}" />
      ` : ``}

      <div class="hr"></div>
      <div class="row">
        <input class="inp" type="file" accept="image/*" multiple data-obsphinp="${esc(o.id)}"/>
        <button class="btn" data-obsphadd="${esc(o.id)}">Přidat fotky</button>
      </div>

      <div class="photoGrid">
        ${(o.photoIds||[]).map(pid => `
          <div class="ph" data-phid="${esc(pid)}">
            <img alt="${esc(pid)}" src="" />
            <button class="btn ghost" data-obsphrm="${esc(pid)}" data-obsid="${esc(o.id)}">✕</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderQuestion(q, draft){
  const key = q.key;
  const val = draft.answers?.[key];

  const req = q.required ? `<span class="req">*</span>` : "";
  const help = q.help ? `<div class="small">${esc(q.help)}</div>` : "";

  if (q.type === "checkbox"){
    const selected = (val === true) ? true : (val === false ? false : null);
    return `
      <div class="q" data-qtype="checkbox" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        ${checkboxButtons(key, selected)}
      </div>
    `;
  }

  if (q.type === "text"){
    return `
      <div class="q" data-qtype="text" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <textarea>${esc(typeof val === "string" ? val : "")}</textarea>
      </div>
    `;
  }

  if (q.type === "number"){
    return `
      <div class="q" data-qtype="number" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <input class="inp" type="number" value="${esc(typeof val === "number" ? String(val) : "")}"/>
      </div>
    `;
  }

  if (q.type === "select"){
    const opts = q.options || [];
    const v = typeof val === "string" ? val : "";
    return `
      <div class="q" data-qtype="select" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <select class="inp">
          <option value="">—</option>
          ${opts.map(o => `<option value="${esc(o)}" ${o===v?"selected":""}>${esc(o)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  if (q.type === "photo") return renderPhotoQuestion(q, draft);
  if (q.type === "furniture_trigger") return renderFurnitureTrigger(q, draft);

  return `
    <div class="q">
      <div class="ql">${esc(q.label)} <span class="pill">type: ${esc(q.type)}</span></div>
      <div class="small">Tenhle typ zatím UI nepodporuje.</div>
    </div>
  `;
}

/* ----------------- thumbnails ----------------- */
async function hydratePhotoThumbs(){
  const imgNodes = document.querySelectorAll(".ph[data-phid] img");
  for (const img of imgNodes){
    const holder = img.closest(".ph");
    const pid = holder?.getAttribute("data-phid");
    if (!pid) continue;
    const rec = await getPhotoRec(pid);
    if (rec?.blob){
      img.src = URL.createObjectURL(rec.blob);
    }
  }
}

/* ----------------- hard validation ----------------- */
function validateDraftBeforeDone(draft){
  const tpl = tplById(draft.templateId);
  if (!tpl) return ["Chybí template v packu (fail-fast)."];

  const errors = [];
  const qs = collectQuestions(tpl);

  for (const q of qs){
    if (!isQuestionActive(draft, q)) continue;
    const key = q.key;
    const v = draft.answers?.[key];

    if (q.type === "checkbox"){
      if (q.required && v !== true && v !== false) errors.push(`Chybí odpověď ANO/NE: ${q.label}`);
      continue;
    }
    if (q.type === "text"){
      if (q.required && (typeof v !== "string" || v.trim() === "")) errors.push(`Chybí text: ${q.label}`);
      continue;
    }
    if (q.type === "number"){
      if (q.required && (typeof v !== "number" || Number.isNaN(v))) errors.push(`Chybí číslo: ${q.label}`);
      continue;
    }
    if (q.type === "select"){
      if (q.required && (typeof v !== "string" || v.trim() === "")) errors.push(`Chybí výběr: ${q.label}`);
      continue;
    }
    if (q.type === "photo"){
      const cfg = q.photo || {};
      const min = Number.isFinite(cfg.photosMin) ? cfg.photosMin : 1;
      const max = Number.isFinite(cfg.photosMax) ? cfg.photosMax : 10;

      const ids = (v && typeof v === "object" && Array.isArray(v.photoIds)) ? v.photoIds : [];
      if (q.required && ids.length < min) errors.push(`Chybí fotky (min ${min}): ${q.label}`);
      if (ids.length > max) errors.push(`Moc fotek (max ${max}): ${q.label}`);
      continue;
    }
    if (q.type === "furniture_trigger"){
      if (q.required && (typeof v !== "string" || v.trim() === "")) errors.push(`Chybí odpověď (NE/ANO): ${q.label}`);
      const tr = q.trigger || {};
      const when = tr.whenValue || "ANO";
      if (v === when){
        const obs = Array.isArray(draft.furnitureObservations) ? draft.furnitureObservations : [];
        if (!obs.length) errors.push(`Musíš přidat aspoň 1 záznam atyp nábytku: ${q.label}`);

        const requireDescription = !!tr.form?.requireDescription;
        const allowMultiple = !!tr.form?.allowMultiple;
        const photosMin = Number.isFinite(tr.form?.photosMin) ? tr.form.photosMin : 1;
        const photosMax = Number.isFinite(tr.form?.photosMax) ? tr.form.photosMax : 10;

        for (const o of obs){
          const pcount = (o.photoIds || []).length;
          if (pcount < photosMin) errors.push(`ATYP: chybí fotky (min ${photosMin}).`);
          if (pcount > photosMax) errors.push(`ATYP: moc fotek (max ${photosMax}).`);

          if (requireDescription){
            const has = (o.description && o.description.trim()) || (o.atypLabel && o.atypLabel.trim());
            if (!has) errors.push(`ATYP: chybí popis nebo název.`);
          }
          if (allowMultiple){
            const qty = Number(o.quantity);
            if (!Number.isFinite(qty) || qty < 1) errors.push(`ATYP: množství musí být >= 1.`);
          }
        }
      }
      continue;
    }
  }

  return errors;
}

/* ----------------- export ZIP ----------------- */
async function exportDayZip(date){
  if (!state.pack){ toast("Nejdřív importuj pack."); return; }
  if (typeof window.JSZip !== "function"){ toast("JSZip není dostupný."); return; }

  const merchId = state.pack.merch?.id || "unknown";
  const drafts = [...state.drafts.values()].filter(d => d.date === date && (d.status === "done" || d.status === "cancelled"));
  if (!drafts.length){ toast("Na tenhle den nemáš žádný DONE/CANCELLED návštěvy."); return; }

  const exportId = uuid();
  const createdAt = nowISO();

  const photoSet = new Set();
  for (const d of drafts){
    for (const vv of Object.values(d.answers || {})){
      if (vv && typeof vv === "object" && Array.isArray(vv.photoIds)) vv.photoIds.forEach(pid => photoSet.add(pid));
    }
    for (const o of (d.furnitureObservations || [])){
      (o.photoIds || []).forEach(pid => photoSet.add(pid));
    }
  }

  const zip = new window.JSZip();
  const photosFolder = zip.folder("photos");
  const photosMeta = [];

  for (const pid of [...photoSet]){
    const rec = await getPhotoRec(pid);
    const mime = rec?.mime || "image/jpeg";
    const ext = extFromMime(mime);
    const fileName = `photos/${pid}.${ext}`;

    photosMeta.push({ photoId: pid, fileName, mime, takenAt: rec?.takenAt || null });

    if (rec?.blob){
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
    visits: drafts.map(d => ({
      visitId: d.visitId,
      sapId: d.sapId,
      date: d.date,
      startedAt: d.startedAt,
      submittedAt: d.submittedAt,
      status: d.status === "cancelled" ? "cancelled" : "done",
      cancelReason: d.status === "cancelled" ? (d.cancelReason || "") : undefined,
      templateId: d.templateId,
      templateVersion: d.templateVersion,
      answers: d.answers || {},
      furnitureObservations: (d.furnitureObservations || []).map(o => ({
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

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: "blob" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `results_${date}_${merchId}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);

  toast("Export hotovej.");
}

/* ----------------- events ----------------- */
function bindEvents(){
  document.onclick = async (e) => {
    const t = e.target;

    const nav = t.closest("[data-nav]");
    if (nav){
      state.route = { name: "home", visitId: null };
      render();
      return;
    }

    if (t.id === "btnImport"){
      const f = $("#filePack")?.files?.[0];
      if (!f){ toast("Vyber soubor jobpacku."); return; }
      const txt = await f.text();

      let pack;
      try { pack = JSON.parse(txt); } catch { toast("Tohle není validní JSON."); return; }

      const errs = validateJobPack(pack);
      if (errs.length){ console.error(errs); toast("Pack odmítnut: " + errs[0]); return; }

      await IDB.set(IDB.STORES.pack, "current", pack);
      state.pack = pack;
      toast("Pack importován.");
      render();
      return;
    }

    if (t.id === "btnExport"){
      const d = $("#dayPicker")?.value || state.uiDate || todayLocal();
      exportDayZip(d);
      return;
    }

    const open = t.closest("[data-open]");
    if (open){
      const visitId = open.getAttribute("data-open");
      state.route = { name: "visit", visitId };
      render();
      return;
    }

    const boolBtn = t.closest("[data-bool]");
    if (boolBtn){
      const key = boolBtn.getAttribute("data-qkey");
      const val = boolBtn.getAttribute("data-bool") === "true";
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit || !key) return;
      const d = ensureDraft(visit);
      d.answers[key] = val;
      await saveDraft(d);
      render();
      return;
    }

    const phAdd = t.closest("[data-phadd]");
    if (phAdd){
      const key = phAdd.getAttribute("data-phadd");
      const inp = document.querySelector(`input[data-phinp="${CSS.escape(key)}"]`);
      const files = inp?.files ? [...inp.files] : [];
      if (!files.length){ toast("Vyber fotky (galerie nebo kamera)."); return; }

      const qEl = t.closest('.q[data-qtype="photo"]');
      const max = Number(qEl?.getAttribute("data-max") || "10");

      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit) return;

      const d = ensureDraft(visit);
      const cur = d.answers[key];
      const ids = (cur && typeof cur === "object" && Array.isArray(cur.photoIds)) ? cur.photoIds : [];
      if (ids.length >= max){ toast(`Už máš max ${max} fotek.`); return; }

      const remaining = Math.max(0, max - ids.length);
      const toAdd = files.slice(0, remaining);

      const newIds = await addPhotosToDB(toAdd, visitId);
      d.answers[key] = { photoIds: [...ids, ...newIds] };
      await saveDraft(d);
      render();
      return;
    }

    const phRm = t.closest("[data-phrm]");
    if (phRm){
      const pid = phRm.getAttribute("data-phrm");
      const key = phRm.getAttribute("data-qkey");

      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit) return;

      const d = ensureDraft(visit);
      const cur = d.answers[key];
      const ids = (cur && typeof cur === "object" && Array.isArray(cur.photoIds)) ? cur.photoIds : [];
      d.answers[key] = { photoIds: ids.filter(x => x !== pid) };
      await saveDraft(d);
      render();
      return;
    }

    const addObs = t.closest("[data-addobs]");
    if (addObs){
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
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
    if (delObs){
      const obsId = delObs.getAttribute("data-delobs");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);

      d.furnitureObservations = (d.furnitureObservations || []).filter(o => o.id !== obsId);
      await saveDraft(d);
      render();
      return;
    }

    const obsPhAdd = t.closest("[data-obsphadd]");
    if (obsPhAdd){
      const obsId = obsPhAdd.getAttribute("data-obsphadd");
      const inp = document.querySelector(`input[data-obsphinp="${CSS.escape(obsId)}"]`);
      const files = inp?.files ? [...inp.files] : [];
      if (!files.length){ toast("Vyber fotky k atypu."); return; }

      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);

      const obs = (d.furnitureObservations || []).find(o => o.id === obsId);
      if (!obs) { toast("Záznam atypu nenalezen."); return; }

      const newIds = await addPhotosToDB(files, visitId);
      obs.photoIds = [...(obs.photoIds || []), ...newIds];

      if (inp) inp.value = "";

      await saveDraft(d);
      render();
      return;
    }

    const obsPhRm = t.closest("[data-obsphrm]");
    if (obsPhRm){
      const pid = obsPhRm.getAttribute("data-obsphrm");
      const obsId = obsPhRm.getAttribute("data-obsid");

      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit) return;
      const d = ensureDraft(visit);

      const obs = (d.furnitureObservations || []).find(o => o.id === obsId);
      if (!obs) return;

      obs.photoIds = (obs.photoIds || []).filter(x => x !== pid);
      await saveDraft(d);
      render();
      return;
    }

    const doneBtn = t.closest("[data-done]");
    if (doneBtn){
      const visitId = doneBtn.getAttribute("data-done");
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit){ toast("Visit nenalezena."); return; }

      const d = ensureDraft(visit);
      const errs = validateDraftBeforeDone(d);
      if (errs.length){ toast(errs[0]); return; }

      d.status = "done";
      d.submittedAt = nowISO();
      await saveDraft(d);

      state.route = { name: "home", visitId: null };
      render();
      return;
    }

    const cancelBtn = t.closest("[data-cancelvisit]");
    if (cancelBtn){
      const visitId = cancelBtn.getAttribute("data-cancelvisit");
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit){ toast("Visit nenalezena."); return; }

      const d = ensureDraft(visit);
      d.status = "cancelled";
      d.submittedAt = nowISO();
      d.cancelReason = "cancelled_by_user";
      await saveDraft(d);

      state.route = { name: "home", visitId: null };
      render();
      return;
    }
  };

  document.onchange = async (e) => {
    const t = e.target;

    if (t.id === "dayPicker"){
      state.uiDate = t.value || todayLocal();
      render();
      return;
    }

    if (t.matches('select[data-gate="1"]')){
      const key = t.getAttribute("data-qkey");
      const visitId = state.route.visitId;
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit || !key) return;
      const d = ensureDraft(visit);
      d.answers[key] = t.value || "";
      await saveDraft(d);
      render();
      return;
    }

    const q = t.closest(".q");
    if (!q) return;

    const key = q.getAttribute("data-qkey");
    const type = q.getAttribute("data-qtype");

    const visitId = state.route.visitId;
    const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
    if (!visit || !key) return;

    const d = ensureDraft(visit);

    if (type === "text"){ d.answers[key] = t.value ?? ""; await saveDraft(d); return; }
    if (type === "number"){
      const v = t.value;
      d.answers[key] = (v === "" ? null : Number(v));
      await saveDraft(d);
      return;
    }
    if (type === "select"){ d.answers[key] = t.value || ""; await saveDraft(d); return; }

    if (t.matches("[data-obsfield]")){
      const obsId = t.getAttribute("data-obsid");
      const field = t.getAttribute("data-obsfield");
      const obs = (d.furnitureObservations||[]).find(o => o.id === obsId);
      if (!obs) return;

      if (field === "quantity"){
        const n = Number(t.value);
        obs.quantity = (Number.isFinite(n) && n >= 1) ? n : 1;
      } else {
        obs[field] = t.value ?? "";
      }
      await saveDraft(d);
      return;
    }
  };
}

/* ----------------- boot ----------------- */
async function boot(){
  state.uiDate = todayLocal();
  await loadDeviceId();
  await loadPack();
  await loadDrafts();

  if ("serviceWorker" in navigator){
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch {}
  }

  // refresh badge on controller changes (když se SW aktualizuje)
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      setTimeout(() => updateSWBadge().catch(()=>{}), 300);
    });
  }

  await updateSWBadge().catch(()=>{});

  render();
}
boot();
