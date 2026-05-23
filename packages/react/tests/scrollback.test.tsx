import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { act } from "react"
import type { ReactNode } from "react"
import { useRenderer } from "../src/hooks/use-renderer.js"
import { writeReactToScrollback } from "../src/scrollback.js"

let setup: TestRendererSetup | null = null

function setIsReactActEnvironment(isReactActEnvironment: boolean): void {
  // @ts-expect-error - this is a test environment
  globalThis.IS_REACT_ACT_ENVIRONMENT = isReactActEnvironment
}

async function createScrollbackRenderer(): Promise<TestRendererSetup> {
  setIsReactActEnvironment(true)
  return createTestRenderer({
    width: 20,
    height: 8,
    screenMode: "split-footer",
    footerHeight: 3,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
    useThread: false,
  })
}

function Dimensions(): ReactNode {
  const renderer = useRenderer()
  return <text>{`${renderer.width}x${renderer.height}`}</text>
}

describe("React scrollback", () => {
  beforeEach(() => {
    if (setup) {
      act(() => {
        setup?.renderer.destroy()
      })
      setup = null
    }
  })

  afterEach(() => {
    if (setup) {
      act(() => {
        setup?.renderer.destroy()
      })
      setup = null
    }
    setIsReactActEnvironment(false)
  })

  test("writeReactToScrollback commits rendered React output", async () => {
    setup = await createScrollbackRenderer()

    act(() => {
      writeReactToScrollback(setup!.renderer, () => <text>react-line</text>, { trailingNewline: false })
    })

    const commits = setup.externalOutput.take()

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      text: "react-line",
      rows: ["react-line"],
      width: 20,
      height: 1,
      rowColumns: 20,
      startOnNewLine: true,
      trailingNewline: false,
    })
  })

  test("createScrollbackWriter auto-measures React snapshot height", async () => {
    setup = await createScrollbackRenderer()

    act(() => {
      writeReactToScrollback(
        setup!.renderer,
        () => (
          <box flexDirection="column">
            <text>one</text>
            <text>two</text>
          </box>
        ),
        { trailingNewline: false },
      )
    })

    const commits = setup.externalOutput.take()

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      text: "one\ntwo",
      rows: ["one", "two"],
      width: 20,
      height: 2,
      rowColumns: 20,
      trailingNewline: false,
    })
  })

  test("React scrollback nodes receive a snapshot renderer context", async () => {
    setup = await createScrollbackRenderer()

    act(() => {
      writeReactToScrollback(setup!.renderer, () => <Dimensions />, { height: 2, trailingNewline: false })
    })

    const commits = setup.externalOutput.take()

    expect(commits).toHaveLength(1)
    expect(commits[0].rows[0]).toBe("20x2")
  })

  test("writeReactToScrollback forwards row and newline options", async () => {
    setup = await createScrollbackRenderer()

    act(() => {
      writeReactToScrollback(setup!.renderer, () => <text>inline</text>, {
        rowColumns: 6,
        startOnNewLine: false,
        trailingNewline: false,
      })
    })

    const commits = setup.externalOutput.take()

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      rows: ["inline"],
      rowColumns: 6,
      startOnNewLine: false,
      trailingNewline: false,
    })
  })
})
