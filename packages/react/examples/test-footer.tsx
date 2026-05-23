import { createCliRenderer, RGBA } from "@opentui/core"
import { createRoot } from "@opentui/react"
import React, { useState } from "react"

const FOOTER_ROWS = ["A", "B", "C", "D"] as const
const STDOUT_INTERVAL_MS = 16
const FOOTER_INTERVAL_MS = 900

const ANSI_RESET = "\x1b[0m"

type Colorize = (value: string) => string

function sgr(code: number): Colorize {
  return (value) => `\x1b[${code}m${value}${ANSI_RESET}`
}

const ansi = {
  dim: sgr(2),
  gray: sgr(90),
  red: sgr(31),
  green: sgr(32),
  yellow: sgr(33),
  blue: sgr(34),
  magenta: sgr(35),
  cyan: sgr(36),
  white: sgr(37),
  cyanBright: sgr(96),
  greenBright: sgr(92),
  blueBright: sgr(94),
  magentaBright: sgr(95),
  yellowBright: sgr(93),
  whiteBright: sgr(97),
}

const LEVELS: Array<{ label: string; color: Colorize }> = [
  { label: "TRACE", color: ansi.gray },
  { label: "DEBUG", color: ansi.cyan },
  { label: "INFO", color: ansi.blue },
  { label: "READY", color: ansi.green },
  { label: "WARN", color: ansi.yellow },
  { label: "ERROR", color: ansi.red },
  { label: "EVENT", color: ansi.magenta },
]

const SERVICES: Array<{ label: string; color: Colorize }> = [
  { label: "planner", color: ansi.cyanBright },
  { label: "worker", color: ansi.greenBright },
  { label: "materialize", color: ansi.blueBright },
  { label: "postgres", color: ansi.magentaBright },
  { label: "renderer", color: ansi.yellowBright },
  { label: "stdout", color: ansi.whiteBright },
]

const SNIPPETS = [
  "hydrated cache window",
  "streamed rows into scrollback",
  "applied footer resize probe",
  "rebuilt dependency graph",
  "checked split-footer boundary",
  "flushed render buffer",
  "sampled terminal dimensions",
  "updated live status rows",
  "reconciled optimistic plan",
  "published progress tick",
] as const

const DETAILS = [
  "duration=14ms",
  "rows=128",
  "batch=ivm",
  "mode=split-footer",
  "cursor=tail",
  "height=auto",
  "ansi=true",
  "frame=next",
] as const

const FOOTER_ROW_BACKGROUND = RGBA.fromInts(80, 140, 84, 102)
const FOOTER_ROW_TEXT = RGBA.fromInts(70, 160, 255)

function pick<T>(values: readonly T[], index: number): T {
  return values[index % values.length]
}

function formatLogLine(line: number): string {
  const level = pick(LEVELS, line)
  const service = pick(SERVICES, Math.floor(line / 2))
  const snippet = pick(SNIPPETS, Math.floor(line / 3))
  const detail = pick(DETAILS, Math.floor(line / 5))
  const id = ansi.dim(`#${line.toString().padStart(5, "0")}`)
  const timestamp = ansi.gray(new Date().toISOString().slice(11, 23))
  const levelText = level.color(level.label.padEnd(5))
  const serviceText = service.color(service.label.padEnd(11))
  const snippetText = pick([ansi.white, ansi.green, ansi.cyan, ansi.blue, ansi.magenta, ansi.yellow], line)(snippet)

  return [timestamp, id, levelText, serviceText, snippetText, ansi.dim(detail)].join(" ")
}

function Hoverable(props: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <text
      bg={hovered ? RGBA.fromInts(80, 140, 84, 102) : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      {props.children}
    </text>
  )
}

function SplitFooterProbe(props: { rowCount: number }) {
  const { rowCount } = props

  return (
    <box flexDirection="column" width="100%">
      {FOOTER_ROWS.slice(0, rowCount).map((row) => (
        <box key={row} width="100%" backgroundColor={FOOTER_ROW_BACKGROUND} flexDirection="row">
          {FOOTER_ROWS.map(() => (
            <Hoverable>{row}</Hoverable>
          ))}
        </box>
      ))}
    </box>
  )
}

async function main() {
  const { promise: exitPromise, resolve } = Promise.withResolvers<void>()
  const renderer = await createCliRenderer({
    screenMode: "split-footer",
    externalOutputMode: "capture-stdout",
    footerHeight: 1,
    useMouse: true,
    clearOnShutdown: false,
    exitOnCtrlC: false,
    onDestroy: resolve,
    // Why must we force this off?
    consoleMode: "disabled",
    openConsoleOnError: false,
  })
  const root = createRoot(renderer)
  let rowCount = 1

  function renderFooter() {
    renderer.footerHeight = rowCount
    root.render(<SplitFooterProbe rowCount={rowCount} />)
  }

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
    }
  })

  // if (renderer.externalOutputMode === "capture-stdout") {
  //   const seedRows = Math.max(renderer.terminalHeight - renderer.footerHeight, 0)
  //   if (seedRows > 0) {
  //     process.stdout.write("\n".repeat(seedRows))
  //     await renderer.idle()
  //   }
  // }

  renderFooter()

  let line = 1
  const stdoutInterval = setInterval(() => {
    process.stdout.write(`${formatLogLine(line)}\n`)
    line += 1
  }, STDOUT_INTERVAL_MS)
  const footerInterval = setInterval(() => {
    rowCount = rowCount >= FOOTER_ROWS.length ? 1 : rowCount + 1
    renderFooter()
  }, FOOTER_INTERVAL_MS)

  await exitPromise.finally(() => {
    clearInterval(stdoutInterval)
    clearInterval(footerInterval)
  })
}

void main()
