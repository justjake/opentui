import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, "..")
const packageDirs = ["core", "qrcode", "solid", "react", "keymap"] as const

for (const packageDir of packageDirs) {
  const packageRoot = join(rootDir, "packages", packageDir)
  const tsconfigPath = join(packageRoot, "tsconfig.build.json")
  if (!existsSync(tsconfigPath)) {
    throw new Error(`Missing TypeScript build config: ${tsconfigPath}`)
  }

  console.log(`Typechecking @opentui/${packageDir}...`)

  const result = spawnSync("bun", ["run", "tsc", "-p", "tsconfig.build.json", "--noEmit"], {
    cwd: packageRoot,
    stdio: "inherit",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
