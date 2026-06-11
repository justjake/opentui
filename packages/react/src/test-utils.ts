import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing"
import React, { type ReactNode } from "react"
import { createRoot, type Root } from "./reconciler/renderer.js"

type Act = (callback: () => void) => void
const reactAct =
  (React as typeof React & { act?: Act; unstable_act?: Act }).act ??
  (React as typeof React & { act?: Act; unstable_act?: Act }).unstable_act
if (!reactAct) {
  throw new Error("@opentui/react/test-utils requires React.act or React.unstable_act")
}

function setIsReactActEnvironment(isReactActEnvironment: boolean) {
  // @ts-expect-error - this is a test environment
  globalThis.IS_REACT_ACT_ENVIRONMENT = isReactActEnvironment
}

export async function testRender(node: ReactNode, testRendererOptions: TestRendererOptions) {
  let root: Root | null = null
  setIsReactActEnvironment(true)

  const testSetup = await createTestRenderer({
    ...testRendererOptions,
    onDestroy() {
      reactAct(() => {
        if (root) {
          root.unmount()
          root = null
        }
      })
      testRendererOptions.onDestroy?.()
      setIsReactActEnvironment(false)
    },
  })

  root = createRoot(testSetup.renderer)
  reactAct(() => {
    if (root) {
      root.render(node)
    }
  })

  return testSetup
}
