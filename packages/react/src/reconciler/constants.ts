import * as constantsModule from "react-reconciler/constants.js"

type ReconcilerConstants = typeof constantsModule

const constants = ((constantsModule as ReconcilerConstants & { default?: ReconcilerConstants }).default ??
  constantsModule) as ReconcilerConstants

export const ConcurrentRoot = constants.ConcurrentRoot
export const DefaultEventPriority = constants.DefaultEventPriority
export const NoEventPriority = constants.NoEventPriority ?? 0
