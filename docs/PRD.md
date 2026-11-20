# PRD: Halcyon Prior Auth Worklist

Nov 19, 2026 · @Harshil Sheth

## Overview

Routine imaging orders should be submitted to the insurer the same day without a nurse reading them. Nurses should see only requests with a real clinical gap. Coordinators should see only paperwork that needs chasing.

**Problem.** Halcyon handles 12,000 scan approval requests a month across 14 hospitals. A nurse reads 100% of them, at 18 minutes each, which is 61% of all handling time. The average wait for an approval is 3.2 days. Two queue waits of about 9 hours each make up most of the delay. Missing notes are found a day late, in 22% of packets. 11% of requests are denied.

**Product.** A worklist with one line per imaging order. Each line moves through clear statuses from intake to the insurer's decision. Behind it, a pipeline reads the documents, checks them against configurable insurer rules, and sends each order to one of three places: the insurer, a coordinator, or a nurse. Every decision cites its proof from the record.

**Goals**

- Same-day submission for orders that clearly meet criteria, with no nurse touch
- Missing or broken documents caught at intake, not a day later in the nurse queue
- Nurse time spent only on clinical gaps, rule gaps and denials
- No scan slot lost silently: every order shows its time risk against the scan date
- Insurer rules editable by operations staff, without engineers

**Non-goals (v1)**

- The system never denies or cancels an order. Only people do.
- No clinical decision support for the ordering doctor
- No billing or claims work after the scan

**Success metrics**

| Metric | Today | v1 target |
| --- | --- | --- |
| Share of requests submitted without a nurse touch | 0% | 50% or more of routine MRI/CT |
| Order received to submitted (median) | \~1 to 2 days | Same day for auto-submit |
| Missing documentation found at intake vs. at nurse review | Found at nurse review | 90% or more found at intake |
| Denials for incomplete documentation | Part of 11% | Down 50% |
| Scans cancelled for lack of approval | Not measured | Measured, then down 50% |
| Auto-submits a nurse audit later overturns | n/a | Under 1% |

The targets are proposals to agree with Halcyon during discovery.

## Users and roles

Four roles use the worklist, each through a saved view.

| Role | Default view | What they do in the product |
| --- | --- | --- |
| Intake coordinator | Coordinator queue: Needs documents, Needs correction, Needs eligibility, Ready to submit (portal) | Chase missing pages and records, fix mismatches with the ordering clinic, run portal submissions for insurers with no API, check status when automated tracking fails |
| Utilization review nurse | Nurse queue: Clinical review, Rule gap, Denied | Review clinical gaps with the ordering doctor, approve or return items, draft appeals with the doctor, spot-check a sample of auto-submits |
| Rules admin (ops or UM lead) | Rule library | Turn insurer policy PDFs into rules, test them against the case library, publish new versions |
| Revenue cycle lead (Renee Okafor) | Dashboard | Watch throughput, time to submission, denial and cancellation rates; set routing and automation thresholds |

Ordering doctors and schedulers don't log in. They receive tasks and alerts through Epic In Basket and the scheduling system.

## Current workflow

&#91;embedded content: Current workflow · 8 steps, 3 waits, 4 outcomes\]

A nurse reads every request, and the two 9-hour queues before and after note gathering drive most of the delay. Missing notes surface only at nurse review, then the packet waits in both queues again. Figures are from Halcyon's kickoff brief.

## New workflow

&#91;embedded content: New workflow · 9 automated stages, 14 exits\]

The pipeline runs every order through nine automated stages. A person gets an order only at an exit that needs one: coordinators for paperwork, nurses for clinical gaps and denials. Orders that meet every criterion go to the insurer with no one touching them.

## Worklist

Each imaging order is one line. Documents that arrive before or after the order attach to that line; they never become separate lines. The only exception is a document that can't be matched to any order: it gets its own line in **Unmatched** until a coordinator places it.

### Columns

| Column | Source | Notes |
| --- | --- | --- |
| Scan date and time | Epic order | Default sort, earliest first. Not arrival order. |
| Time risk | Computed | On track / At risk / Slot at risk (see Modules: time-risk policy) |
| Patient, MRN | Epic | Name, DOB and MRN confirmed by matching |
| Order #, study, CPT, side | Epic order + extraction | Side shown for joints |
| Insurer, plan, channel | Eligibility + rules | Channel = API or portal |
| Status | State machine | One status at a time |
| Owner | Routing | System, coordinator, nurse, or a named person once claimed |
| Reason | Pipeline | One line, e.g. "PT notes p.4 missing" or "Prior MRI 06/15, within 12 months" |
| Next action | Pipeline | The button the owner presses next |
| Time in status | Computed | Turns amber past the SLA for that status |

Opening a line shows the **review card**: the same fields as Ode's answer keys (input shape, approval needed, packet complete, missing items, decision, written reason, next step, submit via, attachments, time risk), the criteria table with a quote and page link for each result, and the full audit trail.

### Statuses

| Status | Group | Owner | Meaning | Leaves to |
| --- | --- | --- | --- | --- |
| Received | Automated | System | Order or document arrived | Pre-processing |
| Pre-processing | Automated | System | Orientation, blank pages, page count, readability | Matching, Unreadable |
| Unreadable | Coordinator | Coordinator | Blank, illegible or partial document | Received (resent copy) |
| Matching | Automated | System | Match to patient and order | Coverage check, Unmatched |
| Unmatched | Coordinator | Coordinator | No confident patient or order match | Coverage check (placed by hand) |
| Coverage check | Automated | System | Eligibility and existing-approval lookup | Approval check, Needs correction, Approved (linked) |
| Approval check | Automated | System | Rules decide: needed / not needed / unknown | Collecting evidence, Not required, Rule gap |
| Collecting evidence | Automated | System | Pull Epic records, request outside records, extract facts | Evaluating, Awaiting documents |
| Awaiting documents | Coordinator | Coordinator | Request sent; waiting on a clinic or therapist | Collecting evidence |
| Needs correction | Coordinator | Coordinator | Wrong side, wrong patient page, stale insurer, CPT conflict | Collecting evidence |
| Evaluating | Automated | System | Criteria and consistency checks | Ready to submit, Clinical review, Needs documents |
| Clinical review | Nurse | Nurse | Documents complete, criteria not met or not certain | Ready to submit, Cancelled |
| Rule gap | Nurse | Nurse + rules admin | Approval needed, but no rules exist for this insurer + study | Ready to submit, Cancelled |
| Ready to submit | Automated or coordinator | System (API) / coordinator (portal) | Packet built; waiting to send | Submitted |
| Submitted | Insurer | System | Sent, tracking number held | Approved, Denied, More info requested |
| More info requested | Coordinator | Coordinator | Insurer asked for more | Collecting evidence |
| Approved | Closed | System | Approval number and dates written to Epic | (end) |
| Not required | Closed | System | No approval needed; Epic marked with policy reference | (end) |
| Denied | Nurse | Nurse | Insurer said no | Appeal, Closed denied |
| Appeal | Nurse | Nurse + ordering doctor | Appeal or peer-to-peer in progress | Approved, Closed denied |
| Closed denied | Closed | n/a | Final denial; scheduling told | (end) |
| Cancelled | Closed | n/a | Order withdrawn or slot released by a person | (end) |

"Needs documents" in the Evaluating row is shorthand for Awaiting documents or Needs correction, depending on the failure. Any open status can move to Cancelled when Epic cancels the order.

## State machine

&#91;embedded content: Order state machine · 22 statuses, 4 end states\]

Every coordinator status loops back into the automated pipeline, so a fixed order is always re-checked before it moves on. Nurse statuses are the only ones that end in a person's decision rather than the system's.

## Pipeline stages and checks

Every check has an ID, a result, and a status it moves the order to. Every result is stored with the page, the quote and a confidence score, so any decision can be traced back to the record. Case numbers refer to the test library: 1 to 3 from Ode, 4 to 23 generated.

### 1. Intake

Sources: the Epic order feed (imaging orders with auth status "Needed"), the prior-auth fax inbox, and outside records filed to Epic Media. A document from an order that already exists attaches to it (Kirk's PT notes arrived a week before the order). Intake is idempotent: the same fax received twice creates one record.

### 2. Pre-processing

| ID | Check | Fails when | Result | Cases |
| --- | --- | --- | --- | --- |
| PP-1 | Orientation | Page upside down or sideways | Auto-rotate, note it on the review card; never fails | 05, 17 |
| PP-2 | Blank page | Page holds only the fax header | Page flagged missing; all pages blank → Unreadable | 12, 20 |
| PP-3 | Page sequence | Fax header numbers skip (P.003 to P.005) or total doesn't match | Missing page listed by number | 2 |
| PP-4 | Cover sheet vs contents | A listed document isn't found on any page | Missing document listed by name. Different order is fine. | 2, 09, 12 |
| PP-5 | Readability | Confidence on a page or a needed field below threshold | That page or field marked unreadable | 13 |
| PP-6 | Page type | n/a | Each page labelled: cover, request form, office note, PT note, imaging report, pathology, insurance card, handwritten note | all |

An all-blank or unreadable fax goes to **Unreadable** with the sender's fax number from the header (case 20). Nothing is guessed from it.

### 3. Matching

| ID | Check | Rule | Fails to |
| --- | --- | --- | --- |
| MA-1 | Patient | MRN exact match first; else name + DOB + member ID, scored | Unmatched |
| MA-2 | Order | Same patient, same study, order within the matching window | Unmatched |
| MA-3 | Every page belongs to this patient | Name and DOB on each page match the order | Needs correction; page quarantined, never attached; privacy flag (case 15) |

### 4. Coverage check

| ID | Check | Rule | Result | Cases |
| --- | --- | --- | --- | --- |
| CV-1 | Eligibility | Insurer on the order is active on the scan date (eligibility API). Conflict with a scanned card or a note also fails. | Needs correction ("Verify coverage") | 18 |
| CV-2 | Existing approval | Same patient, same CPT, valid on the scan date, not bound to a different site or provider | Link it; status Approved (linked). No new request. | 16 |

### 5. Approval check

The rule engine's first layer (see Rule engine) looks up insurer + plan + CPT + setting.

| Result | Status | Cases |
| --- | --- | --- |
| Required, criteria in library | Collecting evidence | most |
| Not required | Not required; Epic auth status set with the policy reference | 11, 21 |
| Required, no criteria in library | Rule gap | 19 |
| No rule for this insurer + CPT at all | Rule gap | n/a |

### 6. Collecting evidence

- **EV-1 Pull from Epic:** office notes, problem list, medication list, imaging history (24 months), outside records, prior approvals.
- **EV-2 Request outside records:** when a criterion needs a document that a note mentions but Epic doesn't have ("PT at Utopia Planitia, records requested"), send a records request to that clinic and move to **Awaiting documents**.
- **EV-3 Extract evidence per criterion:** for each criterion in the policy, extract the value, the page, the quote, a confidence score, and the **source kind**: clinician-documented, therapist-documented, imaging/pathology report, or patient-reported.

### 7. Evaluating

**Consistency checks** run before the criteria.

| ID | Check | Fails when | Cases |
| --- | --- | --- | --- |
| CO-1 | Side | Order or request says one side; notes, imaging or therapy say the other | 17 |
| CO-2 | CPT | CPT doesn't match the procedure name or isn't in the policy's CPT list | n/a |
| CO-3 | Body part and diagnosis | Diagnosis code is for a different body part | n/a |
| CO-4 | Patient on every page | From MA-3 | 15 |
| CO-5 | Insurer | From CV-1 | 18 |

**Criteria checks.** Each criterion gets exactly one result:

| Result | Meaning | Example |
| --- | --- | --- |
| Met | Proof found from an accepted source | Kirk: PT 12 visits 09/21 to 10/31 |
| Waived | A waiver condition is documented | Janeway: urinary retention, saddle anesthesia |
| Exception met | A named exception applies | Dax: prior MRI, but symptoms materially changed |
| Not met | The record shows it isn't met | Sulu: "x 3 wks" vs 6 required |
| Unclear | Proof missing, unreadable, or from a source the policy rejects | Scott: PT only patient-reported |

Two fixed rules: **Unclear never counts as Met**, and **a patient's own report never counts as documentation** when the policy asks for documentation.

Each failed criterion is also tagged **fixable by documents** (it would pass if the right paper arrived) or **clinical** (the record already shows it fails, so no document will fix it).

**Decision logic**, applied in order:

1. Any consistency check fails → **Needs correction**
2. Any criterion Not met and tagged clinical → **Clinical review**, with any document gaps listed for the nurse (case 3: chasing PT notes won't fix 3 weeks of pain)
3. Any criterion Unclear or fixable by documents → **Awaiting documents**, request sent automatically (cases 2, 12, 13)
4. Every criterion Met, Waived or Exception met, each above the confidence threshold → **Ready to submit** (cases 1, 05, 07, 09, 14, 22, 23)

### 8. Submission

| Channel | Insurers | How |
| --- | --- | --- |
| API | Federation, Vulcan, Klingon, Bajoran | System submits, verifies receipt, retries on failure (3% today), stores the tracking number |
| Portal | Ferengi, Andorian | Coordinator task with the packet pre-filled and documents in upload order; v2 adds browser automation |

Attachments follow each policy's submission section (e.g. RAD-114: latest office note + conservative-treatment documentation). Orders marked urgent are sent with the insurer's urgent flag.

### 9. Tracking and decision

- **Status checks:** API insurers polled on a schedule; portal insurers checked by a daily task. No more manual checks across six sites.
- **Approved:** approval number, CPT and dates written to Epic; scheduling notified.
- **More info requested:** the insurer's list becomes the evidence to collect; back to Collecting evidence.
- **Denied:** to the nurse with the denial reason and a draft appeal (criteria table, citations, the policy text it relies on). Denial reasons feed the rules backlog.
- **Scan watch:** no decision 24 hours before the scan → alert scheduling to hold or move the slot.

## Rule engine (configurable)

Rules admins turn each insurer policy into a structured rule that runs at runtime with no code change. The AI only extracts facts from documents. The pass/fail decision is deterministic, so the same facts always give the same answer and every result is auditable.

### What a rule matches on

A rule applies when all of its match fields fit the order. When several rules match, the most specific wins (plan beats insurer). Two rules equally specific is a publishing error.

| Match field | Examples | Why it's needed |
| --- | --- | --- |
| Insurer | Federation Health, Ferengi Benefit Group | Every case |
| Plan or plan type | Commercial HMO, EPO, PPO, "all" | MSK-207 applies to commercial HMO only |
| CPT codes or range | 72148, 72149, 72158; 73721 to 73723 | Every policy lists CPTs |
| Setting | Outpatient, inpatient, observation, ED | RAD-114 covers outpatient only (case 21) |
| Network | In network, out of network | BHP-UM-01 applies in network |
| Effective dates | 01/01/2026 to open | Policies change; old orders keep the old version |

### What a rule contains

| Part | Contents | Example |
| --- | --- | --- |
| Approval required | Yes / No | BHP-UM-01: CT → No |
| Criteria group | ALL of, ANY of, or N of | RAD-114 2a to 2d: ALL; VSM-NEU-12: ANY one of (a) to (f) |
| Criterion | Fact + operator + value + lookback + accepted sources + failure class | Conservative treatment ≥ 6 weeks, within 6 months, sources: PT notes, clinic notes; failure class: fixable by documents |
| Waivers | Conditions, and which criteria each waives | RAD-114 §3 red flags waive 2a to 2c, not 2d |
| Exceptions | A condition that turns one criterion's fail into a pass | RAD-114 2d: "unless symptoms have materially changed" |
| Exclusions | Conditions that mean not medically necessary | VSM-NEU-12: uncomplicated migraine with normal exam |
| Submission | Channel, required attachments, urgent flag, whether a denied request can be amended | MSK-207: portal only; incomplete requests denied and can't be amended |
| Source | Policy PDF, page, version | Shown to nurses next to each result |

### Fact catalog

Criteria refer to facts from a shared catalog, so one extractor serves many insurers. Admins can add a fact by giving it a name, a type, and extraction instructions.

| Fact | Type | Used by |
| --- | --- | --- |
| symptom\_duration\_weeks | number + onset date | RAD-114, MSK-207, IMG-330 |
| conservative\_treatment | list of {type, start, end, visits, response, source kind} | RAD-114, MSK-207, IMG-330 |
| xray\_same\_region | date, side | RAD-114, MSK-207, IMG-330 |
| prior\_mri\_same\_region | date, side | all MRI policies |
| symptoms\_materially\_changed | yes/no + quote | RAD-114 2d |
| red\_flags | list from a set: cauda equina, progressive deficit, infection, malignancy, trauma, dislocation, instability, locked knee | RAD-114, MSK-207, IMG-330 |
| neuro\_exam | normal/abnormal + findings | VSM-NEU-12 |
| biopsy\_proven\_malignancy | yes/no + pathology report date | KA-ONC-04 |
| nodule\_size\_mm | number | KA-ONC-04 |

### Example: Federation Health RAD-114

```json
{
  "policy": "RAD-114", "version": 3, "effective": "2026-01-01",
  "match": {"insurer": "Federation Health", "plan": "*", "cpt": ["72148","72149","72158"], "setting": ["outpatient"]},
  "approval_required": true,
  "criteria": {"all": [
    {"id": "2a", "fact": "symptom_duration_weeks", "op": ">=", "value": 6, "fail_class": "clinical"},
    {"id": "2b", "fact": "conservative_treatment.total_weeks", "op": ">=", "value": 6, "lookback_months": 6,
     "sources": ["pt_note","clinic_note","med_list"], "reject": ["patient_reported"], "fail_class": "documents"},
    {"id": "2c", "fact": "xray_same_region", "op": "exists", "fail_class": "documents"},
    {"id": "2d", "fact": "prior_mri_same_region", "op": "not_within_months", "value": 12,
     "exception": {"fact": "symptoms_materially_changed", "op": "==", "value": true}, "fail_class": "clinical"}
  ]},
  "waivers": [{"when": {"fact": "red_flags", "op": "any_of", "value": ["cauda_equina","progressive_deficit","infection","malignancy","trauma"]},
               "waives": ["2a","2b","2c"]}],
  "submission": {"channel": "api", "attachments": ["latest_office_note","conservative_treatment_docs"], "amend_after_denial": true}
}
```

### Authoring, testing, versioning

1. Admin uploads the insurer's policy PDF. AI drafts the rule; the admin edits it in a form, not in JSON.
2. **Test before publish:** the rule runs against every library case that matches it, plus the last 30 days of real orders in shadow. The admin sees which decisions would change. Publishing is blocked if a pinned test case changes result.
3. Every published version is kept. Each order stores the version it was checked against, so a decision can be explained months later.
4. **Rule gaps are a queue:** every Rule gap order (case 19) and every denial reason opens a task for the rules admin.

## Handoff after a coordinator fix (configurable)

When a coordinator resolves Awaiting documents or Needs correction, the order always goes back through Evaluating. The coordinator never marks a criterion as met; they supply the paper and the system decides. What is configurable is what happens after a clean re-check.

| Mode | After the re-check passes | Use when |
| --- | --- | --- |
| Straight to submission | Ready to submit, no nurse | Default once the pilot shows auto-submit is accurate |
| Nurse sign-off | Clinical review, marked "confirm only" with the change highlighted | Pilot period; high-cost studies; insurers that deny and don't allow amendment |
| Nurse if anything changed beyond the gap | Straight to submission if only the missing item changed and every result is above the confidence threshold; otherwise nurse sign-off | Recommended steady state |

**Where it is set.** A routing policy table, one row per scope, most specific wins:

| Scope | Example setting |
| --- | --- |
| Global default | Nurse if anything changed beyond the gap |
| Insurer | Ferengi Benefit Group → nurse sign-off (incomplete requests denied, can't amend) |
| Study type | PET/CT → nurse sign-off |
| Failure type | Wrong-patient page (CO-4) → nurse sign-off; missing page (PP-3) → straight to submission |
| Hospital or department | Pilot site → nurse sign-off for the first 4 weeks |

If a re-check fails again, the order routes by the normal decision logic. An order that loops through Awaiting documents three times goes to the nurse automatically.

## Other configurable modules

Besides the rule engine and the handoff, ten settings will differ by insurer, hospital or rollout stage. Making them configurable lets Halcyon turn automation up gradually without a release.

| Module | What's configurable | Proposed default | Why |
| --- | --- | --- | --- |
| Automation level | Auto-submit on or off per insurer, study and hospital; shadow mode (system decides, people still do the work) | Shadow mode for 2 weeks, then auto-submit for API insurers | Trust is earned per insurer and per study |
| Confidence thresholds | Minimum confidence per field (CPT, side, dates) and per criterion before it counts as Met | High for side and identity; medium for durations | A wrong side is a safety issue; a duration a week off rarely changes the outcome |
| Nurse audit sample | Share of auto-submitted orders a nurse spot-checks afterwards | 20% in month 1, falling to 5% | Measures auto-submit accuracy and catches drift |
| Time-risk policy | Each insurer's usual turnaround; when an order turns At risk; when to suggest releasing the slot; SLA per status | At risk when the scan is inside the insurer's turnaround + 1 day | Cancelled scans are the real cost |
| Outside-records requests | Template and channel per clinic (fax, Care Everywhere), follow-up timing, when to escalate to a phone call | Re-request after 24 hours, call after 48 | 22% of packets are missing something |
| Submission adapters | Per insurer: API, portal task, or browser automation; retries; receipt check | API where available; portal as a coordinator task | 4 of 6 insurers have an API; portals change without notice |
| Status tracking | How often each insurer is checked, and by what channel | API every 4 hours; portal once a day | Replaces manual checks on six sites |
| Queue assignment | Round robin, by hospital, by insurer, or by skill; claim and lock rules | By hospital, claim to work | 14 hospitals with local teams |
| Notifications | Who gets told what: ordering doctor (In Basket), scheduling, patient; when | Doctor for side errors and clinical review; scheduling for slot risk | Fixes often need the doctor's office |
| Models | Which approved GCP model runs extraction, classification and appeal drafting; prompt versions | Halcyon's approved models only | PHI stays in Halcyon's GCP project |

All settings are versioned like rules, and every order records the settings it ran under.

## Test case coverage

The 23 cases (3 from Ode, 20 generated) are the acceptance suite. v1 ships only when every case reaches its expected status with the expected reason. Each new rule version is replayed against them.

| Case | Packet | Checks it exercises | Expected status |
| --- | --- | --- | --- |
| 1 Kirk | Lumbar, Federation, clean EHR | Criteria all Met | Ready to submit (API) |
| 2 Scott | Knee, Ferengi, fax missing p.4 | PP-3, PP-4, patient-reported rule, no-amend | Awaiting documents |
| 3 Sulu | Shoulder, Andorian, 3-line order | Criteria Not met, clinical | Clinical review |
| 4 Janeway | Lumbar, Federation, urgent | Red-flag waiver | Ready to submit (API, urgent) |
| 5 Chakotay | Knee, Ferengi, upside-down fax | PP-1 | Ready to submit (portal) |
| 6 Torres | Shoulder, Andorian | Repeat MRI inside 12 months, no exception | Clinical review |
| 7 Tuvok | Brain MRI, Vulcan | ANY-of criteria | Ready to submit (API) |
| 8 Paris | Brain MRI, Vulcan | Exclusion applies | Clinical review |
| 9 Picard | PET/CT, Klingon, fax out of order | PP-4 (order differs, still complete) | Ready to submit (API) |
| 10 Riker | PET/CT, Klingon | Size threshold, no biopsy | Clinical review |
| 11 Troi | CT, Bajoran | Approval check: not required | Not required |
| 12 Crusher | Knee, Ferengi, blank page | PP-2 | Awaiting documents |
| 13 La Forge | Lumbar, Federation, degraded fax | PP-5 | Awaiting documents |
| 14 Worf | Shoulder, Andorian, handwritten | Dislocation waiver, handwriting | Ready to submit (portal) |
| 15 Nog | Lumbar, Federation | MA-3, wrong-patient page | Needs correction |
| 16 Yar | Lumbar, Federation | CV-2 existing approval | Approved (linked) |
| 17 O'Brien | Knee, Ferengi, sideways page | PP-1, CO-1 side mismatch | Needs correction |
| 18 Sisko | Lumbar, insurer changed | CV-1 eligibility, card image | Needs correction |
| 19 Kira | Lumbar, Bajoran | No criteria in library | Rule gap |
| 20 Odo | All-blank fax | PP-2 whole document | Unreadable |
| 21 Quark | Lumbar, Federation, inpatient | Setting match field | Not required |
| 22 Bashir | Shoulder, Andorian, messy cursive | Handwriting extraction | Ready to submit (portal) |
| 23 Dax | Lumbar, Federation, repeat MRI | Exception met + red flag | Ready to submit (API, urgent) |

Cases 7 to 11, 18 and 19 use rules for Vulcan, Klingon and Bajoran written for this test set; they are not from Halcyon.

## Rollout and open questions

Roll out in three phases at one hospital, MRI only, before expanding.

1. **Shadow (2 weeks):** the pipeline runs on every order and fills the review card, but nurses and coordinators work as today. Compare its decisions with theirs.
2. **Assist (4 weeks):** the worklist replaces the nurse queue. Intake checks and document requests are live. Ready-to-submit orders still get nurse sign-off.
3. **Auto-submit:** turn on straight-to-submission for API insurers whose shadow agreement was high, with a nurse audit sample. Then add portal insurers, then CT and PET, then more hospitals.

**Value to size in discovery.** Each order that skips nurse review saves 18 nurse-minutes; at 12,000 a month that is up to 3,600 nurse-hours a month if every order skipped it. Each order not denied for incomplete paperwork saves 25 minutes of nurse and doctor time plus a rescheduled scan. Ask Halcyon what a cancelled scan slot costs.

**Open questions for Halcyon**

- [ ] What share of the 12,000 a month need no approval at all, and how many are MRI vs CT vs PET?
- [ ] Where do faxes land today (eFax, Epic Media), and can we read the Epic order feed and write the auth status back?
- [ ] Which eligibility service does Halcyon use, and is it real time?
- [ ] What causes the 5% wrong "approval needed" calls: plan differences, outdated rules, or misread orders?
- [ ] Does Halcyon keep its own copy of insurer policies today, and who updates it?
- [ ] What is the nurses' tolerance for auto-submits: which studies or insurers must always have a nurse?
- [ ] What does a cancelled or rebooked scan cost, and how often does it happen today?
- [ ] Which GCP models are approved for PHI, and what are the rules for logging prompts and outputs?
