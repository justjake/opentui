import { describe, expect, it } from "bun:test"
import { pathToFileURL } from "node:url"
import { resolveWorkerTarget } from "./Worker.js"

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

  it("converts Windows drive-letter URL objects to file URLs", () => {
    if (process.platform !== "win32") {
      return
    }

    const targetUrl = new URL("D:/a/opentui/parser.worker.js")

    expect(resolveWorkerTarget(targetUrl)).toBe(pathToFileURL(targetUrl.href).href)
  })
})
