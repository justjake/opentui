#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import process from "node:process"

function usage() {
  console.log(`Usage: node scripts/publish-tarballs.mjs <tarball-dir> [options]

Options:
  --tag <tag>         npm dist-tag.
  --access <access>   npm package access. Defaults to public.
  --dry-run           Run npm publish --dry-run.
  --skip-existing     Skip packages whose exact version already exists on npm.`)
}

function parseArgs() {
  const options = {
    tarballDir: "",
    tag: process.env.NPM_TAG,
    access: "public",
    dryRun: process.env.DRY_RUN === "true",
    skipExisting: false,
  }

  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === "--tag") {
      options.tag = args[++i]
      continue
    }

    if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length)
      continue
    }

    if (arg === "--access") {
      options.access = args[++i] ?? ""
      continue
    }

    if (arg.startsWith("--access=")) {
      options.access = arg.slice("--access=".length)
      continue
    }

    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }

    if (arg === "--skip-existing") {
      options.skipExisting = true
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

  if (!options.access) {
    throw new Error("Missing npm access")
  }

  return options
}

function npmEnv(tarballDir) {
  return {
    ...process.env,
    NPM_CONFIG_CACHE: join(tarballDir, ".npm-cache"),
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

function packageVersionExists(packageName, version, tarballDir) {
  const result = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
    cwd: tarballDir,
    env: npmEnv(tarballDir),
  })

  if (result.status === 0) {
    return result.stdout.toString().trim().length > 0
  }

  const stderr = result.stderr.toString()
  if (stderr.includes("E404") || stderr.includes("404 Not Found")) {
    return false
  }

  throw new Error(`Unable to check ${packageName}@${version} on npm:\n${stderr.trim()}`)
}

function publishTarball(tarballPath, options, tarballDir) {
  const packageJson = readTarballPackageJson(tarballPath)
  console.log(`\n${options.dryRun ? "Checking" : "Publishing"} ${packageJson.name}@${packageJson.version}`)

  if (!options.dryRun) {
    const alreadyPublished = packageVersionExists(packageJson.name, packageJson.version, tarballDir)
    if (alreadyPublished && options.skipExisting) {
      console.log(`Skipping ${packageJson.name}@${packageJson.version}; it already exists on npm.`)
      return
    }

    if (alreadyPublished) {
      throw new Error(`${packageJson.name}@${packageJson.version} already exists on npm`)
    }
  }

  const args = ["publish", tarballPath, "--access", options.access]
  if (options.tag) {
    args.push("--tag", options.tag)
  }
  if (options.dryRun) {
    args.push("--dry-run")
  }

  const result = spawnSync("npm", args, {
    cwd: tarballDir,
    env: npmEnv(tarballDir),
    stdio: "inherit",
  })

  if (result.status !== 0) {
    throw new Error(`Failed to ${options.dryRun ? "dry-run publish" : "publish"} ${basename(tarballPath)}`)
  }
}

const options = parseArgs()
const tarballDir = resolve(options.tarballDir)
const tarballs = listTarballs(tarballDir)

if (tarballs.length === 0) {
  throw new Error(`No npm tarballs found in ${tarballDir}`)
}

for (const tarball of tarballs) {
  publishTarball(tarball, options, tarballDir)
}

console.log(`\n${options.dryRun ? "Dry run completed" : "Publish completed"} for ${tarballs.length} tarballs.`)
