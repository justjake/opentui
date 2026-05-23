import { stringWidth, stripANSI } from "../platform/runtime.js"

export type ExternalOutputRendering = "emulated" | "terminal-native"

export interface CapturedStdoutPassthroughCommit {
  kind: "passthrough"
  snapshot: CapturedStdoutPassthroughSnapshot
  text: string
  bytes: Uint8Array
  rowWidths: Uint32Array
  startOnNewLine: false
  trailingNewline: boolean
}

interface CapturedStdoutPassthroughSnapshot {
  width: 0
  height: 0
  destroy(): void
}

interface CapturedStdoutRow {
  line: string
  trailingNewline: boolean
}

const encoder = new TextEncoder()
const passthroughSnapshot: CapturedStdoutPassthroughSnapshot = {
  width: 0,
  height: 0,
  destroy() {},
}

function splitCapturedStdoutRows(text: string): CapturedStdoutRow[] {
  const rows: CapturedStdoutRow[] = []
  let current = ""

  for (const char of text) {
    if (char === "\n") {
      rows.push({ line: current, trailingNewline: true })
      current = ""
      continue
    }

    current += char
  }

  if (current.length > 0) {
    rows.push({ line: current, trailingNewline: false })
  }

  return rows
}

function getCapturedStdoutRowWidth(line: string): number {
  const visibleLine = stripANSI(line).split("\r").at(-1) ?? ""
  return stringWidth(visibleLine)
}

export function createCapturedStdoutPassthroughCommit(text: string): CapturedStdoutPassthroughCommit | null {
  if (text.length === 0) {
    return null
  }

  const rows = splitCapturedStdoutRows(text)
  if (rows.length === 0) {
    return null
  }

  return {
    kind: "passthrough",
    snapshot: passthroughSnapshot,
    text,
    bytes: encoder.encode(text),
    rowWidths: Uint32Array.from(rows.map((row) => getCapturedStdoutRowWidth(row.line))),
    startOnNewLine: false,
    trailingNewline: rows[rows.length - 1]?.trailingNewline ?? false,
  }
}
