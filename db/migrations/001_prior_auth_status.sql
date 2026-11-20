-- Prior-auth status, optimistic version, criterion results and the audit log.
-- Status columns are written only while prior_auth.transition = 'on', which
-- transitionOrder / transitionDocument set inside their transaction.

CREATE TYPE order_status AS ENUM (
  'RECEIVED',
  'PRE_PROCESSING',
  'UNREADABLE',
  'MATCHING',
  'UNMATCHED',
  'COVERAGE_CHECK',
  'APPROVAL_CHECK',
  'COLLECTING_EVIDENCE',
  'AWAITING_DOCUMENTS',
  'NEEDS_CORRECTION',
  'EVALUATING',
  'CLINICAL_REVIEW',
  'RULE_GAP',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'MORE_INFO_REQUESTED',
  'DENIED',
  'APPEAL',
  'APPROVED',
  'NOT_REQUIRED',
  'CLOSED_DENIED',
  'CANCELLED'
);

CREATE TYPE document_status AS ENUM (
  'RECEIVED',
  'PRE_PROCESSED',
  'UNREADABLE',
  'UNMATCHED',
  'ATTACHED',
  'QUARANTINED',
  'SUPERSEDED'
);

CREATE TYPE criterion_result AS ENUM ('MET', 'WAIVED', 'EXCEPTION_MET', 'NOT_MET', 'UNCLEAR');
CREATE TYPE failure_class AS ENUM ('documents', 'clinical');

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  status order_status NOT NULL,
  status_version integer NOT NULL DEFAULT 1 CHECK (status_version > 0),
  confirm_only boolean NOT NULL DEFAULT false,
  linked_approval boolean NOT NULL DEFAULT false,
  channel text,
  blocking_checks text[] NOT NULL DEFAULT '{}',
  fixable_gaps boolean NOT NULL DEFAULT false,
  awaiting_documents_entries integer NOT NULL DEFAULT 0 CHECK (awaiting_documents_entries >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES orders (id),
  status document_status NOT NULL,
  status_version integer NOT NULL DEFAULT 1 CHECK (status_version > 0),
  parent_document_id uuid REFERENCES documents (id),
  page_numbers integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- An order's status is never derived from its documents.
CREATE TABLE criterion_results (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id),
  criterion_id text NOT NULL,
  result criterion_result NOT NULL,
  failure_class failure_class,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  document_id uuid REFERENCES documents (id),
  page_number integer,
  quote text,
  CHECK (
    (result IN ('NOT_MET', 'UNCLEAR') AND failure_class IS NOT NULL)
    OR (result IN ('MET', 'WAIVED', 'EXCEPTION_MET') AND failure_class IS NULL)
  )
);

CREATE TABLE status_audit (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES orders (id),
  document_id uuid REFERENCES documents (id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  check_ids text[] NOT NULL DEFAULT '{}',
  criterion_results jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]',
  rule_version text,
  routing_policy_version text,
  CHECK ((order_id IS NOT NULL) OR (document_id IS NOT NULL))
);

CREATE INDEX status_audit_order_idx ON status_audit (order_id, occurred_at);
CREATE INDEX status_audit_document_idx ON status_audit (document_id, occurred_at);

CREATE OR REPLACE FUNCTION prior_auth_reject_direct_status_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.status_version IS DISTINCT FROM OLD.status_version THEN
    IF current_setting('prior_auth.transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'status changes must go through transitionOrder or transitionDocument'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_status_write
  BEFORE UPDATE OF status, status_version ON orders
  FOR EACH ROW
  EXECUTE FUNCTION prior_auth_reject_direct_status_write();

CREATE TRIGGER documents_status_write
  BEFORE UPDATE OF status, status_version ON documents
  FOR EACH ROW
  EXECUTE FUNCTION prior_auth_reject_direct_status_write();
