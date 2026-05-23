import { createCliRenderer, TextAttributes } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer, writeReactToScrollback } from "@opentui/react"
import { useState } from "react"

function App() {
  const renderer = useRenderer()
  const [count, setCount] = useState(0)
  const [partialCount, setPartialCount] = useState(0)
  const [lastAction, setLastAction] = useState("Ready")

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
      return
    }

    if (key.name === "w" || key.name === "return") {
      const nextCount = count + 1
      setCount(nextCount)
      setLastAction(`Wrote scrollback entry ${nextCount}`)

      writeReactToScrollback(
        renderer,
        () => (
          <box flexDirection="column">
            <text>
              <span style={{ fg: "#7ee787", attributes: TextAttributes.BOLD }}>react scrollback</span>{" "}
              <span style={{ fg: "#8b949e" }}>entry #{nextCount}</span>
            </text>
            <text>
              terminal time <span style={{ fg: "#d2a8ff" }}>{new Date().toLocaleTimeString()}</span>
            </text>
          </box>
        ),
        { trailingNewline: true },
      )
    }

    if (key.name === "p") {
      const nextPartialCount = partialCount + 1
      setPartialCount(nextPartialCount)
      setLastAction(`Started partial line ${nextPartialCount}`)

      writeReactToScrollback(
        renderer,
        () => (
          <text>
            <span style={{ fg: "#ffa657" }}>partial #{nextPartialCount}</span>
            <span style={{ fg: "#8b949e" }}> waiting for continuation</span>
          </text>
        ),
        {
          trailingNewline: false,
        },
      )
    }

    if (key.name === "i") {
      setLastAction("Wrote inline continuation; starts same row only after p")

      writeReactToScrollback(
        renderer,
        () => <text style={{ fg: "#ffa657" }}> + inline React commit</text>,
        {
          startOnNewLine: false,
          trailingNewline: true,
        },
      )
    }
  })

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <text style={{ fg: "#58a6ff", attributes: TextAttributes.BOLD }}>React scrollback writer demo</text>
      <text style={{ fg: "#8b949e" }}>Press w/Enter to append styled JSX above this footer.</text>
      <text style={{ fg: "#8b949e" }}>Press p to start a partial row, then i to continue it inline.</text>
      <text style={{ fg: "#8b949e" }}>Press q/Esc/Ctrl-C to quit.</text>
      <box border borderColor="#30363d" padding={1} flexDirection="column">
        <text>
          writes: <span style={{ fg: "#7ee787" }}>{count}</span>
        </text>
        <text>
          partial rows: <span style={{ fg: "#ffa657" }}>{partialCount}</span>
        </text>
        <text>
          status: <span style={{ fg: "#d2a8ff" }}>{lastAction}</span>
        </text>
      </box>
    </box>
  )
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    screenMode: "split-footer",
    footerHeight: 8,
    externalOutputMode: "capture-stdout",
    exitOnCtrlC: false,
  })

  createRoot(renderer).render(<App />)
}
