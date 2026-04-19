import { describe, test, expect, beforeEach } from "bun:test"
import { HermesProxyState } from "./hermes-proxy-state"

describe("hermes-proxy-state", () => {
  beforeEach(() => {
    HermesProxyState.clearAll()
  })

  describe("#given no proxy state exists", () => {
    test("get returns undefined for unknown session", () => {
      // when
      const result = HermesProxyState.get("ses_unknown")

      // then
      expect(result).toBeUndefined()
    })

    test("hasTarget returns false for unknown session", () => {
      // when
      const result = HermesProxyState.hasTarget("ses_unknown")

      // then
      expect(result).toBe(false)
    })

    test("isPinned returns false for unknown session", () => {
      // when
      const result = HermesProxyState.isPinned("ses_unknown")

      // then
      expect(result).toBe(false)
    })

    test("clear on unknown session does not throw", () => {
      // when/then
      expect(() => HermesProxyState.clear("ses_unknown")).not.toThrow()
    })

    test("size returns 0", () => {
      // when/then
      expect(HermesProxyState.size()).toBe(0)
    })
  })

  describe("#given a proxy target is set", () => {
    const sessionID = "ses_hermes_123"
    const targetAgent = "sisyphus"

    beforeEach(() => {
      HermesProxyState.setTarget(sessionID, targetAgent)
    })

    test("get returns the target without child session", () => {
      // when
      const result = HermesProxyState.get(sessionID)

      // then
      expect(result).toEqual({ targetAgent: "sisyphus" })
      expect(result?.childSessionID).toBeUndefined()
    })

    test("hasTarget returns true", () => {
      // when/then
      expect(HermesProxyState.hasTarget(sessionID)).toBe(true)
    })

    test("isPinned returns false before child is pinned", () => {
      // when/then
      expect(HermesProxyState.isPinned(sessionID)).toBe(false)
    })

    test("size returns 1", () => {
      // when/then
      expect(HermesProxyState.size()).toBe(1)
    })

    test("duplicate setTarget does not overwrite existing target", () => {
      // when
      HermesProxyState.setTarget(sessionID, "atlas")

      // then
      expect(HermesProxyState.get(sessionID)?.targetAgent).toBe("sisyphus")
    })

    test("clear removes the proxy state", () => {
      // when
      HermesProxyState.clear(sessionID)

      // then
      expect(HermesProxyState.get(sessionID)).toBeUndefined()
      expect(HermesProxyState.hasTarget(sessionID)).toBe(false)
      expect(HermesProxyState.size()).toBe(0)
    })
  })

  describe("#given a child session is pinned", () => {
    const sessionID = "ses_hermes_456"
    const targetAgent = "atlas"
    const childSessionID = "ses_child_789"

    beforeEach(() => {
      HermesProxyState.setTarget(sessionID, targetAgent)
      HermesProxyState.pinChildSession(sessionID, childSessionID)
    })

    test("get returns target and child session", () => {
      // when
      const result = HermesProxyState.get(sessionID)

      // then
      expect(result).toEqual({
        targetAgent: "atlas",
        childSessionID: "ses_child_789",
      })
    })

    test("isPinned returns true", () => {
      // when/then
      expect(HermesProxyState.isPinned(sessionID)).toBe(true)
    })

    test("duplicate pinChildSession does not overwrite existing child", () => {
      // when
      HermesProxyState.pinChildSession(sessionID, "ses_other_child")

      // then
      expect(HermesProxyState.get(sessionID)?.childSessionID).toBe("ses_child_789")
    })
  })

  describe("#when pinChildSession is called without a target", () => {
    test("does nothing when no target exists", () => {
      // when
      HermesProxyState.pinChildSession("ses_no_target", "ses_child_orphan")

      // then
      expect(HermesProxyState.get("ses_no_target")).toBeUndefined()
      expect(HermesProxyState.size()).toBe(0)
    })
  })

  describe("#given multiple sessions exist", () => {
    beforeEach(() => {
      HermesProxyState.setTarget("ses_1", "sisyphus")
      HermesProxyState.setTarget("ses_2", "atlas")
      HermesProxyState.pinChildSession("ses_1", "ses_child_1")
    })

    test("size reflects all sessions", () => {
      // when/then
      expect(HermesProxyState.size()).toBe(2)
    })

    test("clearing one session does not affect others", () => {
      // when
      HermesProxyState.clear("ses_1")

      // then
      expect(HermesProxyState.get("ses_1")).toBeUndefined()
      expect(HermesProxyState.get("ses_2")).toEqual({ targetAgent: "atlas" })
      expect(HermesProxyState.size()).toBe(1)
    })

    test("clearAll removes all sessions", () => {
      // when
      HermesProxyState.clearAll()

      // then
      expect(HermesProxyState.size()).toBe(0)
      expect(HermesProxyState.get("ses_1")).toBeUndefined()
      expect(HermesProxyState.get("ses_2")).toBeUndefined()
    })
  })
})
