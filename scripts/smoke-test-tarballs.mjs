#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import process from "node:process"

function usage() {
  console.log(`Usage: node scripts/smoke-test-tarballs.mjs <tarball-dir> [options]

Options:
  --scope <scope>           Target npm scope. Defaults to @jitl.
  --package-prefix <text>   Package name prefix. Defaults to opentui-.
  --keep                    Keep the temporary npm consumer project.`)
}

function parseArgs() {
  const options = {
    tarballDir: "",
    scope: process.env.NPM_SCOPE || "@jitl",
    packagePrefix: process.env.NPM_PACKAGE_PREFIX || "opentui-",
    keep: false,
  }

  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === "--scope") {
      options.scope = args[++i] ?? ""
      continue
    }

    if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length)
      continue
    }

    if (arg === "--package-prefix") {
      options.packagePrefix = args[++i] ?? ""
      continue
    }

    if (arg.startsWith("--package-prefix=")) {
      options.packagePrefix = arg.slice("--package-prefix=".length)
      continue
    }

    if (arg === "--keep") {
      options.keep = true
      continue
    }

    if (arg === "--help" || arg === "-h") {
      usage()
      process.exit(0)
    }

    if (!options.tarballDir) {
      options.tarballDir = arg
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.tarballDir) {
    throw new Error("Missing tarball directory")
  }

  if (!/^@[a-z0-9][a-z0-9._-]*$/i.test(options.scope)) {
    throw new Error(`Invalid npm scope: ${options.scope}`)
  }

  if (options.packagePrefix && !/^[a-z0-9][a-z0-9._-]*$/i.test(options.packagePrefix)) {
    throw new Error(`Invalid package prefix: ${options.packagePrefix}`)
  }

  return options
}

function run(cmd, args, options = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`)
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status ?? "unknown"}: ${cmd} ${args.join(" ")}`)
  }
}

function readTarballPackageJson(tarballPath) {
  const result = spawnSync("tar", ["-xOf", tarballPath, "package/package.json"], {
    encoding: "utf8",
  })

  if (result.status !== 0) {
    throw new Error(`Unable to read package/package.json from ${tarballPath}:\n${result.stderr}`)
  }

  return JSON.parse(result.stdout)
}

function listTarballs(tarballDir) {
  const manifestPath = join(tarballDir, "publish-manifest.json")
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    return manifest.map((entry) => resolve(tarballDir, entry.filename))
  }

  return readdirSync(tarballDir)
    .filter((entry) => entry.endsWith(".tgz"))
    .sort()
    .map((entry) => resolve(tarballDir, entry))
}

function selectInstallTarballs(tarballs, scope, packagePrefix) {
  const coreName = `${scope}/${packagePrefix}core`
  const nativeName = `${scope}/${packagePrefix}core-${process.platform}-${process.arch}`
  const reactName = `${scope}/${packagePrefix}react`
  const solidName = `${scope}/${packagePrefix}solid`
  const wanted = new Set([coreName, nativeName, reactName, solidName])
  const selected = []

  for (const tarball of tarballs) {
    const packageJson = readTarballPackageJson(tarball)
    if (wanted.has(packageJson.name)) {
      selected.push({ tarball, name: packageJson.name })
      wanted.delete(packageJson.name)
    }
  }

  if (wanted.size > 0) {
    throw new Error(`Missing smoke-test tarballs:\n${[...wanted].map((name) => `  - ${name}`).join("\n")}`)
  }

  return selected
}

function writeSmokeTest(workDir, scope, packagePrefix) {
  const coreName = `${scope}/${packagePrefix}core`
  const nativeName = `${scope}/${packagePrefix}core-${process.platform}-${process.arch}`
  const reactName = `${scope}/${packagePrefix}react`
  const solidName = `${scope}/${packagePrefix}solid`
  const scriptPath = join(workDir, "smoke.mjs")

  writeFileSync(
    scriptPath,
    `import assert from "node:assert/strict"

const [core, testing, runtimePlugin, nativePackage, reactPackage, solidPackage] = await Promise.all([
  import(${JSON.stringify(coreName)}),
  import(${JSON.stringify(`${coreName}/testing`)}),
  import(${JSON.stringify(`${coreName}/runtime-plugin`)}),
  import(${JSON.stringify(nativeName)}),
  import(${JSON.stringify(reactName)}),
  import(${JSON.stringify(solidName)}),
])

assert.equal(typeof core.createCliRenderer, "function")
assert.equal(typeof core.TextRenderable, "function")
assert.equal(typeof testing.createTestRenderer, "function")
assert.equal(typeof runtimePlugin.createRuntimePlugin, "function")
assert.equal(typeof nativePackage.default, "string")
assert.equal(typeof reactPackage.createRoot, "function")
assert.equal(typeof solidPackage.render, "function")

const { renderer, renderOnce, captureCharFrame } = await testing.createTestRenderer({
  width: 32,
  height: 6,
})

try {
  renderer.root.add(
    new core.TextRenderable(renderer, {
      id: "jitl-tarball-smoke",
      content: "tarball smoke",
      left: 0,
      top: 0,
    }),
  )

  await renderOnce()
  assert.match(captureCharFrame(), /tarball smoke/)
} finally {
  renderer.destroy()
}
`,
  )

  return scriptPath
}

const options = parseArgs()
const tarballDir = resolve(options.tarballDir)
const tarballs = listTarballs(tarballDir)
const selected = selectInstallTarballs(tarballs, options.scope, options.packagePrefix)
const workDir = mkdtempSync(join(tmpdir(), "opentui-tarball-smoke-"))
const npmEnv = {
  ...process.env,
  NPM_CONFIG_CACHE: join(workDir, ".npm-cache"),
}

try {
  console.log("Selected smoke-test tarballs:")
  for (const item of selected) {
    console.log(`  - ${item.name}: ${basename(item.tarball)}`)
  }

  writeFileSync(join(workDir, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`)
  run("npm", ["install", "--no-audit", "--no-fund", ...selected.map((item) => item.tarball)], {
    cwd: workDir,
    env: npmEnv,
  })

  const smokeTest = writeSmokeTest(workDir, options.scope, options.packagePrefix)
  run("node", [smokeTest], { cwd: workDir })
  console.log("Tarball smoke test passed.")
} finally {
  if (options.keep) {
    console.log(`Keeping smoke-test project at ${workDir}`)
  } else {
    rmSync(workDir, { recursive: true, force: true })
  }
}
