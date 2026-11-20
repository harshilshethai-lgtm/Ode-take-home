export {
  CLOSED_DOCUMENT_STATUSES,
  CLOSED_ORDER_STATUSES,
  DEFAULT_FOLLOW_UP,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_INFO,
  DOCUMENT_TRANSITIONS,
  ORDER_STATUSES,
  ORDER_STATUS_INFO,
  ORDER_TRANSITIONS,
  correctionDestination,
  displayGroup,
  documentExits,
  isClosedOrder,
  isLegalDocumentTransition,
  isLegalOrderTransition,
  isOpenOrder,
  orderExits,
  ownerRole,
} from "./catalog";
export { decideEvaluating } from "./decision";
export type { DecisionRule, EvaluatingDecision, EvaluatingInput, EvaluatingStatus } from "./decision";
export { renderStatusCatalog } from "./readme";
export { resolveRouting } from "./routing";
export {
  CASE_FIXTURES,
  runCase,
  stubRuleEngine,
} from "./pipeline";
export type { CaseFixture, CaseRun, RuleLookupInput, RuleLookupResult } from "./pipeline";
export {
  SAVED_VIEWS,
  inSavedView,
  isOverSla,
  ownerLabel,
  pillTone,
  presentStatus,
  renderActions,
} from "./render";
export type { ActionInput, RenderedAction, SavedView, StatusPresentation } from "./render";
export { actionsFor, primaryActionLabel, statusLabel, viewerRole } from "./actions";
export {
  AuthState,
  createDocument,
  createOrder,
  documentsForOrder,
  documentsForPacket,
  quarantineWrongPatientPage,
  readAudits,
  readDocument,
  readEffects,
  readOrder,
  recordSideEffect,
  splitAndQuarantine,
  timeInStatusMs,
  transitionDocument,
  transitionOrder,
} from "./store";
export { toChannel, toOrderStatus, toStatusId } from "./legacy";
export { IllegalTransitionError, StaleVersionError, TransitionDeniedError } from "./types";
export type {
  Actor,
  ApprovalInput,
  AuditRow,
  Channel,
  CheckId,
  CriterionResult,
  CriterionResultCode,
  DisplayGroup,
  DocumentSnapshot,
  DocumentStatus,
  Effect,
  EvidenceRef,
  FailureClass,
  OrderSnapshot,
  OrderStatus,
  OwnerRole,
  PillTone,
  RoutingContext,
  RoutingMode,
  RoutingPolicy,
  RoutingRule,
  TransitionContext,
  UserRole,
} from "./types";
