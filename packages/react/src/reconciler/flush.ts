import { reconciler } from "./reconciler.js"

type ReactReconcilerWithFlush = typeof reconciler & {
  flushSyncFromReconciler?: typeof reconciler.flushSync
  flushSyncWork?: typeof reconciler.flushSync
}

const reconcilerWithFlush = reconciler as ReactReconcilerWithFlush
const getReconcilerFlush = (): typeof reconciler.flushSync =>
  reconcilerWithFlush.flushSyncFromReconciler ?? reconciler.flushSync

export const flushSync: typeof reconciler.flushSync = ((callback?: Parameters<typeof reconciler.flushSync>[0]) => {
  if (callback === undefined) {
    return (getReconcilerFlush() as () => unknown)()
  }

  return getReconcilerFlush()(callback)
}) as typeof reconciler.flushSync

export function flushSyncWork(): void {
  if (reconcilerWithFlush.flushSyncWork) {
    reconcilerWithFlush.flushSyncWork()
    return
  }

  getReconcilerFlush()()
}
