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
