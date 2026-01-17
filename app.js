import { IDB } from "./idb.js";

const JOBPACK_SCHEMA = "merch.jobpack";
const RESULTS_SCHEMA = "merch.results";
const SCHEMA_VERSION = 1;

const state = {
  pack: null,
  uiDate: null,
  deviceId: null,
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
  // pokud máš v CSS toast komponentu, můžeš to později napojit
  alert(msg);
}

/* ----------------- validation ----------------- */
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
        if (q.type === "select"){
          if (!Array.isArray(q.options) || !q.options.length) errors.push(`Template ${t.templateId}: select ${q.key} bez options`);
        }
        if (q.type === "furniture_trigger"){
          const tr = q.trigger;
          if (!tr || tr.kind !== "furniture") errors.push(`Template ${t.templateId}: furniture_trigger ${q.key} chybí trigger.kind="furniture"`);
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

  // info navíc (nevadí)
  d.storeName = st?.name || "";
  d.retailerId = st?.retailerId || "";

  state.drafts.set(visit.visitId, d);
  return d;
}

async function saveDraft(d){
  await IDB.set(IDB.STORES.drafts, d.visitId, d);
  state.drafts.set(d.visitId, d);
}

/* ----------------- rendering ----------------- */
function render(){
  const root = rootEl();
  const date = state.uiDate || todayLocal();

  if (state.route.name === "visit"){
    const visitId = state.route.visitId;
    const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
    if (!visit){
      root.innerHTML = `<div class="card"><h2>Visit nenalezena</h2><button class="btn" data-nav="home">Domů</button></div>`;
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
          <button class="btn ghost" data-nav="home">Domů</button>
          <button class="btn bad" data-cancelvisit="${esc(visit.visitId)}">Zrušit</button>
          <button class="btn ok" data-done="${esc(visit.visitId)}">Dokončit</button>
        </div>
        <p class="small">Zatím jednoduchý editor (checkbox/text/number/select + furniture_trigger gate). Fotky doplníme hned jako další krok.</p>
      </div>

      ${renderTemplateForm(tpl, draft)}
    `;

    bindEvents();
    return;
  }

  // HOME
  root.innerHTML = `
    <div class="card">
      <h2>Job Pack</h2>
      <div class="row">
        ${state.pack ? `<span class="pill ok">Pack ✓</span>` : `<span class="pill bad">Pack: ne</span>`}
        ${state.pack ? `<span class="pill">packId: ${esc(state.pack.packId)}</span>` : ``}
        ${state.pack ? `<span class="pill">merch: ${esc(state.pack.merch?.id)}</span>` : ``}
      </div>

      <div class="hr"></div>

      <div class="row">
        <input id="filePack" class="inp" type="file" accept="application/json" />
        <button class="btn" id="btnImport">Import pack</button>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Den</label>
          <input id="uiDate" class="inp" type="date" value="${esc(date)}"/>
        </div>
        <div>
          <label>Export</label>
          <button class="btn ok" id="btnExport" ${state.pack ? "" : "disabled"}>Export denního ZIP</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Návštěvy (${esc(date)})</h2>
      ${renderVisits(date)}
    </div>
  `;

  bindEvents();
}

function renderVisits(date){
  if (!state.pack) return `<p class="small">Nejdřív importuj pack.</p>`;

  const visits = (state.pack.visits || [])
    .filter(v => v.date === date && v.status !== "cancelled");

  if (!visits.length) return `<p class="small">Na tenhle den nejsou v packu žádný visits.</p>`;

  visits.sort((a,b) => String(a.startTime||"99:99").localeCompare(String(b.startTime||"99:99")));

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
        ${qs.map(q => renderQuestion(q, draft)).join("")}
      </div>
    `;
  }).join("");
}

function renderQuestion(q, draft){
  const key = q.key;
  const val = draft.answers?.[key];

  const req = q.required ? `<span class="req">*</span>` : "";
  const help = q.help ? `<div class="small">${esc(q.help)}</div>` : "";

  if (q.type === "checkbox"){
    const v = val === true ? "true" : val === false ? "false" : "";
    return `
      <div class="q" data-qtype="checkbox" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <div class="row">
          <button class="btn ok" data-bool="true" ${v==="true"?"disabled":""}>Ano</button>
          <button class="btn bad" data-bool="false" ${v==="false"?"disabled":""}>Ne</button>
          <span class="pill">${v===""?"—":(v==="true"?"Ano":"Ne")}</span>
        </div>
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

  if (q.type === "furniture_trigger"){
    const gate = typeof val === "string" ? val : "";
    const tr = q.trigger || null;
    const show = tr && gate === tr.whenValue;

    return `
      <div class="q" data-qtype="furniture_trigger" data-qkey="${esc(key)}">
        <div class="ql">${esc(q.label)} ${req}</div>
        ${help}
        <select class="inp" data-gate="1">
          <option value="">—</option>
          ${(tr?.gateOptions||[]).map(o => `<option value="${esc(o)}" ${o===gate?"selected":""}>${esc(o)}</option>`).join("")}
        </select>

        ${show ? `<div class="small" style="margin-top:8px">Gate = ANO → tady pak doplníme formulář na evidenci nábytku + fotky.</div>` : ``}
      </div>
    `;
  }

  return `
    <div class="q">
      <div class="ql">${esc(q.label)} <span class="pill">type: ${esc(q.type)}</span></div>
      <div class="small">Tenhle typ zatím UI nepodporuje (doplníme).</div>
    </div>
  `;
}

/* ----------------- export (zatím základ) ----------------- */
async function exportDay(date){
  if (!state.pack){ toast("Nejdřív importuj pack."); return; }
  if (typeof window.JSZip !== "function"){ toast("JSZip není dostupný."); return; }

  const merchId = state.pack.merch?.id || "unknown";
  const drafts = [...state.drafts.values()].filter(d => d.date === date && (d.status === "done" || d.status === "cancelled"));

  if (!drafts.length){
    toast("Na tenhle den nemáš žádný DONE/CANCELLED návštěvy.");
    return;
  }

  const zip = new window.JSZip();
  const manifest = {
    schema: RESULTS_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    exportId: uuid(),
    deviceId: state.deviceId,
    merchId,
    date,
    createdAt: nowISO(),
    packRef: { packId: state.pack.packId, checksum: state.pack.checksum?.value || null },
    photos: [],
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
      furnitureObservations: d.furnitureObservations || []
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
  // delegace
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
      try { pack = JSON.parse(txt); }
      catch { toast("Tohle není validní JSON."); return; }

      const errs = validateJobPack(pack);
      if (errs.length){
        console.error("Pack errors:", errs);
        toast("Pack odmítnut: " + errs[0]);
        return;
      }

      await IDB.set(IDB.STORES.pack, "current", pack);
      state.pack = pack;
      toast("Pack importován.");
      render();
      return;
    }

    if (t.id === "btnExport"){
      const d = $("#uiDate")?.value || state.uiDate || todayLocal();
      exportDay(d);
      return;
    }

    const open = t.closest("[data-open]");
    if (open){
      const visitId = open.getAttribute("data-open");
      state.route = { name: "visit", visitId };
      render();
      return;
    }

    // visit actions
    const done = t.closest("[data-done]");
    if (done){
      const visitId = done.getAttribute("data-done");
      const visit = (state.pack?.visits||[]).find(v => v.visitId === visitId);
      if (!visit){ toast("Visit nenalezena."); return; }

      const d = ensureDraft(visit);
      d.status = "done";
      d.submittedAt = nowISO();
      await saveDraft(d);

      state.route = { name: "home", visitId: null };
      render();
      return;
    }

    const cancel = t.closest("[data-cancelvisit]");
    if (cancel){
      const visitId = cancel.getAttribute("data-cancelvisit");
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

    // checkbox buttons
    const boolBtn = t.closest("[data-bool]");
    if (boolBtn){
      const q = t.closest(".q");
      const key = q?.getAttribute("data-qkey");
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
  };

  document.onchange = async (e) => {
    const t = e.target;

    if (t.id === "uiDate"){
      state.uiDate = t.value || todayLocal();
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

    if (type === "text"){
      d.answers[key] = t.value ?? "";
      await saveDraft(d);
      return;
    }
    if (type === "number"){
      const v = t.value;
      d.answers[key] = (v === "" ? null : Number(v));
      await saveDraft(d);
      return;
    }
    if (type === "select"){
      d.answers[key] = t.value || "";
      await saveDraft(d);
      return;
    }
    if (type === "furniture_trigger" && t.matches("select[data-gate]")){
      d.answers[key] = t.value || "";
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

  // SW můžeš mít, ale když ladíš, klidně ho vypni — teď nechávám zapnuto
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  render();
}

boot();
