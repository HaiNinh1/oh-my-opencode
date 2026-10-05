export * from "./types"
export * from "./constants"
export { readState, writeState, clearState, incrementIteration } from "./storage"

// Additive, no-op-safe optional completion-gate evidence validation.
// Does NOT alter loop control flow: text referencing no evidence passes
// unchanged. See evidence-validator.ts for the rationale.
export {
	parseEvidenceClaim,
	validateEvidence,
	validateEvidenceClaim,
} from "./evidence-validator"
export type {
	EvidenceClaim,
	EvidenceCriteriaCoverage,
	EvidenceReference,
	EvidenceValidationResult,
	EvidenceValidatorFs,
	ValidateEvidenceOptions,
} from "./evidence-validator"

export { createRalphLoopHook } from "./ralph-loop-hook"
export type { RalphLoopHook } from "./ralph-loop-hook"
