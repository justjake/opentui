import { existsSync } from "node:fs"
import { extname } from "node:path"
import { pathToFileURL } from "node:url"
import { Worker as NodeWorker } from "node:worker_threads"

type MessageEventLike<T = unknown> = { data: T }
type ErrorEventLike = { message: string }

const ownExtension = extname(import.meta.url)
const knownProtocolRegex = /^(file|data|node):/
const windowsDriveProtocolRegex = /^[a-zA-Z]:$/
const windowsAbsolutePathRegex = /^[a-zA-Z]:[\\/]/

function pathLikeToFileURL(path: string): string {
  if (windowsAbsolutePathRegex.test(path)) {
    return new URL(`file:///${path.replace(/\\/g, "/")}`).href
  }

  return pathToFileURL(path).href
}

export function resolveWorkerTarget(url: string | URL): string {
  if (url instanceof URL) {
    if (windowsDriveProtocolRegex.test(url.protocol)) {
      return pathLikeToFileURL(url.href)
    }
    return url.href
  }

  // allowing any <words>:<anything> will confuse windows absolute path starting
  // with a drive letter with a valid url.
  if (knownProtocolRegex.test(url)) {
    return url
  }

  return pathLikeToFileURL(url)
}

export function resolveWorkerEntrypoint(url: string | URL): string | URL {
  const target = resolveWorkerTarget(url)
  if (knownProtocolRegex.test(target)) {
    return new URL(target)
  }
  return target
}

export function resolveImportArg(url: string | URL): string {
  return `--import=${resolveWorkerTarget(url)}`
}

function normalizeExtension(specifier: string): string
function normalizeExtension(specifier: URL): URL
function normalizeExtension(specifier: string | URL): string | URL {
  if (existsSync(specifier)) {
    return specifier
  }

  const stringSpecifier = String(specifier)
  const extension = extname(stringSpecifier)
  if (extension === ownExtension) {
    return specifier
  }

  const newSpecifier = stringSpecifier.slice(0, -extension.length) + ownExtension
  if (specifier instanceof URL) {
    return new URL(newSpecifier)
  }
  return newSpecifier
}

let trampoline: URL | undefined
let registerJs: string | URL | undefined

export class Worker extends NodeWorker {
  onmessage: ((event: MessageEventLike) => void) | null = null
  onerror: ((event: ErrorEventLike) => void) | null = null

  constructor(url: string | URL) {
    let execArgv = process.execArgv
    if (import.meta.url.endsWith(".ts")) {
      registerJs ??= normalizeExtension(new URL("./registerResolveJs.js", import.meta.url))
      const registerJsArg = resolveImportArg(registerJs)
      if (!execArgv.includes(registerJsArg)) {
        execArgv = [...execArgv, registerJsArg]
      }
    }

    trampoline ??= normalizeExtension(new URL("./trampoline.worker.js", import.meta.url))
    super(resolveWorkerEntrypoint(trampoline), {
      workerData: {
        targetUrl: resolveWorkerTarget(url),
      },
      execArgv,
    })

    this.on("message", (data: unknown) => {
      this.onmessage?.({ data })
    })

    this.on("error", (error: Error) => {
      this.onerror?.(error)
    })
  }
}
