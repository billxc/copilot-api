# Copilot API Proxy

> **Fork Notice:**  
> The original project by [ericc-ch](https://github.com/ericc-ch/copilot-api) is no longer actively maintained. This fork by [billxc](https://github.com/billxc/copilot-api) updates the project for personal use, adding native passthrough support for the Responses API and Claude API.

> [!WARNING]
> This is a reverse-engineered proxy of GitHub Copilot API. It is not supported by GitHub, and may break unexpectedly. Use at your own risk.

> [!WARNING]
> **GitHub Security Notice:**  
> Excessive automated or scripted use of Copilot (including rapid or bulk requests, such as via automated tools) may trigger GitHub's abuse-detection systems. Use this proxy responsibly to avoid account restrictions.
>
> - [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github)
> - [GitHub Copilot Terms](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)

[![爱发电](https://img.shields.io/badge/爱发电-billxc-946ce6?style=for-the-badge)](https://afdian.com/a/billxc)

A reverse-engineered proxy for the GitHub Copilot API that exposes OpenAI, Anthropic, and Gemini-compatible services. Use GitHub Copilot with [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview), [Codex CLI](https://github.com/openai/codex), [Antigravity CLI](https://antigravity.google/docs/install/), or tools supporting these APIs.

> **Note:** If you are using [opencode](https://github.com/sst/opencode), you do not need this project. Opencode supports GitHub Copilot provider out of the box.

## Quick Start

```sh
# 1. Start the server
npx xc-copilot-api@latest start

# 2. Configure your tool
npx xc-copilot-api@latest config --claude    # Claude Code (Opus 4.7)
npx xc-copilot-api@latest config --codex     # Codex CLI (GPT-5.5)
npx xc-copilot-api@latest config --agy       # Antigravity CLI (GPT-4.1; prints required environment commands)
```

That's it. Your tool is now powered by GitHub Copilot.

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Features

- **OpenAI, Anthropic & Gemini Compatibility** — Existing `/v1` APIs plus Gemini generation, streaming, token counting, and discovery under `/v1beta/models`
- **Native Passthrough** — Claude and GPT models are forwarded directly to upstream with full protocol fidelity (tool use, streaming, thinking blocks, vision)
- **Client Setup** — `config --claude` / `config --codex` writes settings automatically; `config --agy` also prints required shell environment commands
- **Usage Dashboard** — Web UI to monitor quotas and usage statistics
- **Rate Limiting** — `--rate-limit` and `--wait` to stay within GitHub's limits
- **Background Service** — Run as a system service via [easy-service](https://github.com/billxc/easy-service)
- **Multiple Account Types** — Individual, business, and enterprise Copilot plans

## Using with Claude Code

```sh
# Opus 4.7 (default)
npx xc-copilot-api@latest config --claude

# Opus 4.6
npx xc-copilot-api@latest config --claude -m 4.6
```

A backup of your existing config is saved as `settings.json.bak`.

<details>
<summary>Manual configuration</summary>

**Opus 4.7 (default):**

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "Powered by xc copilot",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4.7-1m-internal",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  }
}
```

**Opus 4.6:**

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "Powered by xc copilot",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4.6-1m",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  }
}
```

More options: [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables) · [IDE integration](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)

</details>

## Using with Codex CLI

```sh
npx xc-copilot-api@latest config --codex
```

<details>
<summary>Manual configuration</summary>

Add to `~/.codex/config.toml`:

```toml
model = "gpt-5.5"
model_provider = "copilot-api"

[model_providers.copilot-api]
name = "copilot-api"
base_url = "http://localhost:4141/v1"
wire_api = "responses"
```

</details>

## Using with Antigravity CLI (agy)

Antigravity CLI can use the proxy through its Gemini API-key provider. This does not emulate Google's private Antigravity account API.

```sh
npx xc-copilot-api@latest config --agy

# Optional: choose a different Copilot Chat Completions model or proxy port
npx xc-copilot-api@latest config --agy --agy-model gpt-4.1 --port 4141
```

The command merges `~/.gemini/antigravity-cli/settings.json`, preserves unrelated settings and custom models, saves a `settings.json.bak`, and registers a custom model named **Copilot API** with native tool calling. Running `config` without target flags still configures only Claude Code and Codex CLI. Targets can be combined, for example `config --claude --codex --agy`.

Run the environment commands printed by the config command before launching `agy`. On macOS/Linux:

```sh
export GEMINI_API_KEY="copilot-api"
export GOOGLE_GEMINI_BASE_URL="http://localhost:4141"
agy --model copilot-api
```

On Windows PowerShell:

```powershell
$env:GEMINI_API_KEY = "copilot-api"
$env:GOOGLE_GEMINI_BASE_URL = "http://localhost:4141"
agy --model copilot-api
```

The placeholder key only enables agy's API-key mode; the proxy continues to authenticate upstream using your GitHub Copilot token. Use the proxy root URL, without `/v1beta`, because agy appends the API path. The CLI does not load these values from `.env` or its settings file. The config command does not edit shell profiles; persist the environment yourself if desired. Always pass `--model copilot-api`: agy 1.5.9 does not reliably restore saved custom-model selections, so the config command preserves your existing saved model instead of overwriting it.

<details>
<summary>Manual configuration</summary>

Merge this into `~/.gemini/antigravity-cli/settings.json`, then set the environment shown above:

```json
{
  "modelProvider": "gemini",
  "customModelsConfig": {
    "customModels": {
      "copilot-api": {
        "modelName": "gemini-api://gpt-4.1",
        "label": "Copilot API",
        "toolFormatterType": "TOOL_FORMATTER_TYPE_NONE",
        "modelFeatures": {
          "supportsImages": true,
          "supportsToolCalls": true,
          "supportsThinking": false,
          "supportsVideo": false,
          "supportsAudio": false,
          "supportsPdf": false
        }
      }
    }
  }
}
```

</details>

**Compatibility:** Text, inline images, system prompts, conversation history, native tool calls/results, JSON-object output, and SSE streaming are translated to Copilot Chat Completions. Token counts are local estimates, not Google's tokenizer. Use a Copilot model that supports Chat Completions; models requiring only the Responses or Messages API are not supported by this adapter. Audio, video, PDF, Google-hosted file references, built-in Google tools, thinking output, and schema-constrained output (`responseSchema` / `responseJsonSchema`) are not supported. Unsupported response-schema constraints return an explicit error rather than being silently dropped. The configuration disables unsupported custom-model capabilities. Validated with agy 1.5.9.

References: [API-key mode and custom endpoint](https://antigravity.google/docs/install/#using-a-gemini-api-key), [CLI settings](https://antigravity.google/docs/settings/), and [settings schema](https://antigravity.google/schemas/v1/settings.json).

## Command Reference

### Commands

| Command       | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `start`       | Start the API server (handles auth automatically)                  |
| `auth`        | Run GitHub auth flow only (for generating tokens for CI/CD)        |
| `config`      | Configure Claude Code, Codex CLI, or Antigravity CLI               |
| `check-usage` | Show Copilot usage and quota in the terminal                       |
| `debug`       | Display version, runtime, file paths, and auth status              |

### `start` Options

| Option         | Description                                            | Default    | Alias |
| -------------- | ------------------------------------------------------ | ---------- | ----- |
| --port         | Port to listen on                                      | 4141       | -p    |
| --verbose      | Enable verbose logging                                 | false      | -v    |
| --account-type | Account type (individual, business, enterprise)        | individual | -a    |
| --manual       | Manually approve each request                          | false      |       |
| --rate-limit   | Minimum seconds between requests                       |            | -r    |
| --wait         | Wait instead of error when rate limited                | false      | -w    |
| --github-token | Provide GitHub token directly                          |            | -g    |
| --show-token   | Show tokens on fetch and refresh                       | false      |       |
| --proxy-env    | Initialize proxy from environment variables            | false      |       |

### `config` Options

| Option         | Description                                       | Default | Alias |
| -------------- | ------------------------------------------------- | ------- | ----- |
| --claude       | Configure Claude Code (`~/.claude/settings.json`) | false   | -c    |
| --codex        | Configure Codex CLI (`~/.codex/config.toml`)      | false   | -x    |
| --agy          | Configure Antigravity CLI (`~/.gemini/antigravity-cli/settings.json`) | false | -a |
| --agy-model    | Copilot Chat Completions model for agy           | gpt-4.1 |       |
| --claude-model | Claude Opus model version (4.7 or 4.6)            | 4.7     | -m    |
| --port         | Proxy port used by all selected clients           | 4141    | -p    |

## API Endpoints

| Endpoint                         | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| `POST /v1/chat/completions`      | OpenAI Chat Completions API                    |
| `POST /v1/responses`             | OpenAI Responses API (native passthrough)      |
| `POST /v1/messages`              | Anthropic Messages API (native passthrough)    |
| `POST /v1/messages/count_tokens` | Anthropic token counting                       |
| `GET  /v1/models`                | List available models                          |
| `POST /v1/embeddings`            | Create embedding vectors                       |
| `GET  /usage`                    | Copilot usage statistics and quota             |
| `GET  /token`                    | Current Copilot token                          |
| `POST /v1beta/models/:model:generateContent` | Gemini-compatible generation            |
| `POST /v1beta/models/:model:streamGenerateContent?alt=sse` | Gemini-compatible SSE streaming |
| `POST /v1beta/models/:model:countTokens` | Approximate local Gemini token counting     |
| `GET  /v1beta/models`             | Gemini-compatible model discovery              |
| `GET  /v1beta/models/:model`      | Gemini-compatible model metadata               |

Gemini generation, token counting, and individual model metadata also accept the `/v1` prefix. `GET /v1/models` remains the existing OpenAI-compatible endpoint; use `/v1beta/models` for Gemini discovery.

## Running as a Background Service

```bash
# Install easy-service
uv tool install git+https://github.com/billxc/easy-service.git

# Install and start
easy-service install copilot-api -- npx -y xc-copilot-api@latest start

# Manage
easy-service status copilot-api
easy-service logs copilot-api -f
easy-service restart copilot-api
easy-service stop copilot-api
easy-service uninstall copilot-api
```

## Running from Source

```sh
bun install        # install dependencies
bun run dev        # development mode
bun run start      # production mode
```

Prerequisites: Bun >= 1.2.x, GitHub account with Copilot subscription.

## Usage Tips

- Use `--rate-limit 30 --wait` to stay within Copilot's rate limits without client errors.
- Use `--account-type business` or `enterprise` if you have a business/enterprise Copilot plan. See [official docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-access-to-github-copilot-in-your-organization/managing-github-copilot-access-to-your-organizations-network#configuring-copilot-subscription-based-network-routing-for-your-enterprise-or-organization).
- Use `--manual` to approve each request individually for fine-grained control.

<details>
<summary><h2>Using with Docker</h2></summary>

### Pre-built Image

```sh
docker pull ghcr.io/billxc/copilot-api:latest
mkdir -p ./copilot-data
docker run -p 4141:4141 -v $(pwd)/copilot-data:/root/.local/share/copilot-api ghcr.io/billxc/copilot-api:latest
```

Available tags: `latest`, `v*.*.*`, `master`, `<sha>`

### Build from Source

```sh
docker build -t copilot-api .
mkdir -p ./copilot-data
docker run -p 4141:4141 -v $(pwd)/copilot-data:/root/.local/share/copilot-api copilot-api
```

### Environment Variables

```sh
docker run -p 4141:4141 -e GH_TOKEN=your_token copilot-api
```

### Docker Compose

```yaml
version: "3.8"
services:
  copilot-api:
    image: ghcr.io/billxc/copilot-api:latest
    ports:
      - "4141:4141"
    environment:
      - GH_TOKEN=your_github_token_here
    volumes:
      - ./copilot-data:/root/.local/share/copilot-api
    restart: unless-stopped
```

> **Note:** Token data is persisted in `copilot-data` on your host, mapped to `/root/.local/share/copilot-api` inside the container.

</details>

<details>
<summary><h2>Update Log</h2></summary>

### v1.2.3 — Claude Model Selection & Codex 5.5

- **Claude model version selection**: New `--claude-model` (`-m`) option for `config --claude`. Choose between Opus 4.7 (default) and Opus 4.6.
- **Codex default model updated**: `config --codex` now defaults to `gpt-5.5`.
- **Filter unsupported tools in Responses API**: Automatically strips `image_generation` and other unsupported tool types before forwarding to upstream, preventing errors from Codex CLI.
- **Bun idle timeout fix**: Increased `idleTimeout` to 255s to prevent streaming responses from being cut off after 10 seconds.
- **README restructured**: Quick Start first, collapsible Docker/Update Log sections, consolidated command reference.

### v1.2.1 — easy-service & Config Command

- **New `config` subcommand**: One-command setup for Claude Code (`config --claude`) and Codex CLI (`config --codex`).
- **Background service**: Replaced built-in daemon with [easy-service](https://github.com/billxc/easy-service) for cross-platform service management.

### v1.1.x — Anthropic 1M Models

- **Anthropic 1M model support**: Enhanced beta header handling for `claude-opus-4.6-1m` and other 1M context models.

### v1.0.x — Native Passthrough

- **Native passthrough for Responses API and Claude API**: Claude models forward the entire Anthropic Messages request directly to upstream. GPT models forward Responses API requests without transformation.
- **Full protocol fidelity**: Tool use, streaming, thinking blocks, vision — all preserved without translation loss.
- **Fallback translation**: Non-Claude models hitting `/v1/messages` still use the Anthropic-to-OpenAI translation layer.

</details>
