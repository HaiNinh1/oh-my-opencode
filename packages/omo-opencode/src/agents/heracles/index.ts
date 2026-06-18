/**
 * Heracles agent — direct sequential executor for saved plans.
 *
 * Heracles reuses the Sisyphus prompt corpus (see `../sisyphus/`) but is
 * surfaced as its own primary agent. The `/execute-plan` command routes saved
 * `.omo/plans/*.md` plans to Heracles, which implements every task itself, in
 * order, without delegating implementation work.
 */

export { createHeraclesAgent } from "./agent";
