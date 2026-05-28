import {
  ASCIIFontRenderable,
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextTableRenderable,
  bold,
  createCliRenderer,
  fg,
  italic,
  t,
  type CliRenderer,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core"

const FOOTER_HEIGHT = 8

const PALETTE = {
  bg: "#10131a",
  panel: "#171b25",
  panelAlt: "#1d2330",
  border: "#3b82f6",
  borderAlt: "#64748b",
  title: "#f8fafc",
  text: "#d8dee9",
  muted: "#94a3b8",
  cyan: "#22d3ee",
  green: "#86efac",
  amber: "#facc15",
  rose: "#fb7185",
  violet: "#c084fc",
} as const

let shell: BoxRenderable | null = null
let scrollBox: ScrollBoxRenderable | null = null
let headerText: TextRenderable | null = null
let statusText: TextRenderable | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null
let shuttingDown = false
let snapshotting = false
let previousScreenMode: CliRenderer["screenMode"] | null = null
let previousExternalOutputMode: CliRenderer["externalOutputMode"] | null = null
let previousFooterHeight: number | null = null
let previousUseMouse: boolean | null = null

function cell(text: string): TextChunk[] {
  return [{ __isChunk: true, text }]
}

function styledCell(text: string, color: string): TextChunk[] {
  return [fg(color)(text)]
}

function addSection(renderer: CliRenderer, parent: ScrollBoxRenderable, index: number): void {
  const accent = [PALETTE.cyan, PALETTE.green, PALETTE.amber, PALETTE.rose, PALETTE.violet][index % 5]
  const card = new BoxRenderable(renderer, {
    id: `render-to-buffer-card-${index}`,
    width: "100%",
    marginBottom: 1,
    padding: 1,
    border: true,
    borderColor: index % 2 === 0 ? PALETTE.border : PALETTE.borderAlt,
    backgroundColor: index % 2 === 0 ? PALETTE.panel : PALETTE.panelAlt,
  })

  const title = new TextRenderable(renderer, {
    id: `render-to-buffer-title-${index}`,
    content: t`${fg(accent)(bold(`Section ${String(index + 1).padStart(2, "0")}`))} ${fg(PALETTE.muted)(
      "mixed renderable content",
    )}`,
    height: 1,
  })

  const body = new TextRenderable(renderer, {
    id: `render-to-buffer-body-${index}`,
    content: t`${fg(PALETTE.text)("This row is ordinary styled text with ")}${fg(accent)(
      italic("inline color and emphasis"),
    )}${fg(PALETTE.text)(". It should survive the offscreen render and snapshot commit.")}`,
    height: 2,
  })

  const table = new TextTableRenderable(renderer, {
    id: `render-to-buffer-table-${index}`,
    width: "100%",
    wrapMode: "word",
    columnFitter: "proportional",
    cellPadding: 0,
    border: true,
    outerBorder: false,
    showBorders: true,
    borderColor: accent,
    fg: PALETTE.text,
    bg: "transparent",
    content: [
      [[bold("Node")], [bold("State")], [bold("Notes")]],
      [cell(`box-${index}`), styledCell(index % 3 === 0 ? "hot" : "ready", accent), cell("border, padding, bg")],
      [cell(`text-${index}`), styledCell("styled", PALETTE.green), cell("template chunks and unicode: Δ λ →")],
      [cell(`table-${index}`), styledCell("wrapped", PALETTE.amber), cell("cells commit as part of snapshot")],
    ],
  })

  card.add(title)
  card.add(body)
  card.add(table)
  parent.add(card)

  if (index % 7 === 0) {
    const ascii = new ASCIIFontRenderable(renderer, {
      id: `render-to-buffer-ascii-${index}`,
      text: `SNAP ${index + 1}`,
      font: "tiny",
      color: accent,
      backgroundColor: "transparent",
      marginBottom: 1,
    })
    parent.add(ascii)
  }
}

function buildContent(renderer: CliRenderer): void {
  shell = new BoxRenderable(renderer, {
    id: "render-to-buffer-split-footer-shell",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: PALETTE.bg,
  })

  headerText = new TextRenderable(renderer, {
    id: "render-to-buffer-split-footer-header",
    height: 1,
    content: t`${fg(PALETTE.title)(bold("renderToBuffer split-footer demo"))} ${fg(PALETTE.muted)(
      "mouse wheel scrolls; s snapshots to scrollback; Ctrl-C snapshots then exits",
    )}`,
  })

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "render-to-buffer-split-footer-scrollbox",
    width: "100%",
    flexGrow: 1,
    scrollY: true,
    scrollX: false,
    viewportCulling: true,
    rootOptions: {
      border: true,
      borderColor: PALETTE.border,
      backgroundColor: PALETTE.bg,
    },
    viewportOptions: {
      backgroundColor: PALETTE.bg,
    },
    contentOptions: {
      flexDirection: "column",
      padding: 1,
      backgroundColor: PALETTE.bg,
    },
    scrollbarOptions: {
      trackOptions: {
        foregroundColor: PALETTE.border,
        backgroundColor: PALETTE.panelAlt,
      },
    },
  })

  statusText = new TextRenderable(renderer, {
    id: "render-to-buffer-split-footer-status",
    height: 1,
    content: t`${fg(PALETTE.cyan)("ready")} ${fg(PALETTE.muted)(
      `footer=${FOOTER_HEIGHT} mouse=on s=snapshot ctrl-c=snapshot+exit`,
    )}`,
  })

  shell.add(headerText)
  shell.add(scrollBox)
  shell.add(statusText)
  renderer.root.add(shell)

  for (let i = 0; i < 36; i += 1) {
    addSection(renderer, scrollBox, i)
  }
}

async function snapshotToScrollback(renderer: CliRenderer, exitAfterCommit: boolean): Promise<void> {
  if (snapshotting || shuttingDown) {
    return
  }

  snapshotting = true
  shuttingDown = exitAfterCommit

  let wasRunning = false

  try {
    if (!scrollBox) {
      if (exitAfterCommit) {
        renderer.destroy()
      }
      return
    }

    wasRunning = renderer.isRunning

    if (statusText) {
      statusText.content = t`${fg(PALETTE.amber)("committing")} ${fg(PALETTE.muted)(
        "rendering full scrollbox content to split scrollback...",
      )}`
    }

    renderer.stop()
    await renderer.idle()

    const snapshot = renderer.renderToBuffer({
      renderable: scrollBox.content,
      clip: "content",
    })
    const snapshotWidth = snapshot.width
    const snapshotHeight = snapshot.height

    renderer.enqueueRenderedScrollbackCommit({
      snapshot,
      rowColumns: snapshotWidth,
      startOnNewLine: true,
      trailingNewline: true,
    })

    await renderer.idle()

    if (exitAfterCommit) {
      renderer.destroy()
      return
    }

    if (statusText) {
      statusText.content = t`${fg(PALETTE.green)("committed")} ${fg(PALETTE.muted)(
        `snapshot ${snapshotWidth}x${snapshotHeight} appended to scrollback`,
      )}`
    }
  } finally {
    if (!exitAfterCommit && !renderer.isDestroyed) {
      snapshotting = false
      if (wasRunning) {
        renderer.start()
      } else {
        renderer.requestRender()
      }
    }
  }
}

async function snapshotAndExit(renderer: CliRenderer): Promise<void> {
  await snapshotToScrollback(renderer, true)
}

export function run(renderer: CliRenderer): void {
  previousScreenMode = renderer.screenMode
  previousExternalOutputMode = renderer.externalOutputMode
  previousFooterHeight = renderer.footerHeight
  previousUseMouse = renderer.useMouse

  renderer.screenMode = "split-footer"
  renderer.footerHeight = FOOTER_HEIGHT
  renderer.externalOutputMode = "capture-stdout"
  renderer.useMouse = true
  renderer.setBackgroundColor(PALETTE.bg)

  buildContent(renderer)

  keyHandler = (key: KeyEvent) => {
    if (key.name === "s" && !key.ctrl && !key.meta && !key.shift) {
      key.preventDefault()
      key.stopPropagation()
      void snapshotToScrollback(renderer, false).catch((error: unknown) => {
        snapshotting = false
        console.error("render-to-buffer split-footer snapshot failed:", error)
      })
      return
    }

    if (key.name === "c" && key.ctrl) {
      key.preventDefault()
      key.stopPropagation()
      void snapshotAndExit(renderer).catch((error: unknown) => {
        console.error("render-to-buffer split-footer snapshot failed:", error)
        renderer.destroy()
      })
    }
  }

  renderer.keyInput.on("keypress", keyHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (keyHandler) {
    renderer.keyInput.off("keypress", keyHandler)
    keyHandler = null
  }

  shell?.destroyRecursively()
  shell = null
  scrollBox = null
  headerText = null
  statusText = null
  shuttingDown = false
  snapshotting = false

  if (!renderer.isDestroyed) {
    if (previousExternalOutputMode) {
      renderer.externalOutputMode = previousExternalOutputMode
    }
    if (previousScreenMode) {
      renderer.screenMode = previousScreenMode
    }
    if (previousFooterHeight !== null) {
      renderer.footerHeight = previousFooterHeight
    }
    if (previousUseMouse !== null) {
      renderer.useMouse = previousUseMouse
    }
  }

  previousScreenMode = null
  previousExternalOutputMode = null
  previousFooterHeight = null
  previousUseMouse = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: true,
    enableMouseMovement: true,
    screenMode: "split-footer",
    footerHeight: FOOTER_HEIGHT,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
  })

  run(renderer)
  renderer.start()
}
