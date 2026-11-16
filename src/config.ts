#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

async function backupFile(filePath: string): Promise<void> {
  try {
    const backupPath = `${filePath}.bak`
    await copyFile(filePath, backupPath)
    consola.info(`Backup saved: ${backupPath}`)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

const CLAUDE_OPUS_MODELS: Record<string, string> = {
  "4.8": "claude-opus-4.8",
  "4.7": "claude-opus-4.7-1m-internal",
  "4.6": "claude-opus-4.6-1m",
}

async function configureClaude(
  port: number,
  modelVersion: string,
): Promise<void> {
  const opusModel = CLAUDE_OPUS_MODELS[modelVersion]
  if (!opusModel) {
    consola.error(
      `Unknown Claude model version: ${modelVersion}. Supported: ${Object.keys(CLAUDE_OPUS_MODELS).join(", ")}`,
    )
    process.exit(1)
  }

  const configDir = join(homedir(), ".claude")
  const configPath = join(configDir, "settings.json")

  await mkdir(configDir, { recursive: true })

  let existing: Record<string, unknown> = {}
  try {
    const raw = await readFile(configPath, "utf8")
    existing = JSON.parse(raw) as Record<string, unknown>
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      consola.error(`Failed to parse ${configPath}. Please fix it manually.`)
      process.exit(1)
    }
  }

  const existingEnv =
    typeof existing.env === "object" && existing.env !== null ?
      (existing.env as Record<string, string>)
    : {}

  const merged = {
    ...existing,
    env: {
      ...existingEnv,
      ANTHROPIC_BASE_URL: `http://localhost:${port}`,
      ANTHROPIC_AUTH_TOKEN: "Powered by xc copilot",
      ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    },
    model: "opus[1m]",
  }

  await backupFile(configPath)
  await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8")
  consola.success(`Claude Code configured: ${configPath}`)
}

/**
 * Set or replace a top-level key in a TOML string.
 * If the key exists, its value is updated in place. Otherwise appended after
 * the last existing top-level key (before the first [section]).
 */
function setTomlTopLevelKey(
  content: string,
  key: string,
  value: string,
): string {
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m")
  const line = `${key} = ${JSON.stringify(value)}`

  if (pattern.test(content)) {
    return content.replace(pattern, line)
  }

  // Insert before the first [section] header, or append at end
  const sectionMatch = content.match(/^\[/m)
  if (sectionMatch?.index !== undefined) {
    return (
      content.slice(0, sectionMatch.index)
      + line
      + "\n"
      + content.slice(sectionMatch.index)
    )
  }
  return content.trimEnd() + "\n" + line + "\n"
}

/**
 * Set or replace an entire [section] block in a TOML string.
 * Replaces everything from the header to the next section (or EOF).
 */
function setTomlSection(content: string, header: string, body: string): string {
  const escaped = header.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  // Match the section header and all content up to the next section or EOF
  const pattern = new RegExp(`^\\[${escaped}\\]\\n[^[]*`, "m")
  const block = `[${header}]\n${body}\n\n`

  if (pattern.test(content)) {
    return content.replace(pattern, block)
  }
  return content.trimEnd() + "\n\n" + block
}

async function configureCodex(port: number): Promise<void> {
  const configDir = join(homedir(), ".codex")
  const configPath = join(configDir, "config.toml")

  await mkdir(configDir, { recursive: true })

  let content = ""
  try {
    content = await readFile(configPath, "utf8")
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      consola.error(`Failed to read ${configPath}. Please fix it manually.`)
      process.exit(1)
    }
  }

  content = setTomlTopLevelKey(content, "model", "gpt-5.5")
  content = setTomlTopLevelKey(content, "model_provider", "copilot-api")
  content = setTomlSection(
    content,
    "model_providers.copilot-api",
    `name = "copilot-api"\nbase_url = "http://localhost:${port}/v1"\nwire_api = "responses"`,
  )

  await backupFile(configPath)
  await writeFile(configPath, content, "utf8")
  consola.success(`Codex CLI configured: ${configPath}`)
}

function configObject(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

async function configureAgy(port: number, model: string): Promise<void> {
  if (!/^[\w.-]+$/.test(model))
    throw new Error("The agy model must be a Copilot model ID.")
  const configDir = join(homedir(), ".gemini", "antigravity-cli")
  const configPath = join(configDir, "settings.json")
  let existing: Record<string, unknown> = {}
  try {
    existing = configObject(
      JSON.parse(await readFile(configPath, "utf8")),
      configPath,
    )
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const customModelsConfig = configObject(
    existing.customModelsConfig,
    "customModelsConfig",
  )
  const customModels = configObject(
    customModelsConfig.customModels,
    "customModels",
  )
  const merged = {
    ...existing,
    modelProvider: "gemini",
    customModelsConfig: {
      ...customModelsConfig,
      customModels: {
        ...customModels,
        "copilot-api": {
          modelName: `gemini-api://${model}`,
          label: "Copilot API",
          toolFormatterType: "TOOL_FORMATTER_TYPE_NONE",
          modelFeatures: {
            supportsImages: true,
            supportsToolCalls: true,
            supportsThinking: false,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: false,
          },
        },
      },
    },
  }
  await mkdir(configDir, { recursive: true })
  await backupFile(configPath)
  await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8")
  consola.success(`Antigravity CLI configured: ${configPath}`)
  consola.info("Run these commands in your shell before launching agy:")
  const baseUrl = `http://localhost:${port}`
  if (process.platform === "win32") {
    console.log(
      `$env:GEMINI_API_KEY = "copilot-api"\n$env:GOOGLE_GEMINI_BASE_URL = "${baseUrl}"`,
    )
  } else {
    console.log(
      `export GEMINI_API_KEY="copilot-api"\nexport GOOGLE_GEMINI_BASE_URL="${baseUrl}"`,
    )
  }
  console.log("agy --model copilot-api")
}

export const config = defineCommand({
  meta: {
    name: "config",
    description:
      "Configure Claude Code, Codex CLI, or Antigravity CLI to use Copilot API. Defaults to Claude and Codex; use --agy to opt in to Antigravity.",
  },
  args: {
    claude: {
      alias: "c",
      type: "boolean",
      default: false,
      description: "Configure Claude Code (~/.claude/settings.json)",
    },
    codex: {
      alias: "x",
      type: "boolean",
      default: false,
      description: "Configure Codex CLI (~/.codex/config.toml)",
    },
    agy: {
      alias: "a",
      type: "boolean",
      default: false,
      description:
        "Configure Antigravity CLI (~/.gemini/antigravity-cli/settings.json)",
    },
    "agy-model": {
      type: "string",
      default: "gpt-4.1",
      description: "Copilot Chat Completions model for Antigravity CLI",
    },
    "claude-model": {
      alias: "m",
      type: "string",
      default: "4.8",
      description: "Claude Opus model version (4.8, 4.7, or 4.6)",
    },
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port the Copilot API server listens on",
    },
  },
  async run({ args }) {
    const port = Number(args.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer between 1 and 65535.")
    }

    // Default to configuring both when neither flag is specified.
    const configureBoth = !args.claude && !args.codex && !args.agy

    if (configureBoth || args.claude) {
      await configureClaude(port, args["claude-model"])
    }

    if (configureBoth || args.codex) {
      await configureCodex(port)
    }

    if (args.agy) {
      await configureAgy(port, args["agy-model"])
    }
  },
})
