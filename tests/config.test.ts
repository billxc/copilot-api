import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const homePrefix = join(tmpdir(), "copilot-api-config-")
let home: string

beforeEach(async () => {
  home = await mkdtemp(homePrefix)
})

afterEach(async () => {
  if (!resolve(home).startsWith(resolve(homePrefix)))
    throw new Error("Unsafe temporary home path.")
  await rm(home, { recursive: true, force: true })
})

async function runConfig(...args: Array<string>) {
  const script = `import { runMain } from "citty"; import { config } from "./src/config"; await runMain(config, { rawArgs: ${JSON.stringify(args)} })`
  const child = Bun.spawn([process.execPath, "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, output: stdout + stderr }
}

async function exists(...segments: Array<string>) {
  return access(join(home, ...segments)).then(
    () => true,
    () => false,
  )
}

const agyPath = () => join(home, ".gemini", "antigravity-cli", "settings.json")

describe("External client configuration", () => {
  test("configures only agy with a native-tool custom model and launch instructions", async () => {
    const result = await runConfig("--agy")
    expect(result.code).toBe(0)
    const settings = JSON.parse(await readFile(agyPath(), "utf8")) as Record<
      string,
      unknown
    >
    expect(settings).toMatchObject({
      modelProvider: "gemini",
      customModelsConfig: {
        customModels: {
          "copilot-api": {
            modelName: "gemini-api://gpt-4.1",
            label: "Copilot API",
            toolFormatterType: "TOOL_FORMATTER_TYPE_NONE",
            modelFeatures: {
              supportsThinking: false,
              supportsVideo: false,
              supportsAudio: false,
              supportsPdf: false,
            },
          },
        },
      },
    })
    expect(settings.model).toBeUndefined()
    expect(result.output).toContain("GEMINI_API_KEY")
    expect(result.output).toContain("GOOGLE_GEMINI_BASE_URL")
    expect(result.output).toContain("http://localhost:4141")
    expect(result.output).toContain("agy --model copilot-api")
    expect(await exists(".claude", "settings.json")).toBe(false)
    expect(await exists(".codex", "config.toml")).toBe(false)
  })

  test("preserves other settings and models, backs up originals, and is idempotent", async () => {
    await mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true })
    const existing = {
      theme: "dark",
      model: "Existing model",
      customModelsConfig: {
        customModels: {
          other: { modelName: "gemini-api://other", label: "Other" },
        },
      },
    }
    const original = JSON.stringify(existing)
    await writeFile(agyPath(), original)
    expect(
      (await runConfig("--agy", "--agy-model", "gpt-test", "--port", "8123"))
        .code,
    ).toBe(0)
    const configured = await readFile(agyPath(), "utf8")
    expect(JSON.parse(configured)).toMatchObject({
      ...existing,
      customModelsConfig: {
        customModels: {
          ...existing.customModelsConfig.customModels,
          "copilot-api": { modelName: "gemini-api://gpt-test" },
        },
      },
    })
    expect(await readFile(`${agyPath()}.bak`, "utf8")).toBe(original)
    const second = await runConfig(
      "--agy",
      "--agy-model",
      "gpt-test",
      "--port",
      "8123",
    )
    expect(second.code).toBe(0)
    expect(second.output).toContain("http://localhost:8123")
    expect(await readFile(agyPath(), "utf8")).toBe(configured)
  })

  test.each([
    "{",
    "[]",
    "null",
    '{"customModelsConfig":[]}',
    '{"customModelsConfig":null}',
    '{"customModelsConfig":{"customModels":null}}',
  ])("does not overwrite invalid agy settings: %s", async (invalid) => {
    await mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true })
    await writeFile(agyPath(), invalid)
    await writeFile(`${agyPath()}.bak`, "previous backup")
    expect((await runConfig("--agy")).code).not.toBe(0)
    expect(await readFile(agyPath(), "utf8")).toBe(invalid)
    expect(await readFile(`${agyPath()}.bak`, "utf8")).toBe("previous backup")
  })

  test("keeps default Claude and Codex targeting unchanged", async () => {
    expect((await runConfig()).code).toBe(0)
    expect(await exists(".claude", "settings.json")).toBe(true)
    expect(await exists(".codex", "config.toml")).toBe(true)
    expect(await exists(".gemini", "antigravity-cli", "settings.json")).toBe(
      false,
    )
  })

  test.each([
    { targets: ["--claude"] },
    { targets: ["--codex"] },
    { targets: ["--claude", "--codex"] },
  ])("supports agy combined with %j", async ({ targets }) => {
    const result = await runConfig("--agy", ...targets, "--port", "8123")
    expect(result.code).toBe(0)
    expect(await exists(".claude", "settings.json")).toBe(
      targets.includes("--claude"),
    )
    expect(await exists(".codex", "config.toml")).toBe(
      targets.includes("--codex"),
    )
    expect(await exists(".gemini", "antigravity-cli", "settings.json")).toBe(
      true,
    )
  })

  test.each(["0", "NaN", "4141oops", "65536"])(
    "rejects invalid ports without writing settings: %s",
    async (port) => {
      expect((await runConfig("--agy", "--port", port)).code).not.toBe(0)
      expect(await exists(".gemini", "antigravity-cli", "settings.json")).toBe(
        false,
      )
    },
  )
})

describe("Configuration preservation", () => {
  test("preserves existing Claude and Codex settings and backups with all targets", async () => {
    const claudePath = join(home, ".claude", "settings.json")
    const codexPath = join(home, ".codex", "config.toml")
    await mkdir(join(home, ".claude"), { recursive: true })
    await mkdir(join(home, ".codex"), { recursive: true })
    const claudeOriginal = JSON.stringify({
      theme: "dark",
      env: { EXISTING: "keep" },
    })
    const codexOriginal =
      'model = "old"\nmodel_provider = "old"\n\n[projects.example]\ntrust_level = "trusted"\n'
    await writeFile(claudePath, claudeOriginal)
    await writeFile(codexPath, codexOriginal)
    const result = await runConfig(
      "--claude",
      "--codex",
      "--agy",
      "--port",
      "8123",
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(await readFile(claudePath, "utf8"))).toMatchObject({
      theme: "dark",
      env: { EXISTING: "keep", ANTHROPIC_BASE_URL: "http://localhost:8123" },
    })
    const codex = await readFile(codexPath, "utf8")
    expect(codex).toContain('[projects.example]\ntrust_level = "trusted"')
    expect(codex).toContain('base_url = "http://localhost:8123/v1"')
    expect(await readFile(`${claudePath}.bak`, "utf8")).toBe(claudeOriginal)
    expect(await readFile(`${codexPath}.bak`, "utf8")).toBe(codexOriginal)
  })

  test("does not overwrite agy settings if its backup cannot be created", async () => {
    await mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true })
    const original = '{"theme":"dark"}'
    await writeFile(agyPath(), original)
    await mkdir(`${agyPath()}.bak`)
    expect((await runConfig("--agy")).code).not.toBe(0)
    expect(await readFile(agyPath(), "utf8")).toBe(original)
  })
})
