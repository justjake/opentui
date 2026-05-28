import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing.js"
import { BoxRenderable } from "../renderables/Box.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { TextRenderable } from "../renderables/Text.js"
import { type OptimizedBuffer } from "../buffer.js"

let renderer: TestRenderer
let renderOnce: () => Promise<void>
const decoder = new TextDecoder()

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({ width: 24, height: 8 }))
})

afterEach(() => {
  renderer.destroy()
})

function addLine(parent: { add(renderable: TextRenderable): unknown }, content: string): TextRenderable {
  const line = new TextRenderable(renderer, {
    content,
    height: 1,
  })
  parent.add(line)
  return line
}

function bufferToString(buffer: OptimizedBuffer): string {
  const raw = decoder.decode(buffer.getRealCharBytes(false))
  return Array.from({ length: buffer.height }, (_, index) =>
    raw.slice(index * buffer.width, (index + 1) * buffer.width).trimEnd(),
  ).join("\n")
}

describe("CliRenderer.renderToBuffer", () => {
  test("renders a positioned subtree into a tight buffer", async () => {
    const box = new BoxRenderable(renderer, {
      left: 5,
      top: 2,
      width: 12,
      height: 2,
      position: "absolute",
    })
    renderer.root.add(box)
    addLine(box, "Hello")

    await renderOnce()

    const buffer = renderer.renderToBuffer({ renderable: box })
    try {
      expect(buffer.width).toBe(12)
      expect(buffer.height).toBe(2)
      expect(bufferToString(buffer).split("\n")[0]).toBe("Hello")
    } finally {
      buffer.destroy()
    }
  })

  test("content clip renders all selected content without mutating scroll state", async () => {
    const scrollBox = new ScrollBoxRenderable(renderer, {
      width: 12,
      height: 4,
      viewportCulling: true,
    })
    renderer.root.add(scrollBox)

    for (let i = 0; i < 20; i += 1) {
      addLine(scrollBox, `Line ${i}`)
    }

    await renderOnce()
    scrollBox.scrollTo(10)
    await renderOnce()

    expect(scrollBox.content.screenY).toBeLessThan(0)
    const buffer = renderer.renderToBuffer({ renderable: scrollBox.content, clip: "content" })
    try {
      expect(buffer.width).toBe(scrollBox.content.width)
      expect(buffer.height).toBeGreaterThan(renderer.height)
      const text = bufferToString(buffer)
      for (let i = 0; i < 20; i += 1) {
        expect(text).toContain(`Line ${i}`)
      }
      expect(scrollBox.scrollTop).toBe(10)
    } finally {
      buffer.destroy()
    }
  })

  test("renders a selected renderable that starts at negative x", async () => {
    const box = new BoxRenderable(renderer, {
      left: -3,
      top: 1,
      width: 10,
      height: 1,
      position: "absolute",
    })
    renderer.root.add(box)
    addLine(box, "NegativeX")

    await renderOnce()

    expect(box.screenX).toBe(-3)
    const buffer = renderer.renderToBuffer({ renderable: box })
    try {
      expect(buffer.width).toBe(10)
      expect(buffer.height).toBe(1)
      expect(bufferToString(buffer)).toBe("NegativeX")
    } finally {
      buffer.destroy()
    }
  })

  test("renders a selected renderable that starts at negative y", async () => {
    const box = new BoxRenderable(renderer, {
      left: 1,
      top: -2,
      width: 8,
      height: 3,
      position: "absolute",
    })
    renderer.root.add(box)
    const text = new TextRenderable(renderer, {
      content: "Below",
      top: 2,
      height: 1,
      position: "absolute",
    })
    box.add(text)

    await renderOnce()

    expect(box.screenY).toBe(-2)
    const buffer = renderer.renderToBuffer({ renderable: box })
    try {
      expect(buffer.width).toBe(8)
      expect(buffer.height).toBe(3)
      expect(bufferToString(buffer).split("\n")[2]).toBe("Below")
    } finally {
      buffer.destroy()
    }
  })

  test("clips content outside an in-bounds selected renderable", async () => {
    const box = new BoxRenderable(renderer, {
      left: 2,
      top: 1,
      width: 6,
      height: 2,
      position: "absolute",
    })
    renderer.root.add(box)

    const inside = new TextRenderable(renderer, {
      content: "Inside",
      height: 1,
    })
    box.add(inside)

    const below = new TextRenderable(renderer, {
      content: "Below",
      top: 2,
      height: 1,
      position: "absolute",
    })
    box.add(below)

    const right = new TextRenderable(renderer, {
      content: "Right",
      left: 6,
      height: 1,
      position: "absolute",
    })
    box.add(right)

    await renderOnce()

    const buffer = renderer.renderToBuffer({ renderable: box, clip: "content" })
    try {
      expect(buffer.width).toBe(6)
      expect(buffer.height).toBe(2)
      const text = bufferToString(buffer)
      expect(text).toContain("Inside")
      expect(text).not.toContain("Below")
      expect(text).not.toContain("Right")
    } finally {
      buffer.destroy()
    }
  })

  test("self clip preserves selected renderable culling", async () => {
    const scrollBox = new ScrollBoxRenderable(renderer, {
      width: 12,
      height: 4,
      viewportCulling: true,
    })
    renderer.root.add(scrollBox)

    for (let i = 0; i < 20; i += 1) {
      addLine(scrollBox, `Line ${i}`)
    }

    await renderOnce()
    scrollBox.scrollTo(10)
    await renderOnce()

    const buffer = renderer.renderToBuffer({ renderable: scrollBox.content, clip: "self" })
    try {
      const text = bufferToString(buffer)
      expect(text).not.toContain("Line 0")
      expect(text).toContain("Line 10")
    } finally {
      buffer.destroy()
    }
  })

  test("content clip does not disable clipping inside descendant scrollboxes", async () => {
    const outer = new ScrollBoxRenderable(renderer, {
      width: 16,
      height: 6,
      viewportCulling: true,
    })
    renderer.root.add(outer)

    addLine(outer, "Outer 0")

    const inner = new ScrollBoxRenderable(renderer, {
      width: 12,
      height: 3,
      viewportCulling: true,
    })
    outer.add(inner)

    for (let i = 0; i < 5; i += 1) {
      addLine(inner, `Inner ${i}`)
    }

    await renderOnce()
    inner.scrollTo(2)
    await renderOnce()

    const buffer = renderer.renderToBuffer({ renderable: outer.content, clip: "content" })
    try {
      const text = bufferToString(buffer)
      expect(text).toContain("Outer 0")
      expect(text).toContain("Inner 2")
      expect(text).not.toContain("Inner 0")
    } finally {
      buffer.destroy()
    }
  })

  test("returned buffer can be enqueued as a scrollback snapshot commit", async () => {
    renderer.destroy()
    const setup = await createTestRenderer({
      width: 24,
      height: 8,
      screenMode: "split-footer",
      externalOutputMode: "capture-stdout",
    })
    renderer = setup.renderer
    renderOnce = setup.renderOnce

    const box = new BoxRenderable(renderer, {
      width: 8,
      height: 1,
    })
    renderer.root.add(box)
    addLine(box, "Commit")

    await renderOnce()

    const buffer = renderer.renderToBuffer({ renderable: box })
    renderer.enqueueRenderedScrollbackCommit({
      snapshot: buffer,
      rowColumns: buffer.width,
      startOnNewLine: true,
      trailingNewline: true,
    })

    const commits = setup.externalOutput.take()
    expect(commits).toHaveLength(1)
    expect(commits[0]?.text).toContain("Commit")

    await renderOnce()
  })
})
