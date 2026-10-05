/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	parseEvidenceClaim,
	validateEvidence,
	validateEvidenceClaim,
	type EvidenceValidatorFs,
} from "./evidence-validator"

describe("parseEvidenceClaim", () => {
	test("#given text with no evidence references #then returns undefined", () => {
		// #given
		const text = `Agent: oracle\n\n<promise>VERIFIED</promise>`

		// #when
		const claim = parseEvidenceClaim(text)

		// #then
		expect(claim).toBeUndefined()
	})

	test("#given empty text #then returns undefined", () => {
		expect(parseEvidenceClaim("")).toBeUndefined()
		expect(parseEvidenceClaim("   \n\t ")).toBeUndefined()
	})

	test("#given an <artifact> tag #then parses the path", () => {
		// #given
		const text = `done <artifact>.omo/evidence/tests.log</artifact>`

		// #when
		const claim = parseEvidenceClaim(text)

		// #then
		expect(claim?.artifacts).toEqual([{ path: ".omo/evidence/tests.log" }])
	})

	test("#given a self-closing artifact tag with path attr #then parses the path", () => {
		// #given
		const text = `done <artifact path="reports/qa.json" />`

		// #when
		const claim = parseEvidenceClaim(text)

		// #then
		expect(claim?.artifacts).toEqual([{ path: "reports/qa.json" }])
	})

	test("#given duplicate artifact paths #then de-duplicates", () => {
		// #given
		const text = `<artifact>a.log</artifact> and again <artifact>a.log</artifact>`

		// #when
		const claim = parseEvidenceClaim(text)

		// #then
		expect(claim?.artifacts).toEqual([{ path: "a.log" }])
	})

	test("#given a criteria_coverage tag #then parses pass/total", () => {
		// #given
		const text = `<criteria_coverage>3/3</criteria_coverage>`

		// #when
		const claim = parseEvidenceClaim(text)

		// #then
		expect(claim?.criteriaCoverage).toEqual({ passCount: 3, totalCriteria: 3 })
		expect(claim?.artifacts).toEqual([])
	})
})

describe("validateEvidenceClaim", () => {
	const repoRoot = "/repo"

	function fakeFs(files: Record<string, number>): EvidenceValidatorFs {
		// Normalize separators and strip any leading drive letter so the
		// resolved absolute paths (e.g. "C:/repo/...") match the test keys
		// ("/repo/...") cross-platform.
		const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")
		const known = new Map(Object.entries(files).map(([k, v]) => [normalize(k), v]))
		return {
			existsSync: (path) => known.has(normalize(path)),
			statSync: (path) => {
				const size = known.get(normalize(path))
				if (size === undefined) throw new Error("ENOENT")
				return { size }
			},
		}
	}

	test("#given undefined claim #then passes as no-op", () => {
		// #when
		const result = validateEvidenceClaim(undefined, { repoRoot })

		// #then
		expect(result).toEqual({ ok: true, reasons: [], hadEvidence: false })
	})

	test("#given empty claim #then passes as no-op", () => {
		// #when
		const result = validateEvidenceClaim({ artifacts: [] }, { repoRoot })

		// #then
		expect(result.ok).toBe(true)
		expect(result.hadEvidence).toBe(false)
	})

	test("#given an existing non-empty artifact #then passes", () => {
		// #given
		const fs = fakeFs({ "/repo/.omo/evidence/tests.log": 42 })

		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [{ path: ".omo/evidence/tests.log" }] },
			{ repoRoot, fs },
		)

		// #then
		expect(result.ok).toBe(true)
		expect(result.hadEvidence).toBe(true)
		expect(result.reasons).toEqual([])
	})

	test("#given a missing artifact #then fails with reason", () => {
		// #given
		const fs = fakeFs({})

		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [{ path: "missing.log" }] },
			{ repoRoot, fs },
		)

		// #then
		expect(result.ok).toBe(false)
		expect(result.reasons[0]).toContain("does not exist")
	})

	test("#given an empty artifact #then fails with reason", () => {
		// #given
		const fs = fakeFs({ "/repo/empty.log": 0 })

		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [{ path: "empty.log" }] },
			{ repoRoot, fs },
		)

		// #then
		expect(result.ok).toBe(false)
		expect(result.reasons[0]).toContain("empty")
	})

	test("#given an absolute artifact path #then resolves without repoRoot join", () => {
		// #given
		const fs = fakeFs({ "/abs/evidence.log": 10 })

		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [{ path: "/abs/evidence.log" }] },
			{ repoRoot, fs },
		)

		// #then
		expect(result.ok).toBe(true)
	})

	test("#given complete criteria coverage #then passes", () => {
		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [], criteriaCoverage: { passCount: 5, totalCriteria: 5 } },
			{ repoRoot },
		)

		// #then
		expect(result.ok).toBe(true)
		expect(result.hadEvidence).toBe(true)
	})

	test("#given incomplete criteria coverage #then fails with reason", () => {
		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [], criteriaCoverage: { passCount: 2, totalCriteria: 5 } },
			{ repoRoot },
		)

		// #then
		expect(result.ok).toBe(false)
		expect(result.reasons[0]).toContain("incomplete")
	})

	test("#given zero total criteria #then fails with reason", () => {
		// #when
		const result = validateEvidenceClaim(
			{ artifacts: [], criteriaCoverage: { passCount: 0, totalCriteria: 0 } },
			{ repoRoot },
		)

		// #then
		expect(result.ok).toBe(false)
		expect(result.reasons[0]).toContain("greater than zero")
	})

	test("#given multiple failures #then collects all reasons", () => {
		// #given
		const fs = fakeFs({ "/repo/empty.log": 0 })

		// #when
		const result = validateEvidenceClaim(
			{
				artifacts: [{ path: "missing.log" }, { path: "empty.log" }],
				criteriaCoverage: { passCount: 1, totalCriteria: 3 },
			},
			{ repoRoot, fs },
		)

		// #then
		expect(result.ok).toBe(false)
		expect(result.reasons).toHaveLength(3)
	})
})

describe("validateEvidence (parse + validate, no-op-safe)", () => {
	const testDir = join(tmpdir(), `ralph-evidence-validator-${Date.now()}`)

	beforeEach(() => {
		if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test("#given oracle text with no evidence #then no-op pass (behavior unchanged)", () => {
		// #given
		const text = `Agent: oracle\n\n<promise>VERIFIED</promise>`

		// #when
		const result = validateEvidence(text, { repoRoot: testDir })

		// #then
		expect(result.ok).toBe(true)
		expect(result.hadEvidence).toBe(false)
	})

	test("#given oracle text referencing a real artifact #then validates it on disk", () => {
		// #given
		const artifactPath = join(testDir, "evidence.log")
		writeFileSync(artifactPath, "all 47 tests passed\n")
		const text = `Agent: oracle\n\n<promise>VERIFIED</promise>\n<artifact>evidence.log</artifact>\n<criteria_coverage>3/3</criteria_coverage>`

		// #when
		const result = validateEvidence(text, { repoRoot: testDir })

		// #then
		expect(result.ok).toBe(true)
		expect(result.hadEvidence).toBe(true)
	})

	test("#given oracle text referencing a missing artifact #then fails", () => {
		// #given
		const text = `Agent: oracle\n\n<promise>VERIFIED</promise>\n<artifact>nope.log</artifact>`

		// #when
		const result = validateEvidence(text, { repoRoot: testDir })

		// #then
		expect(result.ok).toBe(false)
		expect(result.hadEvidence).toBe(true)
		expect(result.reasons[0]).toContain("does not exist")
	})
})
