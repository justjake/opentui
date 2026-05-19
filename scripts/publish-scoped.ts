import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  repository?: string | { type?: string; url?: string; directory?: string }
  optionalDependencies?: Record<string, string>
}

interface Options {
  sourceScope: string
  targetScope: string
  packagePrefix: string
  repositoryUrl: string
  packDestination?: string
  packOnly: boolean
  dryRun: boolean
  keepStage: boolean
  skipExisting: boolean
  tag?: string
  access: string
}

interface PublishPackage {
  name: string
  version: string
  sourceDir: string
  stageDir: string
  tarballPath?: string
}

interface PackedPackage {
  name: string
  version: string
  filename: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const PUBLISHED_PACKAGE_DIRS = ["core", "react", "solid"] as const
const TEXT_EXTENSIONS = new Set([".cjs", ".css", ".d.ts", ".js", ".json", ".map", ".md", ".mjs", ".ts", ".txt"])
const README_NOTICE = [
  "> Experimental build of OpenTUI for Node.js from [github.com/justjake/opentui](https://github.com/justjake/opentui).",
  ">",
  "> Published under `@jitl/*` until the Node.js support branch is upstreamed.",
  "",
].join("\n")

function parseArgs(): Options {
  const options: Options = {
    sourceScope: "@opentui",
    targetScope: process.env.NPM_SCOPE || "@jitl",
    packagePrefix: process.env.NPM_PACKAGE_PREFIX || "",
    repositoryUrl: process.env.NPM_REPOSITORY_URL || "https://github.com/justjake/opentui",
    packDestination: process.env.NPM_PACK_DESTINATION,
    packOnly: false,
    dryRun: process.env.DRY_RUN === "true",
    keepStage: false,
    skipExisting: false,
    tag: process.env.NPM_TAG,
    access: "public",
  }

  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }

    if (arg === "--keep-stage") {
      options.keepStage = true
      continue
    }

    if (arg === "--skip-existing") {
      options.skipExisting = true
      continue
    }

    if (arg === "--scope" || arg === "--target-scope") {
      options.targetScope = args[++i] ?? ""
      continue
    }

    if (arg.startsWith("--scope=")) {
      options.targetScope = arg.slice("--scope=".length)
      continue
    }

    if (arg.startsWith("--target-scope=")) {
      options.targetScope = arg.slice("--target-scope=".length)
      continue
    }

    if (arg === "--source-scope") {
      options.sourceScope = args[++i] ?? ""
      continue
    }

    if (arg.startsWith("--source-scope=")) {
      options.sourceScope = arg.slice("--source-scope=".length)
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

    if (arg === "--tag") {
      options.tag = args[++i]
      continue
    }

    if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length)
      continue
    }

    if (arg === "--pack-destination") {
      options.packDestination = args[++i]
      continue
    }

    if (arg.startsWith("--pack-destination=")) {
      options.packDestination = arg.slice("--pack-destination=".length)
      continue
    }

    if (arg === "--pack-only" || arg === "--no-publish") {
      options.packOnly = true
      continue
    }

    if (arg === "--repository-url") {
      options.repositoryUrl = args[++i] ?? ""
      continue
    }

    if (arg.startsWith("--repository-url=")) {
      options.repositoryUrl = arg.slice("--repository-url=".length)
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

    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: bun scripts/publish-scoped.ts [options]",
          "",
          "Options:",
          "  --scope <scope>          Target npm scope. Defaults to @jitl or NPM_SCOPE.",
          "  --source-scope <scope>   Source npm scope to rewrite. Defaults to @opentui.",
          "  --package-prefix <text>  Prefix for unscoped package names. Example: opentui-.",
          "  --tag <tag>              npm dist-tag for publish.",
          "  --pack-destination <dir> Create npm tarballs in this directory before publishing.",
          "  --pack-only              Stage and pack packages without publishing.",
          "  --repository-url <url>   Repository URL for staged package.json files.",
          "  --dry-run                Run npm publish --dry-run.",
          "  --keep-stage             Keep the staged rewritten package directory.",
          "  --skip-existing          Skip packages whose exact version already exists on npm.",
          "  --access <access>        npm package access. Defaults to public.",
        ].join("\n"),
      )
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  validateScope(options.sourceScope, "source scope")
  validateScope(options.targetScope, "target scope")
  validatePackagePrefix(options.packagePrefix)
  if (!options.access) {
    throw new Error("Missing npm access")
  }
  if (!options.repositoryUrl) {
    throw new Error("Missing repository URL")
  }
  if (options.packOnly && !options.packDestination) {
    throw new Error("--pack-only requires --pack-destination")
  }

  return options
}

function validateScope(scope: string, label: string): void {
  if (!/^@[a-z0-9][a-z0-9._-]*$/i.test(scope)) {
    throw new Error(`Invalid ${label}: ${scope}`)
  }
}

function validatePackagePrefix(packagePrefix: string): void {
  if (packagePrefix && !/^[a-z0-9][a-z0-9._-]*$/i.test(packagePrefix)) {
    throw new Error(`Invalid package prefix: ${packagePrefix}`)
  }
}

function readPackageJson(packageDir: string): PackageJson {
  const packageJsonPath = join(packageDir, "package.json")
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Missing package.json: ${packageJsonPath}`)
  }

  return JSON.parse(readFileSync(packageJsonPath, "utf8"))
}

function packageDirForName(baseDir: string, packageName: string): string {
  return join(baseDir, ...packageName.split("/"))
}

function shouldRewriteFile(filePath: string): boolean {
  const ext = extname(filePath)
  return TEXT_EXTENSIONS.has(ext) || basename(filePath) === "LICENSE"
}

function rewriteTextFiles(dir: string, options: Options): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      rewriteTextFiles(entryPath, options)
      continue
    }

    if (!entry.isFile() || !shouldRewriteFile(entryPath)) {
      continue
    }

    const original = readFileSync(entryPath, "utf8")
    const rewritten = original.replaceAll(`${options.sourceScope}/`, `${options.targetScope}/${options.packagePrefix}`)

    if (rewritten !== original) {
      writeFileSync(entryPath, rewritten)
    }
  }
}

function assertNoSourceScopeReferences(dir: string, sourceScope: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      assertNoSourceScopeReferences(entryPath, sourceScope)
      continue
    }

    if (!entry.isFile() || !shouldRewriteFile(entryPath)) {
      continue
    }

    if (readFileSync(entryPath, "utf8").includes(`${sourceScope}/`)) {
      throw new Error(`Staged package still references ${sourceScope}/ in ${entryPath}`)
    }
  }
}

function prependReadmeNotice(packageDir: string): void {
  const readmePath = join(packageDir, "README.md")
  if (!existsSync(readmePath)) {
    return
  }

  const original = readFileSync(readmePath, "utf8")
  if (original.startsWith(README_NOTICE)) {
    return
  }

  writeFileSync(readmePath, `${README_NOTICE}${original}`)
}

function updatePackageJsonMetadata(packageDir: string, options: Options): void {
  const packageJsonPath = join(packageDir, "package.json")
  const packageJson = readPackageJson(packageDir)

  if (typeof packageJson.repository === "string") {
    packageJson.repository = options.repositoryUrl
  } else {
    packageJson.repository = {
      ...(packageJson.repository ?? {}),
      type: packageJson.repository?.type ?? "git",
      url: options.repositoryUrl,
    }
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

function collectPackages(stageRoot: string, options: Options): PublishPackage[] {
  const packageRoots = PUBLISHED_PACKAGE_DIRS.map((packageDirName) => ({
    packageDirName,
    sourceDir: join(rootDir, "packages", packageDirName, "dist"),
  }))

  const missingDist = packageRoots.filter(({ sourceDir }) => !existsSync(sourceDir))
  if (missingDist.length > 0) {
    throw new Error(
      `Missing built package dist directories:\n${missingDist.map(({ sourceDir }) => `  - ${sourceDir}`).join("\n")}`,
    )
  }

  const coreDistPackageJson = readPackageJson(join(rootDir, "packages", "core", "dist"))
  const nativePackageNames = Object.keys(coreDistPackageJson.optionalDependencies ?? {}).filter((name) =>
    name.startsWith(`${options.sourceScope}/core-`),
  )

  if (nativePackageNames.length === 0) {
    throw new Error(`No native ${options.sourceScope}/core-* packages found in core dist optionalDependencies`)
  }

  const nativeSourceBaseDir = join(rootDir, "packages", "core", "node_modules")
  const nativePackageRoots = nativePackageNames.map((packageName) => ({
    packageDirName: packageName.split("/").at(-1) ?? packageName,
    sourceDir: packageDirForName(nativeSourceBaseDir, packageName),
  }))

  const missingNative = nativePackageRoots.filter(({ sourceDir }) => !existsSync(sourceDir))
  if (missingNative.length > 0) {
    throw new Error(
      `Missing built native package directories:\n${missingNative.map(({ sourceDir }) => `  - ${sourceDir}`).join("\n")}`,
    )
  }

  const packageRootsInPublishOrder = [...nativePackageRoots, ...packageRoots]

  return packageRootsInPublishOrder.map(({ packageDirName, sourceDir }) => {
    const stageDir = join(stageRoot, packageDirName)
    cpSync(sourceDir, stageDir, { recursive: true })
    rewriteTextFiles(stageDir, options)
    updatePackageJsonMetadata(stageDir, options)
    prependReadmeNotice(stageDir)
    assertNoSourceScopeReferences(stageDir, options.sourceScope)

    const packageJson = readPackageJson(stageDir)
    if (!packageJson.name.startsWith(`${options.targetScope}/`)) {
      throw new Error(`Expected staged package name to use ${options.targetScope}: ${packageJson.name}`)
    }

    return {
      name: packageJson.name,
      version: packageJson.version,
      sourceDir,
      stageDir,
    }
  })
}

function createNpmUserConfig(stageRoot: string): string | undefined {
  const token = process.env.NPM_AUTH_TOKEN || process.env.NODE_AUTH_TOKEN
  if (!token) {
    return undefined
  }

  const npmrcPath = join(stageRoot, ".npmrc")
  writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\n`)
  return npmrcPath
}

function npmEnv(stageRoot: string, npmUserConfig?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(npmUserConfig ? { NPM_CONFIG_USERCONFIG: npmUserConfig } : {}),
    NPM_CONFIG_CACHE: join(stageRoot, ".npm-cache"),
  }
}

function runNpm(args: string[], cwd: string, stageRoot: string, npmUserConfig?: string): SpawnSyncReturns<Buffer> {
  return spawnSync("npm", args, {
    cwd,
    env: npmEnv(stageRoot, npmUserConfig),
    stdio: "inherit",
  })
}

function packPackage(pkg: PublishPackage, packDestination: string, stageRoot: string, npmUserConfig?: string): string {
  mkdirSync(packDestination, { recursive: true })

  const result = spawnSync("npm", ["pack", pkg.stageDir, "--pack-destination", packDestination, "--json"], {
    cwd: stageRoot,
    env: npmEnv(stageRoot, npmUserConfig),
  })

  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`Failed to pack ${pkg.name}@${pkg.version}`)
  }

  const output = result.stdout.toString().trim()
  const packed = JSON.parse(output) as Array<{ filename: string }>
  const filename = packed[0]?.filename
  if (!filename) {
    throw new Error(`npm pack did not report a tarball for ${pkg.name}@${pkg.version}`)
  }

  const tarballPath = resolve(packDestination, filename)
  console.log(`  - ${pkg.name}@${pkg.version} -> ${tarballPath}`)
  return tarballPath
}

function packPackages(
  packages: PublishPackage[],
  packDestination: string,
  stageRoot: string,
  npmUserConfig?: string,
): void {
  const destination = resolve(packDestination)
  console.log(`\nCreating npm tarballs in ${destination}`)

  const manifest: PackedPackage[] = []
  for (const pkg of packages) {
    const tarballPath = packPackage(pkg, destination, stageRoot, npmUserConfig)
    pkg.tarballPath = tarballPath
    manifest.push({
      name: pkg.name,
      version: pkg.version,
      filename: basename(tarballPath),
    })
  }

  writeFileSync(join(destination, "publish-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

function verifyNpmAuth(stageRoot: string, npmUserConfig?: string): void {
  const token = process.env.NPM_AUTH_TOKEN || process.env.NODE_AUTH_TOKEN
  if (!token) {
    console.log("Skipping npm whoami; relying on npm trusted publishing or existing npm config.")
    return
  }

  console.log("Verifying npm authentication...")
  const result = runNpm(["whoami"], stageRoot, stageRoot, npmUserConfig)
  if (result.status !== 0) {
    throw new Error("npm authentication failed")
  }
}

function packageVersionExists(
  packageName: string,
  version: string,
  stageRoot: string,
  npmUserConfig?: string,
): boolean {
  const result = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
    cwd: stageRoot,
    env: npmEnv(stageRoot, npmUserConfig),
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

function publishPackage(pkg: PublishPackage, options: Options, stageRoot: string, npmUserConfig?: string): void {
  console.log(`\n${options.dryRun ? "Checking" : "Publishing"} ${pkg.name}@${pkg.version}`)

  if (!options.dryRun) {
    const alreadyPublished = packageVersionExists(pkg.name, pkg.version, stageRoot, npmUserConfig)
    if (alreadyPublished && options.skipExisting) {
      console.log(`Skipping ${pkg.name}@${pkg.version}; it already exists on npm.`)
      return
    }

    if (alreadyPublished) {
      throw new Error(`${pkg.name}@${pkg.version} already exists on npm`)
    }
  }

  const publishTarget = pkg.tarballPath ?? pkg.stageDir
  const publishArgs = ["publish", publishTarget, "--access", options.access]
  if (options.tag) {
    publishArgs.push("--tag", options.tag)
  }
  if (options.dryRun) {
    publishArgs.push("--dry-run")
  }

  const publish = runNpm(publishArgs, stageRoot, stageRoot, npmUserConfig)
  if (publish.status !== 0) {
    throw new Error(`Failed to ${options.dryRun ? "dry-run publish" : "publish"} ${pkg.name}@${pkg.version}`)
  }
}

function main(): void {
  const options = parseArgs()
  const stageRoot = mkdtempSync(join(tmpdir(), "opentui-scoped-publish-"))
  const npmUserConfig = createNpmUserConfig(stageRoot)

  try {
    console.log(`Staging packages for ${options.targetScope} in ${stageRoot}`)
    const packages = collectPackages(stageRoot, options)

    console.log("\nStaged packages:")
    for (const pkg of packages) {
      const sourceStat = statSync(pkg.sourceDir)
      if (!sourceStat.isDirectory()) {
        throw new Error(`Package source is not a directory: ${pkg.sourceDir}`)
      }
      console.log(`  - ${pkg.name}@${pkg.version}`)
    }

    if (options.packDestination) {
      packPackages(packages, options.packDestination, stageRoot, npmUserConfig)
    }

    if (options.packOnly) {
      console.log(`\nPacked ${packages.length} packages.`)
      return
    }

    if (!options.dryRun) {
      verifyNpmAuth(stageRoot, npmUserConfig)
    }

    for (const pkg of packages) {
      publishPackage(pkg, options, stageRoot, npmUserConfig)
    }

    console.log(`\n${options.dryRun ? "Dry run completed" : "Publish completed"} for ${packages.length} packages.`)
  } finally {
    if (options.keepStage) {
      console.log(`Keeping staged packages at ${stageRoot}`)
    } else {
      rmSync(stageRoot, { recursive: true, force: true })
    }
  }
}

main()
