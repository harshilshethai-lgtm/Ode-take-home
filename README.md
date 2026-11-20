# Ode-take-home

Halcyon Health prior-auth tracker prototype (Ode FDPM take-home). Spec: [`docs/PRD.md`](docs/PRD.md).

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # test cases + decision logic
npm run typecheck
```

## What's built

- **Worklist** (`/`): one line per imaging order, sorted by scan date. Saved views per role, quick filters, search,
  per-row and bulk assignment, time risk, time-in-status vs SLA.
- **Case view** (`/case/:id`): placeholder. Next up: parsed record on the left, source PDFs on the right.

## Test cases

Fixtures live in `fixtures/`. Each case is an input PDF, an answer key, and the insurer rule it runs against.

| Case | Input | Answer key | Rule |
| --- | --- | --- | --- |
| 1 Kirk, lumbar MRI | `case-1-kirk/input.pdf` | `case-1-kirk/expected.json` (+ `expected-output.pdf`) | `rules/RAD-114.json` |

`src/domain/cases.test.ts` checks that Kirk's answer key matches the rule, that the deterministic decision logic
(`src/domain/decision.ts`) routes it to Ready to submit, and that it shows up correctly on the worklist.

Other worklist rows are seeded demo data from the PRD's expected-status table (names, MRNs and DOBs are invented).
The prototype runs on a fixed demo clock (`DEMO_NOW` in `src/data/orders.ts`) so scan dates stay consistent.

<!-- status-catalog:start -->
## Status catalog

Generated from the order and document transition maps. Do not edit by hand.

### Orders

- **Received** (`RECEIVED`): An order arrived from the Epic order feed, or a document arrived that created a new order line. Exits: PRE_PROCESSING, CANCELLED.
- **Pre-processing** (`PRE_PROCESSING`): Documents are being straightened, checked for blank or missing pages, and checked for readability. Exits: MATCHING, UNREADABLE, CANCELLED.
- **Unreadable** (`UNREADABLE`): Nothing usable can be read. The coordinator must get a clean copy. Exits: RECEIVED, CANCELLED.
- **Matching** (`MATCHING`): Linking the documents to a patient and an order, and checking every page belongs to that patient. Exits: COVERAGE_CHECK, UNMATCHED, NEEDS_CORRECTION, CANCELLED.
- **Unmatched** (`UNMATCHED`): No confident patient or order match. A coordinator must place it by hand. Exits: COVERAGE_CHECK, CANCELLED.
- **Coverage check** (`COVERAGE_CHECK`): Confirming the insurer is active on the scan date, and looking for an approval already on file. Exits: APPROVAL_CHECK, NEEDS_CORRECTION, APPROVED, CANCELLED.
- **Approval check** (`APPROVAL_CHECK`): The rule engine decides whether this insurer, plan, CPT and setting needs approval. Exits: COLLECTING_EVIDENCE, NOT_REQUIRED, RULE_GAP, CANCELLED.
- **Collecting evidence** (`COLLECTING_EVIDENCE`): Pulling records from Epic and extracting the facts each criterion needs. Exits: EVALUATING, AWAITING_DOCUMENTS, CANCELLED.
- **Awaiting documents** (`AWAITING_DOCUMENTS`): A records request has gone out, or a document is missing or unreadable. The coordinator owns the chase. Exits: COLLECTING_EVIDENCE, CLINICAL_REVIEW, CANCELLED.
- **Needs correction** (`NEEDS_CORRECTION`): Something conflicts and a person must fix it at the source. Exits: COVERAGE_CHECK, COLLECTING_EVIDENCE, CANCELLED.
- **Evaluating** (`EVALUATING`): Running the consistency checks, then the insurer's criteria, and deciding where the order goes. Exits: READY_TO_SUBMIT, CLINICAL_REVIEW, AWAITING_DOCUMENTS, NEEDS_CORRECTION, CANCELLED.
- **Clinical review** (`CLINICAL_REVIEW`): The paperwork is complete but the criteria aren't met or aren't certain, or a nurse must confirm a coordinator fix. Exits: READY_TO_SUBMIT, AWAITING_DOCUMENTS, CANCELLED.
- **Rule gap** (`RULE_GAP`): Approval is required, but the rule library has no criteria for this insurer and study. Exits: READY_TO_SUBMIT, CLINICAL_REVIEW, CANCELLED.
- **Ready to submit** (`READY_TO_SUBMIT`): The packet is built and is waiting to be sent. Exits: SUBMITTED, CANCELLED.
- **Submitted** (`SUBMITTED`): With the insurer. The system checks status on a schedule. Exits: APPROVED, DENIED, MORE_INFO_REQUESTED, CANCELLED.
- **More info requested** (`MORE_INFO_REQUESTED`): The insurer asked for more documentation before deciding. Exits: COLLECTING_EVIDENCE, CANCELLED.
- **Denied** (`DENIED`): The insurer said no. The nurse decides whether to appeal. Exits: APPEAL, CLOSED_DENIED, CANCELLED.
- **Appeal** (`APPEAL`): An appeal or peer-to-peer review is in progress. Exits: APPROVED, CLOSED_DENIED, CANCELLED.
- **Approved** (`APPROVED`): An approval covers the scan. Exits: (none).
- **Not required** (`NOT_REQUIRED`): No approval is needed. Exits: (none).
- **Closed denied** (`CLOSED_DENIED`): Final denial. Scheduling has been told. Exits: (none).
- **Cancelled** (`CANCELLED`): The order won't go ahead. Exits: (none).

### Documents

- **Received** (`RECEIVED`): File arrived from the fax inbox, Epic Media, or outside records. Exits: PRE_PROCESSED, UNREADABLE.
- **Pre-processed** (`PRE_PROCESSED`): Pages straightened, blank pages flagged, every page labelled by type. Exits: ATTACHED, UNMATCHED, QUARANTINED.
- **Unreadable** (`UNREADABLE`): Nothing usable. Exits: SUPERSEDED.
- **Unmatched** (`UNMATCHED`): Can't be tied to a patient or order. Exits: ATTACHED, QUARANTINED.
- **Attached** (`ATTACHED`): Linked to an order; facts extracted. Exits: SUPERSEDED, QUARANTINED.
- **Quarantined** (`QUARANTINED`): Holds another patient's information. Exits: (none).
- **Superseded** (`SUPERSEDED`): Replaced; kept for audit only. Exits: (none).
<!-- status-catalog:end -->
