import { Hono } from "hono"

import { state } from "~/lib/state"
import packageJson from "../../../package.json"
import { dashboardHtml } from "./page"

export const indexRoute = new Hono()

indexRoute.get("/", (c) => {
  const version = process.env.npm_package_version ?? packageJson.version
  const login = state.githubLogin ?? "unknown"
  const accountType = state.accountType

  const format = c.req.query("format")
  const accept = c.req.header("accept") ?? ""

  if (format === "json" || accept.includes("application/json")) {
    return c.json({ version, login, accountType })
  }

  if (format === "text" || !accept.includes("text/html")) {
    return c.text(
      `Copilot API v${version} - running\nUser: ${login} (${accountType})`,
    )
  }

  return c.html(dashboardHtml)
})
