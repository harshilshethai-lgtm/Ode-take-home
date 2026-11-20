-- Move stored orders onto the 8 statuses and a reason code.
-- status_audit.from_status and to_status stay text, so the old names remain readable.
-- After this migration the status column only accepts the 8 new values.

CREATE TYPE order_status_v2 AS ENUM (
  'PROCESSING',
  'NEEDS_ADMIN_REVIEW',
  'NEEDS_CLINICAL_REVIEW',
  'SUBMITTED',
  'APPROVED',
  'NOT_REQUIRED',
  'DENIED',
  'CANCELLED'
);

CREATE TYPE order_reason AS ENUM (
  'UNREADABLE_DOCUMENT',
  'NO_MATCH',
  'MISSING_DOCUMENTS',
  'SIDE_MISMATCH',
  'WRONG_PATIENT_PAGE',
  'INSURER_MISMATCH',
  'CPT_MISMATCH',
  'PORTAL_UPLOAD',
  'SUBMISSION_FAILED',
  'MORE_INFO_REQUESTED',
  'CRITERIA_NOT_MET',
  'RULE_GAP',
  'CONFIRM_AFTER_FIX',
  'REPEATED_REQUESTS',
  'DENIED_DECIDE_APPEAL',
  'INITIAL_REQUEST',
  'APPEAL',
  'NEW',
  'LINKED_EXISTING',
  'APPEAL_WON',
  'NOT_ON_PA_LIST',
  'SETTING_EXEMPT',
  'NO_APPEAL',
  'APPEAL_LOST',
  'EPIC_CANCELLED',
  'WITHDRAWN_BY_NURSE',
  'WITHDRAWN_BY_COORDINATOR',
  'SLOT_RELEASED'
);

CREATE TYPE processing_step AS ENUM (
  'INTAKE',
  'PAGE_CHECKS',
  'MATCHING',
  'COVERAGE',
  'RULES',
  'EVIDENCE',
  'EVALUATING',
  'SUBMITTING'
);

ALTER TABLE orders
  ADD COLUMN reason_code order_reason,
  ADD COLUMN reason_detail jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN processing_step processing_step,
  ADD COLUMN other_issues jsonb NOT NULL DEFAULT '[]';

UPDATE orders
SET
  processing_step = CASE status::text
    WHEN 'RECEIVED' THEN 'INTAKE'::processing_step
    WHEN 'PRE_PROCESSING' THEN 'PAGE_CHECKS'::processing_step
    WHEN 'MATCHING' THEN 'MATCHING'::processing_step
    WHEN 'COVERAGE_CHECK' THEN 'COVERAGE'::processing_step
    WHEN 'APPROVAL_CHECK' THEN 'RULES'::processing_step
    WHEN 'COLLECTING_EVIDENCE' THEN 'EVIDENCE'::processing_step
    WHEN 'EVALUATING' THEN 'EVALUATING'::processing_step
    WHEN 'READY_TO_SUBMIT' THEN CASE WHEN channel = 'portal' THEN NULL ELSE 'SUBMITTING'::processing_step END
    ELSE NULL
  END,
  reason_code = CASE status::text
    WHEN 'UNREADABLE' THEN 'UNREADABLE_DOCUMENT'::order_reason
    WHEN 'UNMATCHED' THEN 'NO_MATCH'::order_reason
    WHEN 'AWAITING_DOCUMENTS' THEN 'MISSING_DOCUMENTS'::order_reason
    WHEN 'MORE_INFO_REQUESTED' THEN 'MORE_INFO_REQUESTED'::order_reason
    WHEN 'NEEDS_CORRECTION' THEN CASE
      WHEN 'CO-1' = ANY (blocking_checks) THEN 'SIDE_MISMATCH'::order_reason
      WHEN 'MA-3' = ANY (blocking_checks) OR 'CO-4' = ANY (blocking_checks) THEN 'WRONG_PATIENT_PAGE'::order_reason
      WHEN 'CV-1' = ANY (blocking_checks) OR 'CO-5' = ANY (blocking_checks) THEN 'INSURER_MISMATCH'::order_reason
      WHEN 'CO-2' = ANY (blocking_checks) OR 'CO-3' = ANY (blocking_checks) THEN 'CPT_MISMATCH'::order_reason
      ELSE 'SIDE_MISMATCH'::order_reason
    END
    WHEN 'READY_TO_SUBMIT' THEN CASE WHEN channel = 'portal' THEN 'PORTAL_UPLOAD'::order_reason ELSE NULL END
    WHEN 'CLINICAL_REVIEW' THEN CASE
      WHEN confirm_only THEN 'CONFIRM_AFTER_FIX'::order_reason
      ELSE 'CRITERIA_NOT_MET'::order_reason
    END
    WHEN 'RULE_GAP' THEN 'RULE_GAP'::order_reason
    WHEN 'DENIED' THEN 'DENIED_DECIDE_APPEAL'::order_reason
    WHEN 'SUBMITTED' THEN 'INITIAL_REQUEST'::order_reason
    WHEN 'APPEAL' THEN 'APPEAL'::order_reason
    WHEN 'APPROVED' THEN CASE WHEN linked_approval THEN 'LINKED_EXISTING'::order_reason ELSE 'NEW'::order_reason END
    WHEN 'NOT_REQUIRED' THEN 'NOT_ON_PA_LIST'::order_reason
    WHEN 'CLOSED_DENIED' THEN 'NO_APPEAL'::order_reason
    WHEN 'CANCELLED' THEN 'EPIC_CANCELLED'::order_reason
    ELSE NULL
  END;

ALTER TABLE orders
  ALTER COLUMN status TYPE order_status_v2
  USING (
    CASE status::text
      WHEN 'RECEIVED' THEN 'PROCESSING'
      WHEN 'PRE_PROCESSING' THEN 'PROCESSING'
      WHEN 'MATCHING' THEN 'PROCESSING'
      WHEN 'COVERAGE_CHECK' THEN 'PROCESSING'
      WHEN 'APPROVAL_CHECK' THEN 'PROCESSING'
      WHEN 'COLLECTING_EVIDENCE' THEN 'PROCESSING'
      WHEN 'EVALUATING' THEN 'PROCESSING'
      WHEN 'READY_TO_SUBMIT' THEN CASE WHEN channel = 'portal' THEN 'NEEDS_ADMIN_REVIEW' ELSE 'PROCESSING' END
      WHEN 'UNREADABLE' THEN 'NEEDS_ADMIN_REVIEW'
      WHEN 'UNMATCHED' THEN 'NEEDS_ADMIN_REVIEW'
      WHEN 'AWAITING_DOCUMENTS' THEN 'NEEDS_ADMIN_REVIEW'
      WHEN 'NEEDS_CORRECTION' THEN 'NEEDS_ADMIN_REVIEW'
      WHEN 'MORE_INFO_REQUESTED' THEN 'NEEDS_ADMIN_REVIEW'
      WHEN 'CLINICAL_REVIEW' THEN 'NEEDS_CLINICAL_REVIEW'
      WHEN 'RULE_GAP' THEN 'NEEDS_CLINICAL_REVIEW'
      WHEN 'DENIED' THEN 'NEEDS_CLINICAL_REVIEW'
      WHEN 'SUBMITTED' THEN 'SUBMITTED'
      WHEN 'APPEAL' THEN 'SUBMITTED'
      WHEN 'APPROVED' THEN 'APPROVED'
      WHEN 'NOT_REQUIRED' THEN 'NOT_REQUIRED'
      WHEN 'CLOSED_DENIED' THEN 'DENIED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      ELSE 'PROCESSING'
    END
  )::order_status_v2;

DROP TYPE order_status;
ALTER TYPE order_status_v2 RENAME TO order_status;

ALTER TABLE orders
  ADD CONSTRAINT orders_reason_matches_status CHECK (
    (status = 'PROCESSING' AND reason_code IS NULL AND processing_step IS NOT NULL)
    OR (status = 'NEEDS_ADMIN_REVIEW' AND reason_code IN (
      'UNREADABLE_DOCUMENT', 'NO_MATCH', 'MISSING_DOCUMENTS', 'SIDE_MISMATCH', 'WRONG_PATIENT_PAGE',
      'INSURER_MISMATCH', 'CPT_MISMATCH', 'PORTAL_UPLOAD', 'SUBMISSION_FAILED', 'MORE_INFO_REQUESTED'
    ))
    OR (status = 'NEEDS_CLINICAL_REVIEW' AND reason_code IN (
      'CRITERIA_NOT_MET', 'RULE_GAP', 'CONFIRM_AFTER_FIX', 'REPEATED_REQUESTS', 'DENIED_DECIDE_APPEAL'
    ))
    OR (status = 'SUBMITTED' AND reason_code IN ('INITIAL_REQUEST', 'APPEAL'))
    OR (status = 'APPROVED' AND reason_code IN ('NEW', 'LINKED_EXISTING', 'APPEAL_WON'))
    OR (status = 'NOT_REQUIRED' AND reason_code IN ('NOT_ON_PA_LIST', 'SETTING_EXEMPT'))
    OR (status = 'DENIED' AND reason_code IN ('NO_APPEAL', 'APPEAL_LOST'))
    OR (status = 'CANCELLED' AND reason_code IN (
      'EPIC_CANCELLED', 'WITHDRAWN_BY_NURSE', 'WITHDRAWN_BY_COORDINATOR', 'SLOT_RELEASED'
    ))
  );
