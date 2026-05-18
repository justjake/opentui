import { describe, expect, it } from "bun:test"
import { pathToFileURL } from "node:url"
import { resolveImportArg, resolveWorkerEntrypoint, resolveWorkerTarget } from "./Worker.js"

describe("Node.js Worker compatibility", () => {
  it("keeps supported worker URL schemes", () => {
    expect(resolveWorkerTarget("file:///tmp/parser.worker.js")).toBe("file:///tmp/parser.worker.js")
    expect(resolveWorkerTarget("data:text/javascript,postMessage(null)")).toBe("data:text/javascript,postMessage(null)")
    expect(resolveWorkerTarget("node:module")).toBe("node:module")
  })

  it("converts filesystem worker paths to file URLs", () => {
    const targetPath = process.platform === "win32" ? "D:\\a\\opentui\\parser.worker.js" : "/tmp/parser.worker.js"

    expect(resolveWorkerTarget(targetPath)).toBe(pathToFileURL(targetPath).href)
  })

  it("converts Windows drive-letter paths to file URLs on all platforms", () => {
    expect(resolveWorkerTarget("D:\\a\\open tui\\parser.worker.js")).toBe("file:///D:/a/open%20tui/parser.worker.js")
    expect(resolveWorkerTarget("D:/a/open tui/parser.worker.js")).toBe("file:///D:/a/open%20tui/parser.worker.js")
  })

  it("converts Windows drive-letter URL objects to file URLs", () => {
    const targetUrl = new URL("D:/a/opentui/parser.worker.js")

    expect(resolveWorkerTarget(targetUrl)).toBe("file:///d:/a/opentui/parser.worker.js")
  })

  it("wraps file URL worker entrypoints for Node.js Worker", () => {
    const entrypoint = resolveWorkerEntrypoint(new URL("D:/a/opentui/trampoline.worker.js"))

    expect(entrypoint).toBeInstanceOf(URL)
    expect(String(entrypoint)).toBe("file:///d:/a/opentui/trampoline.worker.js")
  })

  it("uses file URL specifiers for Node.js import hooks", () => {
    expect(resolveImportArg(new URL("D:/a/opentui/registerResolveJs.ts"))).toBe(
      "--import=file:///d:/a/opentui/registerResolveJs.ts",
    )
  })
})
