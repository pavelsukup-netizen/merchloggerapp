import { IDB } from "./idb.js";

const $ = (sel) => document.querySelector(sel);

const APP_VERSION = "1.0.0"; // změň, když chceš "tvrdší" refresh
const state = {
  route: { name: "home", params: {} },
  pack: null,
  drafts: [],
  currentDraft: null,
  templatesById: new Map(),
  deferredPrompt: null,
};

function nowISO() { return new Date().toISOString(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function yyyyMMdd(d=new Date()){
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
}
function rand8(){
  const a = crypto.getRandomValues(new Uint8Array(4));
  return [...a].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function mobileVisitId(){
  return `m_${yyyyMMdd()}_${rand8()}`;
}
function todayLocal(){
  const d=new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function timeLocal(){
  const d=new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toast(msg, kind=""){
  const el = document.createElement("div");
  el.className = "card";
  el.style.position="fixed";
  el.style.left="14px";
  el.style.right="14px";
  el.style.bottom="14px";
  el.style.zIndex="9999";
  el.style.borderColor = kind==="bad" ? "rgba(255,92,122,.35)" : kind==="ok" ? "rgba(57,217,138,.35)" : "rgba(255,255,255,.10)";
  el.innerHTML = `<div style="font-weight:750">${escapeHtml(msg)}</div>`;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(8px)"; el.style.transition="all .25s"; }, 1800);
  setTimeout(()=> el.remove(), 2300);
}

function navigate(name, params={}){
  state.route = { name, params };
  render();
}

async function loadAll(){
  state.pack = await IDB.get("pack","current") || null;
  await loadDrafts();
  buildTemplatesIndex();
}

async function loadDrafts(){
  const keys = await IDB.keys("drafts");
  const drafts = [];
  for (const k of keys){
    const d = await IDB.get("drafts", k);
    if (d) drafts.push(d);
  }
  drafts.sort((a,b)=> (b.updatedAt||"").localeCompare(a.updatedAt||""));
  state.drafts = drafts;
}

function buildTemplatesIndex(){
  state.templatesById = new Map();
  const pack = state.pack;
  if (!pack) return;
  const templates = pack.templates || [];
  for (const t of templates){
    if (t?.id && t?.json) state.templatesById.set(t.id, t.json);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[m]);
}

function getPackPill(){
  if (!state.pack) return `<span class="pill bad">Pack nahrán: ne</span>`;
  const gen = state.pack.generatedAt ? new Date(state.pack.generatedAt).toLocaleString() : "—";
  return `<span class="pill ok">Pack nahrán ✓</span>
          <span class="pill">packId: ${escapeHtml(state.pack.packId||"—")}</span>
          <span class="pill">v${escapeHtml(String(state.pack.schemaVersion||"1"))}</span>
          <span class="pill">generated: ${escapeHtml(gen)}</span>
          <span class="pill">app: v${escapeHtml(APP_VERSION)}</span>`;
}

function ensurePackOrBlock(){
  if (state.pack) return true;
  toast("Nejdřív importuj Mobile Pack 🙂", "bad");
  return false;
}

/* ----------------- Pack import ----------------- */
async function importPackFromFile(file){
  const text = await file.text();
  let json;
  try{ json = JSON.parse(text); } catch {
    toast("Tohle nevypadá jako JSON 😅", "bad"); return;
  }
  if (json.schema !== "mv_mobile_pack" || !json.packId || !json.settings){
    toast("Pack nemá očekávaný tvar (schema/packId/settings).", "bad"); return;
  }
  await IDB.set("pack","current", json);
  state.pack = json;
  buildTemplatesIndex();
  toast("Pack importován ✓", "ok");
  navigate("home");
}

/* ----------------- Drafts ----------------- */
async function createNewDraft(form){
  const pack = state.pack;
  const settings = pack.settings || {};
  const partners = settings.partners || [];
  const stores = settings.stores || [];

  const partner = partners.find(p => p.id === form.partnerId) || null;
  const store = stores.find(s => s.id === form.storeId) || null;

  const selectedTemplateIds = form.templateIds || [];
  const templateVersions = {};
  for (const tid of selectedTemplateIds){
    const tmeta = (settings.checklistTemplates||[]).find(t=>t.id===tid);
    const tj = state.templatesById.get(tid);
    templateVersions[tid] = tj?.version ?? tmeta?.version ?? 1;
  }

  const id = mobileVisitId();
  const draft = {
    _kind: "draft",
    version: 1,
    id,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    partnerId: form.partnerId,
    partnerName: partner?.name || "",
    storeId: form.storeId,
    storeName: store?.name || "",
    visitDate: form.visitDate,
    visitTime: form.visitTime,
    note: form.note || "",
    checklistTemplateIds: selectedTemplateIds,
    templateVersions,
    packContext: {
      packId: pack.packId,
      checksum: pack.checksum || "",
      settingsVersion: pack.settings?.version ?? 1,
    },
    answers: {},
    attachments: { photos: [] },
    status: "open",
  };

  await IDB.set("drafts", id, draft);
  await loadDrafts();
  toast("Draft vytvořen ✓", "ok");
  navigate("fill", { id });
}

async function openDraft(id){
  const d = await IDB.get("drafts", id);
  if (!d){ toast("Draft nenalezen.", "bad"); navigate("home"); return; }
  state.currentDraft = d;
}

async function saveDraft(d){
  d.updatedAt = nowISO();
  await IDB.set("drafts", d.id, d);
  state.currentDraft = d;
  await loadDrafts();
}

async function deleteDraft(id){
  const draft = await IDB.get("drafts", id);
  if (draft?.attachments?.photos?.length){
    for (const p of draft.attachments.photos){
      await IDB.del("photos", `${id}:${p.name}`);
    }
  }
  await IDB.del("drafts", id);
  await loadDrafts();
  toast("Smazáno.", "ok");
  navigate("home");
}

/* ----------------- Checklist ----------------- */
function collectQuestions(templateJson){
  const out = [];
  const sections = templateJson?.sections || [];
  for (const sec of sections){
    for (const q of (sec.questions||[])){
      out.push({ sectionId: sec.id, sectionTitle: sec.title, q });
    }
  }
  return out;
}

function renderQuestion(draft, templateId, q){
  const qid = q.id;
  const required = !!q.required;
  const val = draft.answers?.[templateId]?.[qid];

  return `
    <div class="q" data-tid="${escapeHtml(templateId)}" data-qid="${escapeHtml(qid)}" data-qtype="${escapeHtml(q.type)}">
      <div class="ql">${escapeHtml(q.label || qid)} ${required ? `<span class="req">* povinné</span>`:""}</div>
      <div class="small">${escapeHtml(q.type)}</div>
      <div class="hr"></div>
      ${renderInput(q, val)}
    </div>
  `;
}

function renderInput(q, val){
  const t = q.type;
  if (t === "boolean"){
    const v = (val === true) ? "true" : (val === false ? "false" : "");
    return `
      <div class="row">
        <button class="btn ok" data-set="true" ${v==="true"?"disabled":""}>Ano</button>
        <button class="btn bad" data-set="false" ${v==="false"?"disabled":""}>Ne</button>
        <span class="pill">${v===""?"—":(v==="true"?"Ano":"Ne")}</span>
      </div>
    `;
  }
  if (t === "scale"){
    const min = q.scale?.min ?? 1;
    const max = q.scale?.max ?? 5;
    const v = (typeof val === "number") ? val : "";
    return `
      <label>Hodnota (${min}–${max})</label>
      <input class="inp" type="number" min="${min}" max="${max}" step="1" value="${escapeHtml(v)}" />
    `;
  }
  if (t === "single"){
    const opts = q.options || [];
    const v = (typeof val === "string") ? val : "";
    return `
      <label>Vyber jednu možnost</label>
      <select>
        <option value="">—</option>
        ${opts.map(o => {
          const ov = String(o.value ?? o);
          const ol = String(o.label ?? o.value ?? o);
          return `<option value="${escapeHtml(ov)}" ${ov===v?"selected":""}>${escapeHtml(ol)}</option>`;
        }).join("")}
      </select>
    `;
  }
  if (t === "multi"){
    const opts = q.options || [];
    const arr = Array.isArray(val) ? val : [];
    return `
      <div class="list">
        ${opts.map(o=>{
          const v = String(o.value ?? o);
          const checked = arr.includes(v) ? "checked" : "";
          return `
            <label class="item" style="display:flex;gap:10px;align-items:center;margin:0">
              <input type="checkbox" data-multi="1" value="${escapeHtml(v)}" ${checked}/>
              <div>${escapeHtml(o.label ?? v)}</div>
            </label>
          `;
        }).join("")}
      </div>
    `;
  }
  if (t === "number"){
    const v = (typeof val === "number") ? val : "";
    return `
      <label>Číslo</label>
      <input class="inp" type="number" value="${escapeHtml(v)}" />
    `;
  }
  const v = (typeof val === "string") ? val : "";
  return `
    <label>Text</label>
    <textarea>${escapeHtml(v)}</textarea>
  `;
}

function validateRequired(draft){
  const missing = [];
  for (const tid of (draft.checklistTemplateIds||[])){
    const tj = state.templatesById.get(tid);
    if (!tj) continue;
    const qs = collectQuestions(tj);
    for (const { q } of qs){
      if (!q.required) continue;
      const v = draft.answers?.[tid]?.[q.id];
      const empty =
        v === undefined || v === null ||
        (typeof v === "string" && v.trim()==="") ||
        (Array.isArray(v) && v.length===0);
      if (empty) missing.push({ templateId: tid, qid: q.id, label: q.label || q.id });
    }
  }
  return missing;
}

/* ----------------- Photos ----------------- */
function nextPhotoName(draft){
  const n = (draft.attachments?.photos?.length || 0) + 1;
  return `${String(n).padStart(3,"0")}.jpg`;
}

async function addPhotosToDraft(draft, files){
  if (!files?.length) return;
  if (!draft.attachments) draft.attachments = {};
  if (!draft.attachments.photos) draft.attachments.photos = [];

  for (const file of files){
    const name = nextPhotoName(draft);
    const key = `${draft.id}:${name}`;
    await IDB.set("photos", key, { blob: file, type: file.type || "image/jpeg" });
    draft.attachments.photos.push({ name, takenAt: nowISO() });
  }
  await saveDraft(draft);
}

async function removePhotoFromDraft(draft, name){
  draft.attachments.photos = (draft.attachments.photos||[]).filter(p => p.name !== name);
  await IDB.del("photos", `${draft.id}:${name}`);
  await saveDraft(draft);
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

/* ----------------- Export ZIP ----------------- */
async function exportDraftZip(draft){
  const visit = {
    version: 1,
    id: draft.id,
    createdAt: draft.createdAt,
    partnerId: draft.partnerId,
    partnerName: draft.partnerName,
    storeId: draft.storeId,
    storeName: draft.storeName,
    visitDate: draft.visitDate,
    visitTime: draft.visitTime,
    note: draft.note || "",
    checklistTemplateIds: draft.checklistTemplateIds || [],
    templateVersions: draft.templateVersions || {},
    packContext: draft.packContext || {},
    answers: draft.answers || {},
    attachments: { photos: (draft.attachments?.photos || []).map(p => ({ name: p.name, takenAt: p.takenAt })) },
    status: draft.status || "open",
  };

  const zipAvailable = typeof window.JSZip === "function";
  if (!zipAvailable){
    toast("JSZip chybí — exportuju aspoň visit.json (bez ZIP).", "warn");
    downloadBlob(new Blob([JSON.stringify(visit,null,2)], {type:"application/json"}), `visit_${draft.id}.json`);
    return;
  }

  const zip = new window.JSZip();
  zip.file("visit.json", JSON.stringify(visit, null, 2));

  const folder = zip.folder("photos");
  for (const p of (draft.attachments?.photos||[])){
    const rec = await IDB.get("photos", `${draft.id}:${p.name}`);
    if (rec?.blob){
      folder.file(p.name, await rec.blob.arrayBuffer());
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  const filename = `visit_export_${draft.id}.zip`;
  const file = new File([content], filename, { type: "application/zip" });

  if (navigator.canShare && navigator.canShare({ files: [file] })){
    try{
      await navigator.share({ files: [file], title: "Visit export", text: "Mobile Visit Package" });
      toast("Sdíleno ✓", "ok");
      return;
    } catch {}
  }

  downloadBlob(content, filename);
  toast("Export hotovej ✓", "ok");
}

/* ----------------- UI screens ----------------- */
function screenHome(){
  const pack = state.pack;
  const drafts = state.drafts;

  const packInfo = `
    <div class="card">
      <h2>Stav packu</h2>
      <div class="row">${getPackPill()}</div>
      <div class="hr"></div>
      <div class="row">
        <input id="filePack" class="inp" type="file" accept="application/json" />
        <button class="btn" id="btnImportPack">Import Mobile Pack</button>
      </div>
      <p class="small">Mobil jen čte SSOT z packu. Nic v packu neupravuje.</p>
    </div>
  `;

  const actions = `
    <div class="card">
      <h2>Akce</h2>
      <div class="row">
        <button class="btn ok" id="btnNewVisit" ${pack ? "" : "disabled"}>Nová návštěva</button>
        <span class="pill ${pack ? "ok":"bad"}">${pack ? "můžeš tvořit návštěvy" : "nejdřív import pack"}</span>
      </div>
      <p class="small">Drafty se ukládají průběžně (offline friendly).</p>
    </div>
  `;

  const draftList = `
    <div class="card">
      <h2>Rozpracované návštěvy</h2>
      <div class="list">
        ${drafts.length ? drafts.map(d => `
          <div class="item">
            <div style="display:flex;gap:10px;align-items:center">
              <div style="font-weight:750">${escapeHtml(d.storeName || "—")}</div>
              <span class="pill">${escapeHtml(d.visitDate||"")}</span>
              <span class="pill">${escapeHtml(d.visitTime||"")}</span>
              <span class="spacer"></span>
              <button class="btn" data-open="${escapeHtml(d.id)}">Otevřít</button>
              <button class="btn ghost" data-del="${escapeHtml(d.id)}">Smazat</button>
            </div>
            <div class="meta">${escapeHtml(d.partnerName||"")} • updated: ${escapeHtml(new Date(d.updatedAt||d.createdAt).toLocaleString())}</div>
          </div>
        `).join("") : `<p class="small">Zatím nic. Pojď udělat první návštěvu 😄</p>`}
      </div>
    </div>
  `;

  return `<div class="grid two">${packInfo}${actions}</div>${draftList}`;
}

function screenNewVisit(){
  if (!ensurePackOrBlock()) return "";
  const settings = state.pack.settings || {};
  const partners = settings.partners || [];
  const tpls = settings.checklistTemplates || [];

  return `
    <div class="card">
      <h2>Nová návštěva</h2>

      <label>Partner</label>
      <select id="partnerSel">
        <option value="">—</option>
        ${partners.filter(p=>p.active!==false).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}
      </select>

      <label>Prodejna</label>
      <select id="storeSel" disabled>
        <option value="">Nejdřív vyber partnera</option>
      </select>

      <div class="grid two">
        <div>
          <label>Datum</label>
          <input id="visitDate" class="inp" type="date" value="${todayLocal()}" />
        </div>
        <div>
          <label>Čas</label>
          <input id="visitTime" class="inp" type="time" value="${timeLocal()}" />
        </div>
      </div>

      <label>Poznámka</label>
      <textarea id="note" placeholder="např. chybí cenovky…"></textarea>

      <div class="hr"></div>
      <h2>Checklist šablony</h2>
      <p class="small">Default vyberu ty s <b>onCreateDefault</b>.</p>

      <div id="tplList" class="list">
        ${tpls.filter(t=>t.enabled!==false).map(t=>{
          const checked = t.onCreateDefault ? "checked" : "";
          return `
            <label class="item" style="display:flex;gap:10px;align-items:center;margin:0">
              <input type="checkbox" value="${escapeHtml(t.id)}" ${checked}/>
              <div>
                <div style="font-weight:700">${escapeHtml(t.name || t.id)}</div>
                <div class="small">id: ${escapeHtml(t.id)}</div>
              </div>
            </label>
          `;
        }).join("")}
      </div>

      <div class="hr"></div>
      <div class="row">
        <button class="btn ghost" id="btnBackHome">Zpět</button>
        <span class="spacer"></span>
        <button class="btn ok" id="btnStartFill">Začít vyplňovat</button>
      </div>
    </div>
  `;
}

function screenFill(){
  const d = state.currentDraft;
  if (!d) return `<div class="card"><p>Načítám…</p></div>`;

  const blocks = [];
  for (const tid of (d.checklistTemplateIds||[])){
    const tj = state.templatesById.get(tid);
    if (!tj){
      blocks.push(`<div class="card"><h2>${escapeHtml(tid)}</h2><p class="small">Šablona není v packu (chybí JSON).</p></div>`);
      continue;
    }
    const qs = collectQuestions(tj);

    let lastSec = null;
    const html = [];
    for (const row of qs){
      if (row.sectionId !== lastSec){
        lastSec = row.sectionId;
        html.push(`<div class="hr"></div><div style="font-weight:800">${escapeHtml(row.sectionTitle || row.sectionId)}</div>`);
      }
      html.push(renderQuestion(d, tid, row.q));
    }

    blocks.push(`
      <div class="card">
        <h2>${escapeHtml(tj.name || tid)} <span class="pill">v${escapeHtml(String(tj.version||1))}</span></h2>
        ${html.join("")}
      </div>
    `);
  }

  return `
    <div class="card">
      <h2>${escapeHtml(d.storeName || "Návštěva")}</h2>
      <p>${escapeHtml(d.partnerName||"")} • ${escapeHtml(d.visitDate||"")} ${escapeHtml(d.visitTime||"")}</p>
      <div class="row">
        <button class="btn ghost" id="btnBackHome">Domů</button>
        <button class="btn" id="btnToPhotos">Pokračovat na fotky</button>
        <span class="spacer"></span>
        <span class="pill">autosave: zapnuto</span>
      </div>
    </div>
    ${blocks.join("")}
    <div class="card">
      <div class="row">
        <button class="btn ghost" id="btnBackHome2">Domů</button>
        <span class="spacer"></span>
        <button class="btn" id="btnToPhotos2">Na fotky</button>
      </div>
    </div>
  `;
}

function screenPhotos(){
  const d = state.currentDraft;
  if (!d) return `<div class="card"><p>Načítám…</p></div>`;

  const photos = d.attachments?.photos || [];
  return `
    <div class="card">
      <h2>Fotky</h2>
      <p class="small">Ukládám do IndexedDB. Offline to jede v pohodě.</p>

      <div class="row">
        <input id="filePhotos" class="inp" type="file" accept="image/*" capture="environment" multiple />
        <button class="btn" id="btnAddPhotos">Přidat</button>
      </div>

      <div class="hr"></div>

      <div class="photoGrid" id="photoGrid">
        ${photos.map(p=>`
          <div class="ph" data-ph="${escapeHtml(p.name)}">
            <img alt="${escapeHtml(p.name)}" src="" />
            <button data-rm="${escapeHtml(p.name)}">✕</button>
          </div>
        `).join("")}
      </div>

      <div class="hr"></div>
      <div class="row">
        <button class="btn ghost" id="btnBackFill">Zpět na checklist</button>
        <span class="spacer"></span>
        <button class="btn ok" id="btnToExport">Export</button>
      </div>
    </div>
  `;
}

function screenExport(){
  const d = state.currentDraft;
  if (!d) return `<div class="card"><p>Načítám…</p></div>`;

  const missing = validateRequired(d);
  const warn = missing.length
    ? `<div class="pill warn">Chybí ${missing.length} povinných odpovědí</div>`
    : `<div class="pill ok">Povinné odpovědi OK</div>`;

  return `
    <div class="card">
      <h2>Export</h2>
      <div class="row">
        ${warn}
        <span class="pill">fotky: ${(d.attachments?.photos||[]).length}</span>
      </div>

      ${missing.length ? `
        <div class="hr"></div>
        <div class="small">Chybí:</div>
        <div class="list">
          ${missing.slice(0,8).map(m=>`
            <div class="item">
              <div style="font-weight:750">${escapeHtml(m.label)}</div>
              <div class="small">template: ${escapeHtml(m.templateId)} • qid: ${escapeHtml(m.qid)}</div>
            </div>
          `).join("")}
          ${missing.length>8 ? `<div class="small">…a další</div>` : ``}
        </div>
      `:""}

      <div class="hr"></div>
      <div class="row">
        <button class="btn ghost" id="btnBackPhotos">Zpět</button>
        <span class="spacer"></span>
        <button class="btn ok" id="btnDoExport">Exportovat visit_export.zip</button>
      </div>

      <p class="small">ZIP: <b>visit.json</b> + <b>photos/001.jpg…</b></p>
    </div>
  `;
}

/* ----------------- Render + events ----------------- */
async function render(){
  if (["fill","photos","export"].includes(state.route.name)){
    await openDraft(state.route.params.id);
  } else {
    state.currentDraft = null;
  }

  const root = $("#app");
  if (!root) return;

  let html = "";
  if (state.route.name === "home") html = screenHome();
  if (state.route.name === "new") html = screenNewVisit();
  if (state.route.name === "fill") html = screenFill();
  if (state.route.name === "photos") html = screenPhotos();
  if (state.route.name === "export") html = screenExport();

  root.innerHTML = html;
  wireEvents();

  if (state.route.name === "photos"){
    await hydratePhotoThumbs();
  }
}

function wireEvents(){
  // Home
  const btnImportPack = $("#btnImportPack");
  if (btnImportPack){
    btnImportPack.onclick = async () => {
      const f = $("#filePack")?.files?.[0];
      if (!f){ toast("Vyber soubor packu.", "bad"); return; }
      await importPackFromFile(f);
    };
  }
  const btnNewVisit = $("#btnNewVisit");
  if (btnNewVisit) btnNewVisit.onclick = () => navigate("new");

  document.querySelectorAll("[data-open]").forEach(b=>{
    b.onclick = () => navigate("fill", { id: b.getAttribute("data-open") });
  });
  document.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick = () => deleteDraft(b.getAttribute("data-del"));
  });

  // New visit
  const partnerSel = $("#partnerSel");
  if (partnerSel){
    partnerSel.onchange = () => {
      const pid = partnerSel.value;
      const storeSel = $("#storeSel");
      const stores = (state.pack?.settings?.stores || []).filter(s => s.active!==false && s.partnerId === pid);
      storeSel.innerHTML = `<option value="">—</option>` + stores.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
      storeSel.disabled = !pid;
    };
  }

  $("#btnBackHome")?.addEventListener("click", ()=>navigate("home"));

  $("#btnStartFill")?.addEventListener("click", async ()=>{
    const partnerId = $("#partnerSel")?.value || "";
    const storeId = $("#storeSel")?.value || "";
    if (!partnerId){ toast("Vyber partnera.", "bad"); return; }
    if (!storeId){ toast("Vyber prodejnu.", "bad"); return; }

    const visitDate = $("#visitDate")?.value || todayLocal();
    const visitTime = $("#visitTime")?.value || timeLocal();
    const note = $("#note")?.value || "";

    const tplIds = [...document.querySelectorAll("#tplList input[type=checkbox]:checked")].map(i=>i.value);
    if (!tplIds.length){ toast("Vyber aspoň jednu šablonu.", "bad"); return; }

    await createNewDraft({ partnerId, storeId, visitDate, visitTime, note, templateIds: tplIds });
  });

  // Fill nav
  $("#btnToPhotos")?.addEventListener("click", ()=>navigate("photos", { id: state.currentDraft.id }));
  $("#btnToPhotos2")?.addEventListener("click", ()=>navigate("photos", { id: state.currentDraft.id }));
  $("#btnBackHome2")?.addEventListener("click", ()=>navigate("home"));

  // question handlers (delegace)
  document.querySelectorAll(".q").forEach(qel=>{
    const tid = qel.getAttribute("data-tid");
    const qid = qel.getAttribute("data-qid");
    const qtype = qel.getAttribute("data-qtype");

    qel.querySelectorAll("button[data-set]").forEach(btn=>{
      btn.onclick = async () => {
        const v = btn.getAttribute("data-set") === "true";
        const d = state.currentDraft;
        d.answers = d.answers || {};
        d.answers[tid] = d.answers[tid] || {};
        d.answers[tid][qid] = v;
        await saveDraft(d);
        render();
      };
    });

    if (qtype === "multi"){
      qel.querySelectorAll("input[type=checkbox][data-multi]").forEach(ch=>{
        ch.onchange = async () => {
          const d = state.currentDraft;
          d.answers = d.answers || {};
          d.answers[tid] = d.answers[tid] || {};
          const arr = new Set(Array.isArray(d.answers[tid][qid]) ? d.answers[tid][qid] : []);
          if (ch.checked) arr.add(ch.value); else arr.delete(ch.value);
          d.answers[tid][qid] = [...arr];
          await saveDraft(d);
        };
      });
      return;
    }

    const inp = qel.querySelector("input.inp, select, textarea");
    if (!inp) return;

    const handler = async () => {
      const d = state.currentDraft;
      d.answers = d.answers || {};
      d.answers[tid] = d.answers[tid] || {};
      let v = inp.value;

      if (qtype === "number" || qtype === "scale"){
        v = (v === "") ? null : Number(v);
        if (Number.isNaN(v)) v = null;
      } else if (qtype === "single"){
        v = (v === "") ? null : String(v);
      } else {
        v = String(v);
      }

      d.answers[tid][qid] = v;
      await saveDraft(d);
    };

    inp.addEventListener("input", handler);
    inp.addEventListener("change", handler);
  });

  // Photos
  $("#btnBackFill")?.addEventListener("click", ()=>navigate("fill", { id: state.currentDraft.id }));

  $("#btnAddPhotos")?.addEventListener("click", async ()=>{
    const files = $("#filePhotos")?.files;
    if (!files || !files.length){ toast("Vyber fotky.", "bad"); return; }
    await addPhotosToDraft(state.currentDraft, [...files]);
    navigate("photos", { id: state.currentDraft.id });
  });

  document.querySelectorAll("[data-rm]").forEach(b=>{
    b.onclick = async () => {
      const name = b.getAttribute("data-rm");
      await removePhotoFromDraft(state.currentDraft, name);
      navigate("photos", { id: state.currentDraft.id });
    };
  });

  $("#btnToExport")?.addEventListener("click", ()=>navigate("export", { id: state.currentDraft.id }));

  // Export
  $("#btnBackPhotos")?.addEventListener("click", ()=>navigate("photos", { id: state.currentDraft.id }));
  $("#btnDoExport")?.addEventListener("click", async ()=>{ await exportDraftZip(state.currentDraft); });
}

async function hydratePhotoThumbs(){
  const d = state.currentDraft;
  const nodes = document.querySelectorAll(".ph");
  for (const node of nodes){
    const name = node.getAttribute("data-ph");
    const rec = await IDB.get("photos", `${d.id}:${name}`);
    const img = node.querySelector("img");
    if (rec?.blob && img){
      img.src = URL.createObjectURL(rec.blob);
    }
  }
}

/* ----------------- PWA install + SW ----------------- */
function setupInstall(){
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    state.deferredPrompt = e;
    const b = $("#btnInstall");
    if (b){ b.hidden = false; }
  });

  $("#btnInstall")?.addEventListener("click", async ()=>{
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    $("#btnInstall").hidden = true;
  });

  // GitHub Pages friendly: registrace jako relativní URL (funguje i v /repo/)
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

/* ----------------- Boot ----------------- */
await loadAll();
render();
setupInstall();
