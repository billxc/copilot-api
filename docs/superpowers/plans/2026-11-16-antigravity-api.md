# Antigravity API Implementation Plan

> Execute inline with the executing-plans workflow; verify each deliverable before continuing.

**Goal:** Run agy against Copilot through a Gemini-compatible adapter and an opt-in configuration target.

**Architecture:** Add an isolated adapter around createChatCompletions and extend the existing config command. Reuse shared model metadata, tokenizer, approval, rate limits, and upstream token handling.

**Tech stack:** TypeScript, Hono, Bun tests, existing CLI dependencies.

**Spec:** Approved Antigravity CLI compatibility design, dated November 16, 2026.

## Constraints and review focus

English code only; no new dependencies, inline comments, commits, or branches. Preserve existing API routes and default configuration targeting. Use temporary homes for configuration tests. Locate code by function responsibility, not source line numbers.

Verify parallel same-name calls without IDs, fragmented arguments, usage-only events, malformed input, unsupported content, upstream failures, missing models, invalid existing settings, backup integrity, isolated agy targeting, and combined targets.

## Translation

- [x] Add failing request/response tests for translateToOpenAI and translateToGemini covering system text, history, images, native tools, call results, generation settings, finish reasons, usage, and invalid input.
- [x] Confirm failures, implement Gemini types and translation helpers, then pass focused and existing translation tests.

## Streaming and routes

- [x] Add failing translateChunkToGemini tests for fragmented parallel calls, finish events, and usage-only chunks.
- [x] Implement buffered function-call translation with per-candidate state.
- [x] Add failing HTTP tests using a mocked Copilot backend for generation, streaming, errors, discovery/detail, token counting, rate limits, and both Gemini prefixes.
- [x] Implement handleGeneration, model discovery, token counting, Google-style errors, and route registration; verify focused tests.

## Configuration and docs

- [x] Add failing subprocess tests for configureAgy, safe merging/backups, invalid JSON, custom port/model, target combinations, and unchanged Claude/Codex defaults.
- [x] Implement the agy arguments, verified custom-model shape, and platform-specific environment instructions; verify configuration tests.
- [x] Update CLI descriptions and README setup, manual examples, endpoint tables, and compatibility boundaries.

## Verification and independent review

- [x] Run all tests, TypeScript checking, changed-file lint, and the production build.
- [x] Exercise installed agy against the adapter and a mock backend, including a complete tool-call round trip.
- [x] Independently review and simplify the complete diff; rerun verification after changes and report limitations.

## Verification results

- All 81 tests pass, with 195 assertions across eight test modules.
- TypeScript checking, the production build, changed-file lint, and whitespace validation pass.
- The installed agy 1.5.9 completes two consecutive native read_file round trips against the complete server with mocked Copilot responses and temporary client homes.
- Full-server checks preserve OpenAI model discovery while serving Gemini model discovery separately.
- Independent review findings received regression tests and verified corrections. Translation helpers were simplified and isolated to satisfy the project's complexity rules.
- This harness does not expose the literal /loop or /simplify commands; iterative behavioral verification and a separate simplification review were performed instead.

## Review decisions

- Stable model listing remains OpenAI-shaped; Gemini discovery uses the beta prefix.
- Real agy tool results can have the model role; accept those without losing call identities.
- Preserve saved model selections and require the printed explicit custom-model flag; agy 1.5.9 does not correctly restore the custom model from its saved label.
- Preserve JSON Schema literals and explicitly reject unsupported response-schema constraints.
- Preserve length/safety finishes for interrupted function arguments; detect streams missing terminal candidate events.
- A Windows Node 24.12.0 CLI-help libuv assertion also reproduces on an archived, unmodified HEAD build. Do not change unrelated runtime behavior; Bun verification is unaffected.
