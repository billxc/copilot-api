# Antigravity CLI compatibility

## Approved scope

Expose Gemini-compatible generation, streaming, token counting, and model discovery backed by createChatCompletions. Configure Antigravity CLI using its Gemini provider, not its private account backend. Preserve existing OpenAI, Anthropic, Claude, and Codex behavior.

The adapter translates system instructions, history, inline images, native tools, function calls/results, sampling, output limits, stop sequences, candidate count, JSON output, and function-calling modes. Responses preserve candidate indexes, finish reasons, call identities, and usage. Streaming buffers fragmented function arguments. Invalid requests and upstream failures use Google-style errors. Local token counts are approximate. Model discovery reuses Copilot metadata with refresh/cache fallback. Generation reuses shared approval, rate limiting, authentication, and token refresh. Beta routes provide the complete adapter; stable generation, token counting, and individual-model aliases are also supported. Stable model listing remains OpenAI-compatible to avoid a protocol collision.

## Configuration

configureAgy is an opt-in target with an agy-specific model option. Like configureClaude and configureCodex, it merges settings, creates a backup, preserves unrelated values, and respects the proxy port. Default config targeting remains Claude and Codex only.

Select the Gemini provider and register a dedicated custom model with native function calling. Default to gpt-4.1; another Copilot Chat Completions model can be selected. Disable unsupported audio, video, PDF, and thinking features. Print platform-specific environment assignments and a launch command without modifying shell profiles or saving real credentials. Preserve the existing saved model selection and launch with an explicit custom-model flag: the installed agy version sends the wrong model or reports an empty model when relying on saved custom-model selections.

## Evidence and boundaries

Antigravity CLI 1.5.9 is installed locally. Help, model listing, and a loopback-only generation probe confirm that arbitrary Copilot IDs need a custom model. The working identifier is gemini-api:// followed by the model ID; GOOGLE_GEMINI_BASE_URL selects the endpoint. The probe received Gemini SSE and printed OK. Native declarations use parametersJsonSchema. The official settings JSON schema defines customModels as a keyed object and native tools as TOOL_FORMATTER_TYPE_NONE. A complete native read_file round trip confirmed that agy sends functionResponse parts with the model role; the adapter accepts both model and user roles for function results.

The longer URI example in the official settings documentation was sent literally as a model path by the installed CLI, so use the locally verified identifier. No private account emulation, shell-profile edits, existing model-default changes, or new upstream Responses/Messages translation layers. Models must support Copilot Chat Completions. JSON-object output is supported; schema-constrained output is explicitly rejected rather than silently weakened.
