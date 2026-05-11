// Generates src/routes/index/page.ts from docs/index.html so the local
// server bundles the same dashboard that's hosted on GitHub Pages.
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const html = readFileSync(join(root, "docs/index.html"), "utf-8")
const out = `// AUTO-GENERATED from docs/index.html. Do not edit.\nexport const dashboardHtml = ${JSON.stringify(html)}\n`
writeFileSync(join(root, "src/routes/index/page.ts"), out)
