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
(`src/domain/decision.ts`) submits it to the insurer, and that it shows up correctly on the worklist.

Other worklist rows are seeded demo data from the PRD's expected-status table (names, MRNs and DOBs are invented).
The prototype runs on a fixed demo clock (`DEMO_NOW` in `src/data/orders.ts`) so scan dates stay consistent.

<!-- status-catalog:start -->
## Status catalog

Generated from the order and document transition maps. Do not edit by hand.

### Orders

- **Processing** (`PROCESSING`): The pipeline is working on the order. No person needs to act. Exits: NEEDS_ADMIN_REVIEW, NEEDS_CLINICAL_REVIEW, SUBMITTED, APPROVED, NOT_REQUIRED, CANCELLED.
- **Needs admin review** (`NEEDS_ADMIN_REVIEW`): Paperwork or logistics a coordinator must handle. Exits: PROCESSING, SUBMITTED, APPROVED, CANCELLED.
- **Needs clinical review** (`NEEDS_CLINICAL_REVIEW`): A clinical judgement, or a decision only a nurse makes. Exits: PROCESSING, SUBMITTED, APPROVED, DENIED, CANCELLED.
- **Submitted** (`SUBMITTED`): With the insurer, waiting for a decision. Exits: APPROVED, NEEDS_ADMIN_REVIEW, NEEDS_CLINICAL_REVIEW, CANCELLED.
- **Approved** (`APPROVED`): Approval written to Epic. Exits: PROCESSING.
- **Not required** (`NOT_REQUIRED`): No approval needed for this insurer, CPT and setting. Exits: (none).
- **Denied** (`DENIED`): Final denial. The nurse chose not to appeal, or the appeal was lost. Exits: (none).
- **Cancelled** (`CANCELLED`): The order was cancelled in Epic, or a person withdrew it. Exits: (none).

### Documents

- **Received** (`RECEIVED`): File arrived from the fax inbox, Epic Media, or outside records. Exits: PRE_PROCESSED, UNREADABLE.
- **Pre-processed** (`PRE_PROCESSED`): Pages straightened, blank pages flagged, every page labelled by type. Exits: ATTACHED, UNMATCHED, QUARANTINED.
- **Unreadable** (`UNREADABLE`): Nothing usable. Exits: SUPERSEDED.
- **Unmatched** (`UNMATCHED`): Can't be tied to a patient or order. Exits: ATTACHED, QUARANTINED.
- **Attached** (`ATTACHED`): Linked to an order; facts extracted. Exits: SUPERSEDED, QUARANTINED.
- **Quarantined** (`QUARANTINED`): Holds another patient's information. Exits: (none).
- **Superseded** (`SUPERSEDED`): Replaced; kept for audit only. Exits: (none).
<!-- status-catalog:end -->
