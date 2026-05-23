import { isRenderable, type RootRenderable, type Renderable } from "../Renderable.js"
import { Direction } from "./yoga-sync.js"

export const DEFAULT_FOOTER_HEIGHT = 12
export const DEFAULT_AUTO_FOOTER_MIN_HEIGHT = 1

export type SplitFooterHeightMode = "fixed" | "auto"
export type SplitFooterHeight = number | "auto"

export interface SplitFooterSizingOptions {
  footerHeight?: SplitFooterHeight
  minFooterHeight?: number
  maxFooterHeight?: number
}

export interface SplitFooterSizing {
  mode: SplitFooterHeightMode
  height: number
  minHeight: number
  maxHeight: number
}

export interface ResolveAutoSplitFooterHeightOptions {
  root: RootRenderable
  terminalWidth: number
  terminalHeight: number
  currentHeight: number
  minHeight: number
  maxHeight: number
}

function normalizeFooterHeightValue(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`)
  }

  const normalized = Math.trunc(value)
  if (normalized <= 0) {
    throw new Error(`${name} must be greater than 0`)
  }

  return normalized
}

export function resolveSplitFooterSizing(
  screenMode: "alternate-screen" | "main-screen" | "split-footer",
  options: SplitFooterSizingOptions,
): SplitFooterSizing {
  if (screenMode !== "split-footer") {
    return {
      mode: "fixed",
      height: DEFAULT_FOOTER_HEIGHT,
      minHeight: DEFAULT_AUTO_FOOTER_MIN_HEIGHT,
      maxHeight: DEFAULT_FOOTER_HEIGHT,
    }
  }

  if (options.footerHeight !== "auto") {
    const height =
      options.footerHeight === undefined
        ? DEFAULT_FOOTER_HEIGHT
        : normalizeFooterHeightValue(options.footerHeight, "footerHeight")
    return {
      mode: "fixed",
      height,
      minHeight: DEFAULT_AUTO_FOOTER_MIN_HEIGHT,
      maxHeight: DEFAULT_FOOTER_HEIGHT,
    }
  }

  const minHeight =
    options.minFooterHeight === undefined
      ? DEFAULT_AUTO_FOOTER_MIN_HEIGHT
      : normalizeFooterHeightValue(options.minFooterHeight, "minFooterHeight")
  const maxHeight =
    options.maxFooterHeight === undefined
      ? DEFAULT_FOOTER_HEIGHT
      : normalizeFooterHeightValue(options.maxFooterHeight, "maxFooterHeight")

  if (maxHeight < minHeight) {
    throw new Error("maxFooterHeight must be greater than or equal to minFooterHeight")
  }

  return {
    mode: "auto",
    height: minHeight,
    minHeight,
    maxHeight,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function measureRenderableBottom(renderable: Renderable, parentTop: number): number {
  let bottom = 0

  for (const child of renderable.getChildren()) {
    if (!isRenderable(child) || !child.visible) {
      continue
    }

    const childLayout = child.getLayoutNode().getComputedLayout()
    const childTop = parentTop + childLayout.top
    const childBottom = childTop + childLayout.height

    bottom = Math.max(bottom, Math.ceil(childBottom), measureRenderableBottom(child, childTop))
  }

  return bottom
}

export function resolveAutoSplitFooterHeight(options: ResolveAutoSplitFooterHeightOptions): number {
  const terminalWidth = Math.max(Math.trunc(options.terminalWidth), 0)
  const terminalHeight = Math.max(Math.trunc(options.terminalHeight), 0)
  if (terminalWidth === 0 || terminalHeight === 0) {
    return options.minHeight
  }

  const maxHeight = Math.min(options.maxHeight, terminalHeight)
  const minHeight = Math.min(options.minHeight, maxHeight)
  const currentHeight = clamp(options.currentHeight, minHeight, maxHeight)
  const rootNode = options.root.getLayoutNode()

  rootNode.setWidth(terminalWidth)
  rootNode.setHeight(maxHeight)
  rootNode.calculateLayout(terminalWidth, maxHeight, Direction.LTR)

  const measuredHeight = clamp(measureRenderableBottom(options.root, 0), minHeight, maxHeight)

  rootNode.setWidth(terminalWidth)
  rootNode.setHeight(currentHeight)
  rootNode.calculateLayout(terminalWidth, currentHeight, Direction.LTR)

  return measuredHeight
}
