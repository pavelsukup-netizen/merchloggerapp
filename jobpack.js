export const JOBPACK_SCHEMA = "merch.jobpack";
export const SUPPORTED_JOBPACK_VERSIONS = new Set([1, 2]);

const QUESTION_TYPES_V2 = new Set(["checkbox", "text", "number", "select", "photo"]);
const OPS_BY_SOURCE = {
  checkbox: new Set(["eq"]),
  selectSingle: new Set(["eq", "neq"]),
  selectMulti: new Set(["contains", "not_contains"]),
  number: new Set(["eq", "neq", "gt", "gte", "lt", "lte"])
};

function own(obj, key){
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function sourceKind(question){
  if (question?.type === "checkbox") return "checkbox";
  if (question?.type === "number") return "number";
  if (question?.type === "select") return question.multi === true ? "selectMulti" : "selectSingle";
  return null;
}

function validDependencyValue(source, value){
  if (source.type === "checkbox") return typeof value === "boolean";
  if (source.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (source.type === "select") return typeof value === "string" && (source.options || []).includes(value);
  return false;
}

function validateQuestionV2(question, templateId, index, previousById, previousByKey, errors){
  const where = `Template ${templateId}, otázka ${index + 1}`;
  if (!question || typeof question !== "object") {
    errors.push(`${where}: neplatný objekt otázky`);
    return;
  }
  if (typeof question.id !== "string" || !question.id) errors.push(`${where}: chybí id`);
  if (typeof question.key !== "string" || !question.key) errors.push(`${where}: chybí key`);
  if (typeof question.label !== "string" || !question.label) errors.push(`${where}: chybí label`);
  if (!QUESTION_TYPES_V2.has(question.type)) errors.push(`${where}: nepodporovaný type ${question.type || "(prázdný)"}`);
  if (typeof question.required !== "boolean") errors.push(`${where}: required musí být boolean`);
  if (question.partnerIds !== undefined && (!Array.isArray(question.partnerIds) || question.partnerIds.some(id => typeof id !== "string"))) {
    errors.push(`${where}: partnerIds musí být pole textových ID`);
  }
  if (question.help !== undefined && typeof question.help !== "string") errors.push(`${where}: help musí být text`);
  if (question.counter !== undefined && typeof question.counter !== "boolean") errors.push(`${where}: counter musí být boolean`);
  if (question.stepper !== undefined && typeof question.stepper !== "boolean") errors.push(`${where}: stepper musí být boolean`);

  if (question.type === "select") {
    if (!Array.isArray(question.options) || question.options.some(option => typeof option !== "string")) {
      errors.push(`${where}: select musí mít options[] z textových hodnot`);
    }
    if (question.multi !== undefined && typeof question.multi !== "boolean") {
      errors.push(`${where}: multi musí být boolean`);
    }
  }
  if (question.type === "photo") {
    const min = question.photo?.photosMin;
    const max = question.photo?.photosMax;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
      errors.push(`${where}: photo.photosMin/photosMax nejsou platné`);
    }
  }

  const dependency = question.dependsOn;
  if (!dependency) return;
  const sourceById = previousById.get(dependency.questionId);
  const sourceByKey = previousByKey.get(dependency.key);
  if (!sourceById) errors.push(`${where}: dependsOn.questionId neodkazuje na dřívější otázku`);
  if (!sourceByKey) errors.push(`${where}: dependsOn.key neodkazuje na dřívější otázku`);
  if (!sourceById || !sourceByKey) return;
  if (sourceById !== sourceByKey) {
    errors.push(`${where}: dependsOn.questionId a key odkazují na různé otázky`);
    return;
  }

  const kind = sourceKind(sourceById);
  if (!kind) {
    errors.push(`${where}: typ hlavní otázky nesmí být zdrojem podmínky`);
    return;
  }
  if (!OPS_BY_SOURCE[kind].has(dependency.op)) {
    errors.push(`${where}: operátor ${dependency.op || "(prázdný)"} není povolený pro hlavní otázku`);
  }
  if (!validDependencyValue(sourceById, dependency.value)) {
    errors.push(`${where}: dependsOn.value má neplatný typ nebo není v options`);
  }
  if (typeof dependency.clearWhenHidden !== "boolean") {
    errors.push(`${where}: dependsOn.clearWhenHidden musí být boolean`);
  }
}

export function validateJobPack(pack){
  const errors = [];
  if (!pack || pack.schema !== JOBPACK_SCHEMA) {
    return [`Neplatné schema (čekám ${JOBPACK_SCHEMA})`];
  }
  if (!SUPPORTED_JOBPACK_VERSIONS.has(pack.schemaVersion)) {
    return [`Nepodporovaná verze jobpacku: ${pack.schemaVersion ?? "neuvedena"} (podporuji v1 a v2)`];
  }

  if (!pack.packId) errors.push("Chybí packId");
  if (!pack.createdAt) errors.push("Chybí createdAt");
  if (!pack.merch?.id) errors.push("Chybí merch.id");
  if (!Array.isArray(pack.stores)) errors.push("Chybí stores[]");
  if (!Array.isArray(pack.templates)) errors.push("Chybí templates[]");
  if (!Array.isArray(pack.visits)) errors.push("Chybí visits[]");

  if (pack.schemaVersion === 2) {
    if (!pack.validFrom) errors.push("Chybí validFrom");
    if (!pack.validTo) errors.push("Chybí validTo");
    if (!Array.isArray(pack.features) || !pack.features.includes("conditionalQuestions")) {
      errors.push("Jobpack v2 musí mít features[] s conditionalQuestions");
    }
    if (!Array.isArray(pack.retailers)) errors.push("Chybí retailers[]");
    if (!Array.isArray(pack.furnitureTypes)) errors.push("Chybí furnitureTypes[]");
  }

  const stores = Array.isArray(pack.stores) ? pack.stores : [];
  const templates = Array.isArray(pack.templates) ? pack.templates : [];
  const visits = Array.isArray(pack.visits) ? pack.visits : [];
  const storeSet = new Set(stores.map(store => store.sapId));
  const templateSet = new Set(templates.map(template => template.templateId));
  const visitIds = new Set();

  if (pack.schemaVersion === 2) {
    for (const retailer of (Array.isArray(pack.retailers) ? pack.retailers : [])) {
      if (!retailer?.id || !retailer?.name) errors.push("Retailer musí mít id a name");
    }
    for (const store of stores) {
      if (!store?.sapId || !store?.name || !store?.retailerId) errors.push("Prodejna musí mít sapId, name a retailerId");
    }
  }

  for (const visit of visits) {
    const id = visit?.visitId || "(bez ID)";
    if (!visit?.visitId) errors.push("Návštěva bez visitId");
    else if (visitIds.has(visit.visitId)) errors.push(`Duplicitní visitId: ${visit.visitId}`);
    else visitIds.add(visit.visitId);
    if (!visit?.sapId) errors.push(`Návštěva ${id} bez sapId`);
    if (!visit?.templateId) errors.push(`Návštěva ${id} bez templateId`);
    if (!visit?.date) errors.push(`Návštěva ${id} bez date`);
    if (visit?.sapId && !storeSet.has(visit.sapId)) errors.push(`Návštěva ${id} odkazuje na neznámou prodejnu ${visit.sapId}`);
    if (visit?.templateId && !templateSet.has(visit.templateId)) errors.push(`Návštěva ${id} odkazuje na neznámý checklist ${visit.templateId}`);
    if (pack.schemaVersion === 2 && visit?.status !== "planned") errors.push(`Návštěva ${id}: status musí být planned`);
  }

  for (const template of templates) {
    const templateId = template?.templateId || "(bez ID)";
    if (!template?.templateId) errors.push("Checklist bez templateId");
    if (!Array.isArray(template?.blocks)) {
      errors.push(`Template ${templateId}: chybí blocks[]`);
      continue;
    }
    if (pack.schemaVersion === 2) {
      if (!template?.name) errors.push(`Template ${templateId}: chybí name`);
      if (!Number.isFinite(template?.version)) errors.push(`Template ${templateId}: chybí číselná version`);
      template.blocks.forEach((block, blockIndex) => {
        if (!block?.id || !block?.title) errors.push(`Template ${templateId}, blok ${blockIndex + 1}: chybí id nebo title`);
        if (!Array.isArray(block?.questions)) errors.push(`Template ${templateId}, blok ${blockIndex + 1}: chybí questions[]`);
      });
    }
    const questions = template.blocks.flatMap(block => Array.isArray(block?.questions) ? block.questions : []);
    const ids = new Set();
    const keys = new Set();
    const previousById = new Map();
    const previousByKey = new Map();

    questions.forEach((question, index) => {
      if (question?.id) {
        if (ids.has(question.id)) errors.push(`Template ${templateId}: duplicitní question.id ${question.id}`);
        ids.add(question.id);
      }
      if (question?.key) {
        if (keys.has(question.key)) errors.push(`Template ${templateId}: duplicitní question.key ${question.key}`);
        keys.add(question.key);
      }

      if (pack.schemaVersion === 2) {
        validateQuestionV2(question, templateId, index, previousById, previousByKey, errors);
      } else if (!question?.key) {
        errors.push(`Template ${templateId}: otázka bez key`);
      }

      if (question?.id && !previousById.has(question.id)) previousById.set(question.id, question);
      if (question?.key && !previousByKey.has(question.key)) previousByKey.set(question.key, question);
    });
  }

  return errors;
}

function normalizeLegacyCondition(condition){
  let op = condition?.op;
  let value = condition?.value;
  if (!op && condition?.equals !== undefined) { op = "eq"; value = condition.equals; }
  if (!op && condition?.notEquals !== undefined) { op = "neq"; value = condition.notEquals; }
  if (value === "ANO") value = true;
  if (value === "NE") value = false;
  return { ...condition, op, value };
}

export function evaluateCondition(answers, rawCondition, schemaVersion = 2){
  const condition = schemaVersion === 1 ? normalizeLegacyCondition(rawCondition || {}) : (rawCondition || {});
  if (!condition.key || !own(answers, condition.key)) return false;
  const actual = answers[condition.key];

  switch (condition.op) {
    case "eq": return schemaVersion === 1 && Array.isArray(actual) ? actual.includes(condition.value) : actual === condition.value;
    case "neq": return schemaVersion === 1 && Array.isArray(actual) ? !actual.includes(condition.value) : actual !== condition.value;
    case "contains": return Array.isArray(actual) && actual.includes(condition.value);
    case "not_contains": return Array.isArray(actual) && !actual.includes(condition.value);
    case "gt": return typeof actual === "number" && actual > condition.value;
    case "gte": return typeof actual === "number" && actual >= condition.value;
    case "lt": return typeof actual === "number" && actual < condition.value;
    case "lte": return typeof actual === "number" && actual <= condition.value;
    case "in":
      return Array.isArray(condition.value) && (Array.isArray(actual)
        ? actual.some(value => condition.value.includes(value))
        : condition.value.includes(actual));
    case "truthy":
      if (Array.isArray(actual)) return actual.length > 0;
      if (actual && typeof actual === "object" && Array.isArray(actual.photoIds)) return actual.photoIds.length > 0;
      return !!actual;
    case "falsy":
      if (Array.isArray(actual)) return actual.length === 0;
      if (actual && typeof actual === "object" && Array.isArray(actual.photoIds)) return actual.photoIds.length === 0;
      return !actual;
    default: return false;
  }
}

export function isQuestionVisible(question, answers, retailerId, schemaVersion = 2){
  if (Array.isArray(question?.partnerIds) && question.partnerIds.length && !question.partnerIds.includes(retailerId)) {
    return false;
  }
  const dependency = question?.dependsOn;
  if (!dependency) return true;
  if (dependency.key) return evaluateCondition(answers, dependency, schemaVersion);
  if (schemaVersion === 1 && Array.isArray(dependency.all)) {
    return dependency.all.every(condition => evaluateCondition(answers, condition, 1));
  }
  if (schemaVersion === 1 && Array.isArray(dependency.any)) {
    return dependency.any.some(condition => evaluateCondition(answers, condition, 1));
  }
  return false;
}

export function pruneHiddenAnswers(template, draft, schemaVersion = 2){
  const removedKeys = [];
  const answers = draft?.answers || {};
  const questions = (template?.blocks || []).flatMap(block => block?.questions || []);
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

export function visibleAnswers(template, draft, schemaVersion = 2){
  const result = {};
  const answers = draft?.answers || {};
  const questions = (template?.blocks || []).flatMap(block => block?.questions || []);
  for (const question of questions) {
    if (isQuestionVisible(question, answers, draft?.retailerId || "", schemaVersion) && own(answers, question.key)) {
      result[question.key] = answers[question.key];
    }
  }
  return result;
}

export function getDayExportState(pack, drafts, date){
  const scheduled = (pack?.visits || []).filter(visit => visit.date === date && visit.status !== "cancelled");
  const draftMap = drafts instanceof Map ? drafts : new Map((drafts || []).map(draft => [draft.visitId, draft]));
  const unresolved = scheduled.filter(visit => {
    const draft = draftMap.get(visit.visitId);
    const status = draft?.status;
    const belongsToPack = pack?.schemaVersion === 1 || draft?.packId === pack?.packId;
    return !belongsToPack || (status !== "done" && status !== "cancelled");
  });
  return {
    scheduled,
    unresolved,
    canExport: scheduled.length > 0 && unresolved.length === 0,
    resolvedDrafts: scheduled
      .map(visit => draftMap.get(visit.visitId))
      .filter(draft => draft && (pack?.schemaVersion === 1 || draft.packId === pack?.packId))
  };
}
