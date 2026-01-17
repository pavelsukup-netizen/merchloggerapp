import { IDB } from "./idb.js";

const $ = (sel) => document.querySelector(sel);

const APP_VERSION = "jobpack-v1.0";
const JOBPACK_SCHEMA = "merch.jobpack";
const RESULTS_SCHEMA = "merch.results";
const SCHEMA_VERSION = 1;

const state = {
  route: { name: "home", params: {} },
  pack: null,
  draftsByVisitId: new Map(),
  activeDraft: null,
  deviceId: null,
  uiDate: null
};

/* ---------------- utils ---------------- */
function nowISO(){ return new Date().toISOString(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function todayLocal(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function safeUUID(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  // fallback (ne dokonalý, ale ok pro offline id)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0;
    const v = c === "x" ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[m]);
}
function toast(msg, kind=""){
  const el = document.createElement("div");
  el.className = "card";
  el.style.position="fixed";
  el.style.left="14px";
  el.style.right="14px";
  el.style.bottom="14px";
  el.style.zIndex="9999";
  el.style.borderColor = kind==="bad" ? "rgba(225,29,72,.30)"
    : kind==="ok" ? "rgba(14,168,95,.30)"
    : kind==="warn" ? "rgba(180,83,9,.30)"
    : "rgba(15,23,42,.16)";
  el.innerHTML = `<div style="font-weight:900">${escapeHtml(msg)}</div>`;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(8px)"; el.style.transition="all .25s"; }, 1700);
  setTimeout(()=> el.remove(), 2200);
}
function navigate(name, params={}){
  state.route = { name, params };
  render();
}
function ymdToFile(ymd){ return ymd; } // už je YYYY-MM-DD
function byTime(a,b){
  const ta = a.startTime || "99:99";
  const tb = b.startTime || "99:99";
  return ta.localeCompare(tb);
}

/* ---------------- jobpack validation ---------------- */
function validateJobPackV1(pack){
  const errors = [];

  if (!pack || pack.schema !== JOBPACK_SCHEMA || pack.schemaVersion !== 1){
    errors.push(`schema/schemaVersion nesedí (čekám ${JOBPACK_SCHEMA} v1).`);
    return errors;
  }
  if (!pack.packId) errors.push("Chybí packId");
  if (!pack.createdAt) errors.push("Chybí createdAt");
  if (!pack.validFrom || !pack.validTo) errors.push("Chybí validFrom/validTo");
  if (!pack.merch?.id) errors.push("Chybí merch.id");
  if (!Array.isArray(pack.stores) || !pack.stores.length) errors.push("Chybí stores[]");
  if (!Array.isArray(pack.templates) || !pack.templates.length) errors.push("Chybí templates[]");
  if (!Array.isArray(pack.visits) || !pack.visits.length) errors.push("Chybí visits[]");

  const storeSet = new Set((pack.stores||[]).map(s => s.sapId));
  for (const v of (pack.visits||[])){
    if (!v.visitId) errors.push("Visit bez visitId");
    if (!v.sapId) errors.push(`Visit ${v.visitId||"(no id)"} bez sapId`);
    if (!v.templateId) errors.push(`Visit ${v.visitId||"(no id)"} bez templateId`);
    if (!v.date) errors.push(`Visit ${v.visitId||"(no id)"} bez date`);
    if (v.sapId && !storeSet.has(v.sapId)) errors.push(`Visit ${v.visitId} odkazuje na neznámý store sapId: ${v.sapId}`);
  }

  const tplSet = new Set((pack.templates||[]).map(t => t.templateId));
  for (const v of (pack.visits||[])){
    if (v.templateId && !tplSet.has(v.templateId)) errors.push(`Visit ${v.visitId} odkazuje na neznámý templateId: ${v.templateId}`);
  }

  for (const t of (pack.templates||[])){
    if (!t.templateId) errors.push("Template bez templateId");
    const keys = new Set();
    const dups = new Set();
    for (const b of (t.blocks||[])){
      for (const q of (b.questions||[])){
        if (!q.key) errors.push(`Template ${t.templateId}: otázka bez key`);
        if (q.key){
          if (keys.has(q.key)) dups.add(q.key);
          keys.add(q.key);
        }
        if (!q.type) errors.push(`Template ${t.templateId}: otázka ${q.key||q.id} bez type`);
        if (q.type === "select"){
          if (!Array.isArray(q.options) || !q.options.length) errors.push(`Template ${t.templateId}: select ${q.key} bez options`);
        }
        if (q.type === "furniture_trigger"){
          const tr = q.trigger;
          if (!tr || tr.kind !== "furniture") errors.push(`Template ${t.templateId}: furniture_trigger ${q.key} chybí trigger.kind="furniture"`);
          else{
            if (!Array.isArray(tr.gateOptions) || tr.gateOptions.length !== 2) errors.push(`Template ${t.templateId}: furniture_trigger ${q.key} gateOptions musí mít 2 hodnoty`);
            if (!tr.whenValue) errors.push(`Template ${t.templateId}: furniture_trigger ${q.key} chybí whenValue`);
            const f = tr.form || {};
            if (typeof f.photosMin !== "number" || typeof f.photosMax !== "number") errors.push(`Template ${t.templateId}: furniture_trigger ${q.key} chybí photosMin/photosMax`);
          }
        }
      }
    }
    if (dups.size) errors.push(`Template ${t.templateId}: duplicitní question.key: ${[...dups].join(", ")}`);
  }

  return errors;
}

/* ---------------- persistence ---------------- */
async function loadDeviceId(){
  let did = await IDB.get(IDB.STORES.meta, "deviceId");
  if (!did){
    did = `DEV-${safeUUID()}`;
    await IDB.set(IDB.STORES.meta, "deviceId", did);
  }
  state.deviceId = did;
}

async function loadPack(){
  state.pack = await IDB.get(IDB.STORES.pack, "current");
}

async function loadDrafts(){
  const keys = await IDB.keys(IDB.STORES.drafts);
  const map = new Map();
  for (const k of keys){
    const d = await IDB.get(IDB.STORES.drafts, k);
    if (d) map.set(k, d);
  }
  state.draftsByVisitId = map;
}

function getStoreBySap(sapId){
  return (state.pack?.stores||[]).find(s => s.sapId === sapId) || null;
}
function getTemplateById(tid){
  return (state.pack?.templates||[]).find(t => t.templateId === tid) || null;
}
function packPills(){
  if (!state.pack) return `<span class="pill bad">Pack: nenahrán</span>`;
  return `
    <span class="pill ok">Pack ✓</span>
    <span class="pill">packId: ${escapeHtml(state.pack.packId)}</span>
    <span class="pill">merch: ${escapeHtml(state.pack.merch?.id)}</span>
    <span class="pill">app: ${escapeHtml(APP_VERSION)}</span>
  `;
}

/* ---------------- answers + photos ---------------- */
async function addPhotos(files, visitId){
  const photoIds = [];
  for (const f of files){
    const photoId = safeUUID();
    const mime = f.type || "image/jpeg";
    await IDB.set(IDB.STORES.photos, photoId, { blob: f, mime, takenAt: nowISO(), visitId });
    photoIds.push(photoId);
  }
  return photoIds;
}

async function getPhoto(photoId){
  return await IDB.get(IDB.STORES.photos, photoId);
}

function ensureDraft(visit){
  const existing = state.draftsByVisitId.get(visit.visitId);
  if (existing) return existing;

  const store = getStoreBySap(visit.sapId);
  const tpl = getTemplateById(visit.templateId);

  const draft = {
    schemaVersion: 1,
    visitId: visit.visitId,
    sapId: visit.sapId,
    storeName: store?.name || "",
    retailerId: store?.retailerId || "",
    date: visit.date,
    templateId: visit.templateId,
    templateVersion: tpl?.version ?? 1,
    startedAt: nowISO(),
    submittedAt: null,
    status: "open", // open|done|cancelled
    cancelReason: "",
    answers: {},
    furnitureObservations: [] // array
  };

  state.draftsByVisitId.set(visit.visitId, draft);
  return draft;
}

async function saveDraft(draft){
  await IDB.set(IDB.STORES.drafts, draft.visitId, draft);
  state.draftsByVisitId.set(draft.visitId, draft);
}

/* ---------------- rendering helpers ---------------- */
function screenHome(){
  const d = state.uiDate || todayLocal();
  const packCard = `
    <div class="card">
      <h2>Job Pack</h2>
      <div class="row">${packPills()}</div>
      <div class="hr"></div>
      <div class="row">
        <input id="filePack" class="inp" type="file" accept="application/json" />
        <button class="btn" id="btnImportPack">Import pack</button>
      </div>
      <div class="hr"></div>
      <div class="grid two">
        <div>
          <label>Den</label>
          <input id="uiDate" class="inp" type="date" value="${escapeHtml(d)}" />
        </div>
        <div>
          <label>Export</label>
          <button class="btn ok" id="btnExportDay" ${state.pack ? "" : "disabled"}>Exportovat denní ZIP</button>
        </div>
      </div>
      <p class="small">Mobil neplánuje. Jen importuje pack, vyplní visits a vyexportuje výsledky.</p>
    </div>
  `;

  const visits = (state.pack?.visits || [])
    .filter(v => v.date === d && v.status !== "cancelled")
    .slice()
    .sort(byTime);

  const visitList = `
    <div class="card">
      <h2>Návštěvy (${escapeHtml(d)})</h2>
      <div class="list">
        ${state.pack ? (visits.length ? visits.map(v => {
          const store = getStoreBySap(v.sapId);
          const tpl = getTemplateById(v.templateId);
          const dr = state.draftsByVisitId.get(v.visitId);
          const status = dr?.status || "planned";
          const pillClass = status==="done" ? "ok" : status==="cancelled" ? "bad" : "warn";
          const label = status==="done" ? "done" : status==="cancelled" ? "cancelled" : (dr ? "open" : "planned");
          return `
            <div class="item">
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <div style="font-weight:900">${escapeHtml(store?.name || v.sapId)}</div>
                <span class="pill">${escapeHtml(v.startTime || "—")}</span>
                <span class="pill">${escapeHtml(tpl?.name || v.templateId)}</span>
                <span class="pill ${pillClass}">${escapeHtml(label)}</span>
                <span class="spacer"></span>
                <button class="btn" data-open="${escapeHtml(v.visitId)}">${dr ? "Pokračovat" : "Začít"}</button>
                <button class="btn ghost" data-cancel="${escapeHtml(v.visitId)}">Zrušit</button>
              </div>
              <div class="meta">visitId: ${escapeHtml(v.visitId)}</div>
            </div>
          `;
        }).join("") : `<p class="small">Na tenhle den nejsou v packu žádný visits.</p>`)
        : `<p class="small">Nejdřív importuj job pack.</p>`}
      </div>
    </div>
  `;

  return `${packCard}${visitList}`;
}

function collectQuestions(tpl){
  const out = [];
  for (const b of (tpl.blocks||[])){
    for (const q of (b.questions||[])){
      out.push({ blockId: b.id, blockTitle: b.title, q });
    }
  }
  return out;
}

function renderQuestion(draft, q){
  const key = q.key;
  const val = draft.answers?.[key];

  const req = q.required ? `<span class="req">*</span>` : "";
  const help = q.help ? `<div class="small">${escapeHtml(q.help)}</div>` : "";

  if (q.type === "checkbox"){
    const v = (val === true) ? "true" : (val === false ? "false" : "");
    return `
      <div class="q" data-qkey="${escapeHtml(key)}" data-qtype="checkbox">
        <div class="ql">${escapeHtml(q.label)} ${req}</div>
        ${help}
        <div class="hr"></div>
        <div class="row">
          <button class="btn ok" data-setbool="true" ${v==="true"?"disabled":""}>Ano</button>
          <button class="btn bad" data-setbool="false" ${v==="false"?"disabled":""}>Ne</button>
          <span class="pill">${v===""?"—":(v==="true"?"Ano":"Ne")}</span>
        </div>
      </div>
    `;
  }

  if (q.type === "text"){
    return `
      <div class="q" data-qkey="${escapeHtml(key)}" data-qtype="text">
        <div class="ql">${escapeHtml(q.label)} ${req}</div>
        ${help}
        <div class="hr"></div>
        <textarea>${escapeHtml(typeof val === "string" ? val : "")}</textarea>
      </div>
    `;
  }

  if (q.type === "number"){
    return `
      <div class="q" data-qkey="${escapeHtml(key)}" data-qtype="number">
        <div class="ql">${escapeHtml(q.label)} ${req}</div>
        ${help}
        <div class="hr"></div>
        <input class="inp" type="number" value="${escapeHtml((typeof val === "number") ? String(val) : "")}" />
      </div>
    `;
  }

  if (q.type === "select"){
    const opts = q.options || [];
    const v = (typeof val === "string") ? val : "";
    return `
      <div class="q" data-qkey="${escapeHtml(key)}" data-qtype="select">
        <div class="ql">${escapeHtml(q.label)} ${req}</div>
        ${help}
        <div class="hr"></div>
        <select>
          <option value="">—</option>
          ${opts.map(o => `<option value="${escapeHtml(o)}" ${o===v?"selected":""}>${escapeHtml(o)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  if (q.type === "photo"){
    const ids = (val && typeof val === "object" && Array.isArray(val.photoIds)) ? val.photoIds : [];
    return `
      <div class="q" data-qkey="${escapeHtml(key)}" data-qtype="photo">
        <div class="ql">${escapeHtml(q.label)} ${req}</div>
        ${help}
        <div class="hr"></div>
        <div class="row">
          <input class="inp" type="file" accept="image/*" capture="environment" multiple data-phinp="${escapeHtml(key)}"/>
          <button class="btn" data-phadd="${escapeHtml(key)}">Přidat fotky</button>
          <span class="pill">fotky: ${ids.length}</span>
        </div>
        <div class="photoGrid">
          ${ids.map(pid => `
            <div class="ph" data-phid="${escapeHtml(pid)}" data-qkey="${escapeHtml(key)}">
              <img alt="${escapeHtml(pid)}" src="" />
              <button data-phrm="${escapeHtml(pid)}" data-qkey="${escapeHtml(key)}">✕</button>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (q.type === "furniture_trigger"){
    const tr = q.trigger;
    const gate = (typeof val === "string") ? val : "";
    const show = tr && gate === tr.whenValue;

    const obs = Array.isArray(draft.furnitureObservations) ? draft.furnitureObservations : [];
    return `
      <div class="q" data-qkey="${escapeHtml(key)}" data-qtype="furniture_trigger">
        <div class="ql">${escapeHtml(q.label)} ${req}</div>
        ${help}
        <div class="hr"></div>

        <label>Odpověď</label>
        <select data-gate="${escapeHtml(key)}">
          <option value="">—</option>
          ${(tr?.gateOptions||[]).map(o => `<option value="${escapeHtml(o)}" ${o===gate?"selected":""}>${escapeHtml(o)}</option>`).join("")}
        </select>

        ${show ? `
          <div class="hr"></div>
          <div class="row">
            <span class="pill warn">Zaeviduj atyp / nábytek</span>
            <button class="btn ok" data-addobs="1">Přidat záznam</button>
          </div>

          <div class="list">
            ${obs.map(o => `
              <div class="item">
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                  <div style="font-weight:900">${escapeHtml(o.typeId || "ATYP")}</div>
                  <span class="pill">qty: ${escapeHtml(o.quantity ?? 1)}</span>
                  <span class="pill">fotky: ${(o.photoIds||[]).length}</span>
                  <span class="spacer"></span>
                  <button class="btn ghost" data-delobs="${escapeHtml(o.id)}">Smazat</button>
                </div>

                <label>Název / label (ATYP)</label>
                <input class="inp" data-obsfield="atypLabel" data-obsid="${escapeHtml(o.id)}" value="${escapeHtml(o.atypLabel||"")}" />

                <label>Popis</label>
                <textarea data-obsfield="description" data-obsid="${escapeHtml(o.id)}">${escapeHtml(o.description||"")}</textarea>

                ${tr.form?.allowMultiple ? `
                  <label>Množství</label>
                  <input class="inp" type="number" min="1" data-obsfield="quantity" data-obsid="${escapeHtml(o.id)}" value="${escapeHtml(String(o.quantity ?? 1))}" />
                ` : ``}

                <div class="hr"></div>
                <div class="row">
                  <input class="inp" type="file" accept="image/*" capture="environment" multiple data-obsphinp="${escapeHtml(o.id)}"/>
                  <button class="btn" data-obsphadd="${escapeHtml(o.id)}">Přidat fotky</button>
                </div>

                <div class="photoGrid">
                  ${(o.photoIds||[]).map(pid => `
                    <div class="ph" data-phid="${escapeHtml(pid)}" data-obsid="${escapeHtml(o.id)}">
                      <img alt="${escapeHtml(pid)}" src="" />
                      <button data-obsphrm="${escapeHtml(pid)}" data-obsid="${escapeHtml(o.id)}">✕</button>
                    </div>
                  `).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        ` : ``}
      </div>
    `;
  }

  // fallback
  return `
    <div class="q">
      <div class="ql">${escapeHtml(q.label)} (unsupported type: ${escapeHtml(q.type)})</div>
    </div>
  `;
}

async function hydrateImages(){
  // photo thumbs pro otázky i observations
  const nodes = document.querySelectorAll(".ph[data-phid]");
  for (const n of nodes){
    const pid = n.getAttribute("data-phid");
    const rec = await getPhoto(pid);
    const img = n.querySelector("img");
    if (rec?.blob && img){
      img.src = URL.createObjectURL(rec.blob);
    }
  }
}

function screenVisit(){
  const draft = state.activeDraft;
  if (!draft) return `<div class="card"><p>Načítám…</p></div>`;

  const tpl = getTemplateById(draft.templateId);
  const store = getStoreBySap(draft.sapId);

  if (!tpl){
    return `
      <div class="card">
        <h2>Chybí template</h2>
        <p class="small">TemplateId ${escapeHtml(draft.templateId)} není v packu. To je fail-fast chyba exportu z PC.</p>
        <button class="btn" data-nav="home">Domů</button>
      </div>
    `;
  }

  const qs = collectQuestions(tpl);
  let lastBlock = null;
  const parts = [];

  for (const row of qs){
    if (row.blockId !== lastBlock){
      lastBlock = row.blockId;
      parts.push(`<div class="card"><h2>${escapeHtml(row.blockTitle || row.blockId)}</h2>`);
    }
    parts.push(renderQuestion(draft, row.q));
    // uzavřít card bloky na hranici blocků:
    const next = qs[qs.findIndex(x => x === row) + 1];
    if (!next || next.blockId !== row.blockId) parts.push(`</div>`);
  }

  return `
    <div class="card">
      <h2>${escapeHtml(store?.name || draft.sapId)}</h2>
      <div class="row">
        <span class="pill">${escapeHtml(draft.date)}</span>
        <span class="pill">${escapeHtml(tpl.name || tpl.templateId)}</span>
        <span class="pill warn">${escapeHtml(draft.status)}</span>
        <span class="spacer"></span>
        <button class="btn ghost" data-nav="home">Domů</button>
        <button class="btn bad" data-cancelvisit="${escapeHtml(draft.visitId)}">Zrušit</button>
        <button class="btn ok" data-submit="${escapeHtml(d
