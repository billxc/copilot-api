#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import packageJson from "../package.json"
import { auth } from "./auth"
import { checkUsage } from "./check-usage"
import { config } from "./config"
import { debug } from "./debug"
import { start } from "./start"

const main = defineCommand({
  meta: {
    name: "xc-copilot-api",
    version: packageJson.version,
    description:
      "Expose GitHub Copilot through OpenAI, Anthropic, and Gemini-compatible APIs for external tools.",
  },
  args: {
    version: {
      type: "boolean",
      alias: "V",
      description: "Show version number",
    },
  },
  run({ args }) {
    if (args.version) {
      console.log(packageJson.version)
      process.exit(0)
    }
  },
  subCommands: { auth, start, config, "check-usage": checkUsage, debug },
})

await runMain(main)
