import {
  BoxRenderable,
  RootRenderable,
  type CliRenderer,
  type Renderable,
  type RootRenderable as CoreRootRenderable,
  type ScrollbackRenderContext,
  type ScrollbackSnapshot,
  type ScrollbackWriter,
} from "@opentui/core"
import React, { type ReactNode } from "react"
import type { OpaqueRoot } from "react-reconciler"
import { AppContext } from "./components/app.js"
import { ErrorBoundary } from "./components/error-boundary.js"
import { flushSync, flushSyncWork } from "./reconciler/flush.js"
import { _render, reconciler } from "./reconciler/reconciler.js"

interface SnapshotRendererBinding {
  renderer: CliRenderer
  getHeight: () => number
  setHeight: (height: number) => void
}

export interface ReactScrollbackWriterOptions {
  width?: number
  height?: number
  rowColumns?: number
  startOnNewLine?: boolean
  trailingNewline?: boolean
}

export type ReactScrollbackNode = (ctx: ScrollbackRenderContext) => ReactNode

const MAX_AUTO_HEIGHT_PASSES = 4
let reactScrollbackRootCounter = 0

function normalizeSnapshotDimension(value: number | undefined, axis: "width" | "height"): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value)) {
    throw new Error(`createScrollbackWriter requires a finite ${axis}`)
  }

  return Math.max(1, Math.trunc(value))
}

function createSnapshotRendererValue(
  renderContext: ScrollbackRenderContext["renderContext"],
  root: BoxRenderable,
  width: number,
  height: number,
  firstLineOffset: number,
): SnapshotRendererBinding {
  let snapshotHeight = height
  let offset = firstLineOffset
  const renderer = Object.create(renderContext) as CliRenderer

  Object.defineProperties(renderer, {
    root: {
      value: root,
      enumerable: true,
      configurable: true,
    },
    width: {
      get: () => width,
      enumerable: true,
      configurable: true,
    },
    height: {
      get: () => snapshotHeight,
      enumerable: true,
      configurable: true,
    },
    claimFirstLineOffset: {
      value: () => {
        const out = offset
        offset = 0
        return out
      },
      enumerable: true,
      configurable: true,
    },
  })

  return {
    renderer,
    getHeight: () => snapshotHeight,
    setHeight(nextHeight: number): void {
      snapshotHeight = nextHeight
      renderer.emit("resize", width, nextHeight)
      flushSyncWork()
    },
  }
}

function runLifecyclePasses(renderContext: ScrollbackRenderContext["renderContext"]): void {
  for (const renderable of renderContext.getLifecyclePasses()) {
    renderable.onLifecyclePass?.call(renderable)
  }
}

function clearLifecyclePasses(renderContext: ScrollbackRenderContext["renderContext"]): void {
  for (const renderable of [...renderContext.getLifecyclePasses()]) {
    renderContext.unregisterLifecyclePass(renderable)
  }
}

function measureSnapshotHeight(renderContext: ScrollbackRenderContext["renderContext"], root: Renderable): number {
  const measureRoot = new RootRenderable(renderContext)

  try {
    measureRoot.add(root)
    runLifecyclePasses(renderContext)
    measureRoot.calculateLayout()
    return Math.max(1, Math.trunc(root.getLayoutNode().getComputedLayout().height))
  } finally {
    if (root.parent === measureRoot) {
      measureRoot.remove(root.id)
    }
    measureRoot.destroyRecursively()
  }
}

function resolveSnapshotHeight(
  renderContext: ScrollbackRenderContext["renderContext"],
  root: Renderable,
  snapshotRenderer: SnapshotRendererBinding,
): number {
  for (let pass = 0; pass < MAX_AUTO_HEIGHT_PASSES; pass += 1) {
    const measuredHeight = measureSnapshotHeight(renderContext, root)

    if (measuredHeight === snapshotRenderer.getHeight()) {
      clearLifecyclePasses(renderContext)
      return measuredHeight
    }

    snapshotRenderer.setHeight(measuredHeight)
  }

  return measureSnapshotHeight(renderContext, root)
}

export function createScrollbackWriter(
  node: ReactScrollbackNode,
  options: ReactScrollbackWriterOptions = {},
): ScrollbackWriter {
  return (ctx: ScrollbackRenderContext): ScrollbackSnapshot => {
    const width = normalizeSnapshotDimension(options.width, "width") ?? Math.max(1, Math.trunc(ctx.width))
    const height = normalizeSnapshotDimension(options.height, "height")
    const startOnNewLine = options.startOnNewLine ?? true
    const firstLineWidth =
      !startOnNewLine && ctx.tailColumn > 0 && ctx.tailColumn < ctx.width
        ? Math.min(width, ctx.width - ctx.tailColumn)
        : width
    const firstLineOffset = width - firstLineWidth
    const root = new BoxRenderable(ctx.renderContext, {
      id: `react-scrollback-root-${reactScrollbackRootCounter++}`,
      position: "absolute",
      left: 0,
      top: 0,
      width,
      height: height ?? "auto",
      border: false,
      backgroundColor: "transparent",
      shouldFill: false,
      flexDirection: "column",
    })
    const snapshotRenderer = createSnapshotRendererValue(
      ctx.renderContext,
      root,
      width,
      height ?? Math.max(1, ctx.renderContext.height),
      firstLineOffset,
    )

    let container: OpaqueRoot | null = null
    let disposed = false

    const teardown = (): void => {
      if (disposed) {
        return
      }

      disposed = true

      if (container) {
        flushSync(() => {
          reconciler.updateContainer(null, container, null, () => {})
        })
        flushSyncWork()
        container = null
      }
    }

    try {
      flushSync(() => {
        container = _render(
          React.createElement(
            AppContext.Provider,
            { value: { keyHandler: snapshotRenderer.renderer.keyInput, renderer: snapshotRenderer.renderer } },
            React.createElement(ErrorBoundary, null, node(ctx)),
          ),
          root as unknown as CoreRootRenderable,
        )
      })
      flushSyncWork()

      return {
        root,
        width,
        height: height ?? resolveSnapshotHeight(ctx.renderContext, root, snapshotRenderer),
        rowColumns: options.rowColumns,
        startOnNewLine,
        trailingNewline: options.trailingNewline,
        teardown,
      }
    } catch (error) {
      teardown()
      root.destroyRecursively()
      throw error
    }
  }
}

export function writeReactToScrollback(
  renderer: CliRenderer,
  node: ReactScrollbackNode,
  options: ReactScrollbackWriterOptions = {},
): void {
  renderer.writeToScrollback(createScrollbackWriter(node, options))
}
