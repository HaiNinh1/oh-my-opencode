import { existsSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

/**
 * Additive, no-op-safe evidence validation for the ralph-loop completion gate.
 *
 * Inspired by the codex-side quality gate
 * (`packages/omo-codex/plugin/components/ulw-loop/src/quality-gate.ts`,
 * `validateQualityGate`), which refuses to accept a completion claim unless the
 * referenced evidence artifacts exist + are non-empty and the criteria coverage
 * is complete.
 *
 * This module is intentionally STANDALONE and OPTIONAL. It does NOT change the
 * ralph-loop control flow. The existing OMO loop completes on Oracle TEXT
 * detection (`<promise>VERIFIED</promise>` from the oracle agent); this helper
 * provides a machine-validated, additive check that callers MAY run before
 * accepting that text:
 *
 *   - If the verification text references NO evidence artifacts, validation
 *     passes unchanged (`{ ok: true }`) - behavior is identical to today.
 *   - If it DOES reference artifacts (and/or a criteria-coverage line), each
 *     referenced artifact must exist and be non-empty, and the coverage must be
 *     complete, otherwise validation reports `{ ok: false, reasons: [...] }`.
 *
 * Callers decide what to do with a failing result. The helper itself never
 * throws on missing evidence and never mutates loop state - keeping the
 * race-sensitive completion path untouched.
 */

/** Filesystem surface used by the validator (overridable for tests). */
export interface EvidenceValidatorFs {
	readonly existsSync: (path: string) => boolean
	readonly statSync: (path: string) => { readonly size: number }
}

export interface ValidateEvidenceOptions {
	/** Repo root used to resolve relative artifact paths. */
	readonly repoRoot: string
	/** Filesystem surface (defaults to node:fs). */
	readonly fs?: EvidenceValidatorFs
}

export interface EvidenceReference {
	/** Repo-relative or absolute path to the evidence artifact. */
	readonly path: string
}

export interface EvidenceCriteriaCoverage {
	readonly totalCriteria: number
	readonly passCount: number
}

export interface EvidenceClaim {
	readonly artifacts: readonly EvidenceReference[]
	readonly criteriaCoverage?: EvidenceCriteriaCoverage
}

export interface EvidenceValidationResult {
	readonly ok: boolean
	/** Human-readable reasons a non-empty list always implies `ok === false`. */
	readonly reasons: readonly string[]
	/** Whether the verification text referenced any evidence at all. */
	readonly hadEvidence: boolean
}

const ARTIFACT_TAG_PATTERN = /<artifact>([\s\S]*?)<\/artifact>/gi
const ARTIFACT_PATH_PATTERN = /<artifact\s+path\s*=\s*"([^"]+)"\s*\/?>/gi
const CRITERIA_COVERAGE_PATTERN = /<criteria_coverage>\s*(\d+)\s*\/\s*(\d+)\s*<\/criteria_coverage>/i

const defaultFs: EvidenceValidatorFs = {
	existsSync: (path) => existsSync(path),
	statSync: (path) => statSync(path),
}

/**
 * Parse evidence references out of a verification text block.
 *
 * Recognized, all OPTIONAL:
 *   - `<artifact>relative/or/abs/path</artifact>` (one path per tag)
 *   - `<artifact path="relative/or/abs/path" />`
 *   - `<criteria_coverage>passCount/totalCriteria</criteria_coverage>`
 *
 * Returns `undefined` when the text references no evidence at all, so callers
 * can treat "no evidence referenced" as the unchanged, no-op path.
 */
export function parseEvidenceClaim(text: string): EvidenceClaim | undefined {
	if (typeof text !== "string" || text.trim() === "") {
		return undefined
	}

	const artifacts: EvidenceReference[] = []
	const seen = new Set<string>()

	const addArtifact = (raw: string | undefined): void => {
		const path = raw?.trim()
		if (!path || seen.has(path)) {
			return
		}
		seen.add(path)
		artifacts.push({ path })
	}

	for (const match of text.matchAll(ARTIFACT_TAG_PATTERN)) {
		addArtifact(match[1])
	}
	for (const match of text.matchAll(ARTIFACT_PATH_PATTERN)) {
		addArtifact(match[1])
	}

	let criteriaCoverage: EvidenceCriteriaCoverage | undefined
	const coverageMatch = text.match(CRITERIA_COVERAGE_PATTERN)
	if (coverageMatch) {
		const passCount = Number.parseInt(coverageMatch[1] ?? "", 10)
		const totalCriteria = Number.parseInt(coverageMatch[2] ?? "", 10)
		if (Number.isFinite(passCount) && Number.isFinite(totalCriteria)) {
			criteriaCoverage = { passCount, totalCriteria }
		}
	}

	if (artifacts.length === 0 && criteriaCoverage === undefined) {
		return undefined
	}

	return { artifacts, criteriaCoverage }
}

function resolveArtifactPath(repoRoot: string, path: string): string {
	return isAbsolute(path) ? path : resolve(repoRoot, path)
}

/**
 * Validate a parsed evidence claim against the filesystem + coverage rules.
 *
 * A claim with no artifacts and no coverage is treated as "no evidence" and
 * passes. Each referenced artifact must exist and be non-empty; coverage, when
 * present, must be complete (`passCount >= totalCriteria`, totals positive).
 */
export function validateEvidenceClaim(
	claim: EvidenceClaim | undefined,
	options: ValidateEvidenceOptions,
): EvidenceValidationResult {
	if (
		claim === undefined ||
		(claim.artifacts.length === 0 && claim.criteriaCoverage === undefined)
	) {
		return { ok: true, reasons: [], hadEvidence: false }
	}

	const fs = options.fs ?? defaultFs
	const reasons: string[] = []

	for (const artifact of claim.artifacts) {
		const absolute = resolveArtifactPath(options.repoRoot, artifact.path)
		let size: number | undefined
		try {
			if (!fs.existsSync(absolute)) {
				reasons.push(`Evidence artifact does not exist: ${artifact.path}`)
				continue
			}
			size = fs.statSync(absolute).size
		} catch {
			reasons.push(`Evidence artifact is not readable: ${artifact.path}`)
			continue
		}
		if (size <= 0) {
			reasons.push(`Evidence artifact is empty: ${artifact.path}`)
		}
	}

	const coverage = claim.criteriaCoverage
	if (coverage !== undefined) {
		if (coverage.totalCriteria <= 0) {
			reasons.push("Criteria coverage totalCriteria must be greater than zero.")
		} else if (coverage.passCount < coverage.totalCriteria) {
			reasons.push(
				`Criteria coverage incomplete: ${coverage.passCount}/${coverage.totalCriteria} criteria passing.`,
			)
		}
	}

	return { ok: reasons.length === 0, reasons, hadEvidence: true }
}

/**
 * Convenience: parse + validate evidence referenced in a verification text.
 *
 * No-op-safe: text that references no evidence yields
 * `{ ok: true, reasons: [], hadEvidence: false }`, so wiring this in front of
 * the existing Oracle-text acceptance does not change behavior unless evidence
 * is explicitly referenced.
 */
export function validateEvidence(
	text: string,
	options: ValidateEvidenceOptions,
): EvidenceValidationResult {
	return validateEvidenceClaim(parseEvidenceClaim(text), options)
}
