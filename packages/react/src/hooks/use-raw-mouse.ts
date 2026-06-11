import { CliRenderEvents, type CliRendererRawMouseEvent } from "@opentui/core"
import { useEffect } from "react"
import { useEffectEvent } from "./use-event.js"
import { useRenderer } from "./use-renderer.js"

export const useRawMouse = (handler: (event: CliRendererRawMouseEvent) => void) => {
  const renderer = useRenderer()
  const stableHandler = useEffectEvent(handler)

  useEffect(() => {
    renderer.on(CliRenderEvents.RAW_MOUSE, stableHandler)
    return () => {
      renderer.off(CliRenderEvents.RAW_MOUSE, stableHandler)
    }
  }, [renderer])
}
