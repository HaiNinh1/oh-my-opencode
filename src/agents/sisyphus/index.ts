/**
 * Sisyphus agent — multi-model orchestrator.
 *
 * This directory contains model-specific prompt variants:
 * - default.ts: Base implementation for Claude and general models
 * - gemini.ts: Corrective overlays for Gemini's aggressive tendencies
 * - gpt-5-4.ts: Native GPT-5.4 prompt with block-structured guidance
 */

export { buildTaskManagementSection } from "./default";
export {
  buildGeminiToolMandate,
  buildGeminiDelegationOverride,
  buildGeminiVerificationOverride,
  buildGeminiIntentGateEnforcement,
  buildGeminiToolGuide,
  buildGeminiToolCallExamples,
} from "./gemini";
export { buildGpt54SisyphusPrompt } from "./gpt-5-4";
export { buildGpt55SisyphusPrompt } from "./gpt-5-5";
export { buildClaudeOpus47SisyphusPrompt } from "./claude-opus-4-7";
