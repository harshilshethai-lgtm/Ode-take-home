# Ode-take-home

Halcyon Health prior-auth tracker prototype (Ode FDPM take-home). Spec: [`docs/PRD.md`](docs/PRD.md).

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # test cases + decision logic
npm run typecheck
npm run e2e     # Playwright golden flows, citations, and layout checks
```

Production: [ode-platform-chi.vercel.app](https://ode-platform-chi.vercel.app). The same suite runs there with `E2E_BASE_URL=https://ode-platform-chi.vercel.app npm run e2e`.

## Demo script

The clock is fixed (Tue 11/10, 2:00 PM ET). Before each run, open the worklist and click **Reset demo data** so assignments and status edits from the last pass are gone.

1. **Worklist.** Start on the queue. The tabs split every case once (Coordinator, Nurse, Return to provider, In flight, With insurer, Closed). Their counts add up to All. A patient name opens that case in a new tab; the row itself stays in this tab.
2. **Kirk, no touch.** Open James T. Kirk. He is already Submitted. All 4 insurer criteria are Met. The member ID is tagged [epic]. The insurer timeline has a single submission line.
3. **Scott, records hold.** Open Montgomery Scott. Status is Chase records. Fax page 4 is the missing PT notes placeholder. The slot is Thu 11/12 and at risk, and there is no Submit action. Conservative care is Not met, Fixable with records. Click the fax p.3 citation: the viewer highlights “about six weeks”.
4. **Sulu, return to provider.** Open Hikaru Sulu. Status is Return to provider. The summary is the draft for Dr. McCoy (order an X-ray, continue PT, re-order at 6 weeks, release the 11/16 slot). Send draft is the action. Nothing says to chase an X-ray.
5. **Settings, rule version.** Open Settings, then Federation Health · RAD-114. The header shows the active version (revision and v number). Don't edit it. This step only shows which version Kirk ran against.
6. **Impact.** Open Pilot impact. The headline number is the same number as the last complete week on its chart, and both match the week fixture.

## What's built

- **Worklist** (`/`): one line per imaging order, sorted by scan date. Saved views per role, quick filters, search,
  per-row and bulk assignment, time risk, time-in-status vs SLA.
- **Case view** (`/case/:id`): checklist and order on the left, the source PDF on the right. Citations open the quoted page.

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
