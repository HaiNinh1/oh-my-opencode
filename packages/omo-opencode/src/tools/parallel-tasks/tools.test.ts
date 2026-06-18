declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import { resolveAllTasks } from "./task-resolver"
import type { ParallelTaskItem, ParallelTasksToolOptions } from "./types"
import type { ParentContext } from "../delegate-task/executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"

describe("parallel_tasks resolveAllTasks — category vs subagent_type", () => {
	let connectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let providerModelsSpy: ReturnType<typeof spyOn> | undefined
	let hasConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let hasProviderModelsSpy: ReturnType<typeof spyOn> | undefined

	beforeEach(() => {
		mock.restore()
		connectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
		providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
		hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(false)
		hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
	})

	afterEach(() => {
		connectedProvidersSpy?.mockRestore()
		providerModelsSpy?.mockRestore()
		hasConnectedProvidersSpy?.mockRestore()
		hasProviderModelsSpy?.mockRestore()
	})

	const createMockOptions = (overrides: Partial<ParallelTasksToolOptions> = {}): ParallelTasksToolOptions => {
		const client = {
			app: {
				agents: async () => ({
					data: [{ name: "explore", mode: "subagent" }],
				}),
			},
			config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
		}
		return unsafeTestValue({
			manager: {},
			client,
			directory: "/tmp/test",
			userCategories: {},
			...overrides,
		})
	}

	const parentContext: ParentContext = {
		sessionID: "parent-session",
		messageID: "parent-message",
		agent: "sisyphus",
	}

	test("category-only item resolves via the category path", async () => {
		//#given
		const items: ParallelTaskItem[] = [
			{ description: "Impl task", prompt: "do work", load_skills: [], category: "deep" },
		]
		const options = createMockOptions({ userCategories: { deep: { model: "openai/gpt-5.4" } } })

		//#when
		const results = await resolveAllTasks(items, options, parentContext)

		//#then
		expect(results.length).toBe(1)
		expect(results[0].error).toBeUndefined()
		expect(results[0].agentToUse).toBeDefined()
		expect(results[0].args?.category).toBe("deep")
		expect(results[0].args?.subagent_type).toBeUndefined()
	})

	test("subagent_type-only item resolves via the subagent path", async () => {
		//#given
		const items: ParallelTaskItem[] = [
			{ description: "Research task", prompt: "search", load_skills: [], subagent_type: "explore" },
		]
		const options = createMockOptions()

		//#when
		const results = await resolveAllTasks(items, options, parentContext)

		//#then
		expect(results.length).toBe(1)
		expect(results[0].error).toBeUndefined()
		expect(results[0].agentToUse).toBe("explore")
		expect(results[0].args?.subagent_type).toBe("explore")
		expect(results[0].args?.category).toBeUndefined()
	})

	test("item with BOTH category and subagent_type errors", async () => {
		//#given
		const items: ParallelTaskItem[] = [
			{ description: "Bad task", prompt: "x", load_skills: [], category: "deep", subagent_type: "explore" },
		]
		const options = createMockOptions({ userCategories: { deep: { model: "openai/gpt-5.4" } } })

		//#when
		const results = await resolveAllTasks(items, options, parentContext)

		//#then
		expect(results[0].error).toBeDefined()
		expect(results[0].error).toContain("not both")
		expect(results[0].agentToUse).toBeUndefined()
	})

	test("item with NEITHER category nor subagent_type errors", async () => {
		//#given
		const items: ParallelTaskItem[] = [
			{ description: "Empty task", prompt: "x", load_skills: [] },
		]
		const options = createMockOptions()

		//#when
		const results = await resolveAllTasks(items, options, parentContext)

		//#then
		expect(results[0].error).toBeDefined()
		expect(results[0].error).toContain("either")
		expect(results[0].agentToUse).toBeUndefined()
	})
})
