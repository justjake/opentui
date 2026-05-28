import { OptimizedBuffer } from "./buffer.js"
import { RGBA } from "./lib/RGBA.js"
import type { Renderable, RenderCommand, RootRenderable } from "./Renderable.js"
import type { WidthMethod } from "./types.js"

const TRANSPARENT_RGBA = RGBA.fromValues(0, 0, 0, 0)

export type RenderToBufferClip = "self" | "content"

export interface RenderToBufferOptions {
  renderable: Renderable
  clip?: RenderToBufferClip
}

export interface RenderToBufferRenderer {
  root: RootRenderable
  width: number
  height: number
  widthMethod: WidthMethod
}

function renderCommandList(buffer: OptimizedBuffer, renderList: RenderCommand[], deltaTime: number): void {
  for (const command of renderList) {
    switch (command.action) {
      case "render":
        if (!command.renderable.isDestroyed) {
          command.renderable.render(buffer, deltaTime)
        }
        break
      case "pushScissorRect":
        buffer.pushScissorRect(command.x, command.y, command.width, command.height)
        break
      case "popScissorRect":
        buffer.popScissorRect()
        break
      case "pushOpacity":
        buffer.pushOpacity(command.opacity)
        break
      case "popOpacity":
        buffer.popOpacity()
        break
    }
  }
}

function getRenderPath(renderable: Renderable): Renderable[] {
  const path: Renderable[] = []
  let current: Renderable | null = renderable

  while (current) {
    path.push(current)
    current = current.parent
  }

  return path.reverse()
}

function refreshAncestorLayout(root: RootRenderable, renderable: Renderable): void {
  if (root.getLayoutNode().isDirty()) {
    root.calculateLayout()
  }

  root.invalidateLayoutCacheRecursively()

  const path = getRenderPath(renderable)
  const rootIndex = path.indexOf(root)
  const ancestors = rootIndex === -1 ? path.slice(0, -1) : path.slice(rootIndex, -1)

  for (const ancestor of ancestors) {
    ancestor.updateFromLayout()
  }
}

function getTraversalOptions(clip: RenderToBufferClip): Parameters<Renderable["updateLayout"]>[2] {
  if (clip === "content") {
    return {
      ignoreSelfClip: true,
      ignoreSelfVisibleChildFilter: true,
    }
  }

  return {}
}

function normalizeRect(renderable: Renderable): {
  originX: number
  originY: number
  width: number
  height: number
} {
  const screenX = Math.trunc(renderable.screenX)
  const screenY = Math.trunc(renderable.screenY)
  const width = Math.max(1, Math.ceil(renderable.width))
  const height = Math.max(1, Math.ceil(renderable.height))

  return {
    originX: -screenX,
    originY: -screenY,
    width,
    height,
  }
}

export function renderToBuffer(
  renderer: RenderToBufferRenderer,
  options: RenderToBufferOptions,
  deltaTime: number = 0,
): OptimizedBuffer {
  const clip = options.clip ?? "self"
  const renderable = options.renderable

  if (renderable.isDestroyed) {
    throw new Error("Cannot render a destroyed renderable to a buffer")
  }

  refreshAncestorLayout(renderer.root, renderable)

  const { originX, originY, width, height } = normalizeRect(renderable)
  const buffer = OptimizedBuffer.create(width, height, renderer.widthMethod, {
    respectAlpha: true,
    id: "render-to-buffer",
  })
  let didReturn = false

  try {
    buffer.clear(TRANSPARENT_RGBA)
    const renderList: RenderCommand[] = []
    renderable.updateLayout(deltaTime, renderList, getTraversalOptions(clip))

    buffer.pushOrigin(originX, originY)
    try {
      renderCommandList(buffer, renderList, deltaTime)
    } finally {
      buffer.popOrigin()
    }

    didReturn = true
    return buffer
  } finally {
    if (!didReturn) {
      buffer.destroy()
    }
  }
}
