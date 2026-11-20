// Schema 3 -> 4: criteria stop being `type` + `params` and become insurer-stated properties. Converts edited
// documents in place so nothing a person wrote is lost; an untouched seed is simply replaced (see store.ts).

type Doc = Record<string, unknown>;
type Prop = { key: string; label: string; value: unknown; unit?: string; check?: { op: string; fact: string }; assumption?: string };

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Doc => (v && typeof v === "object" ? (v as Doc) : {});

/** "§2b" -> "2b", "Criteria (1)" -> "(1)"; table labels stay as written. */
export function refFromSection(section: unknown): string {
  const s = typeof section === "string" ? section.trim() : "";
  return s.replace(/^§\s*/, "").replace(/^Criteria\s+(?=\()/, "");
}

function propertiesFromParams(type: unknown, params: Doc, label: string): Prop[] {
  const out: Prop[] = [];
  const fact = params.factType === "symptom_onset" ? "symptom_onset" : "conservative_treatment";
  const study = typeof params.studyType === "string" ? params.studyType : "xray";
  const lookback = (f: string, n: unknown) => typeof n === "number" && out.push({ key: "lookback", label: "Lookback", value: n, unit: "months", check: { op: "within_months", fact: f } });
  switch (type) {
    case "min_duration":
      out.push({ key: "duration", label: "Duration", value: params.minWeeks ?? 6, unit: "weeks", check: { op: "min_weeks", fact } });
      break;
    case "evidence_in_window":
      if (typeof params.minWeeks === "number") out.push({ key: "duration", label: "Duration", value: params.minWeeks, unit: "weeks", check: { op: "min_weeks", fact } });
      lookback(fact, params.lookbackMonths);
      if (arr(params.allowedSourceTypes).length) out.push({ key: "accepted_sources", label: "Accepted documentation", value: params.allowedSourceTypes, check: { op: "source_in", fact } });
      if (arr(params.excludedSourceTypes).length) out.push({ key: "excluded_sources", label: "Not accepted", value: params.excludedSourceTypes, check: { op: "source_not_in", fact } });
      if (params.requireResponseDocumented === true) out.push({ key: "response", label: "Response documented", value: "Required", check: { op: "present", fact: "treatment_response" } });
      break;
    case "required_prior_study":
      out.push({ key: "study", label: "Imaging", value: label, check: { op: "present", fact: study } });
      lookback(study, params.withinMonths);
      break;
    case "no_prior_study_in_window":
      out.push({ key: "prior_study", label: "Prior study", value: "None", check: { op: "absent", fact: study } });
      lookback(study, params.withinMonths);
      if (params.sameLaterality === true) out.push({ key: "same_side", label: "Same side", value: true, check: { op: "same_side", fact: study } });
      break;
    default:
      out.push({ key: "requirement", label: "Requirement", value: label });
  }
  return out;
}

function criterion(c: Doc): Doc {
  const { type, params, sourceCitation, interpretationNote, isAssumption, text: _text, ...rest } = c;
  const cite = rec(sourceCitation);
  const label = String(c.displayLabel ?? "");
  const properties = Array.isArray(c.properties) ? (c.properties as Prop[]) : propertiesFromParams(type, rec(params), label);
  if (isAssumption === true && properties.length) {
    properties[0] = { ...properties[0], assumption: typeof interpretationNote === "string" && interpretationNote.trim() ? interpretationNote : "Inferred; confirm with the payer." };
  }
  return { ...rest, ref: c.ref ?? refFromSection(cite.section), excerpt: c.excerpt ?? String(cite.excerpt ?? ""), properties, ...(_text !== undefined ? { text: _text, isAssumption: properties.some((p) => !!p.assumption) } : {}) };
}

function exception(e: Doc): Doc {
  const { sourceCitation, interpretationNote, isAssumption, ...rest } = e;
  const cite = rec(sourceCitation);
  const assumption = isAssumption === true ? (typeof interpretationNote === "string" && interpretationNote.trim() ? interpretationNote : "Inferred; confirm with the payer.") : null;
  return { ...rest, ref: e.ref ?? refFromSection(cite.section), excerpt: e.excerpt ?? String(cite.excerpt ?? ""), assumption: e.assumption ?? assumption };
}

function versionProperties(v: Doc): Prop[] {
  if (Array.isArray(v.properties)) return v.properties as Prop[];
  const out: Prop[] = [];
  const plans = rec(v.applicability).planTypes;
  if (Array.isArray(plans) && plans.length) out.push({ key: "plan_types", label: "Plans", value: plans });
  const sub = rec(v.submission);
  if (arr(sub.channels).length) out.push({ key: "channels", label: "Submit via", value: sub.channels });
  if (arr(sub.requiredAttachments).length) out.push({ key: "attachments", label: "Attach", value: sub.requiredAttachments });
  if (sub.incompleteRequestHandling && sub.incompleteRequestHandling !== "unspecified") {
    out.push({ key: "incomplete_requests", label: "Incomplete requests", value: sub.incompleteRequestHandling });
  }
  return out;
}

function scoped(v: Doc): Doc {
  const { submission: _s, ...rest } = v;
  const { planTypes: _p, ...applicability } = rec(v.applicability);
  return {
    ...rest,
    applicability,
    properties: versionProperties(v),
    criteria: arr(v.criteria).map((c) => criterion(rec(c))),
    exceptions: arr(v.exceptions).map((e) => exception(rec(e))),
  };
}

function result(r: Doc): Doc {
  const { sourceCitation, ...rest } = r;
  const cite = rec(sourceCitation);
  return { ...rest, ref: r.ref ?? refFromSection(cite.section), excerpt: r.excerpt ?? String(cite.excerpt ?? "") };
}

export function migrateV3toV4(doc: Doc): Doc {
  const versions = arr(doc.versions).map((v) => scoped(rec(v)));
  const bodySite = new Map(arr(doc.policies).map((p) => [rec(p).id, rec(p).bodySite]));
  const evaluations = arr(doc.evaluations).map((raw) => {
    const e = rec(raw);
    const snap = e.rulesSnapshot ? rec(e.rulesSnapshot) : null;
    return {
      ...e,
      rulesSnapshot: snap ? { ...scoped(snap), bodySite: snap.bodySite ?? bodySite.get(snap.policyId) ?? "" } : null,
      criterionResults: arr(e.criterionResults).map((r) => result(rec(r))),
      exceptionResults: arr(e.exceptionResults).map((r) => result(rec(r))),
    };
  });
  return { ...doc, versions, evaluations };
}
