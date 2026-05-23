import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type YogaDefault from "yoga-layout"

export type { Config, Node } from "yoga-layout"

const require = createRequire(import.meta.url)
const yogaLoadEntryPath = require.resolve("yoga-layout/load")
const yogaDistPath = dirname(dirname(yogaLoadEntryPath))
const yogaBinaryPath = join(yogaDistPath, "binaries/yoga-wasm-base64-esm.js")
const yogaWrapAssemblyPath = join(yogaDistPath, "src/wrapAssembly.js")

export enum Align {
  Auto = 0,
  FlexStart = 1,
  Center = 2,
  FlexEnd = 3,
  Stretch = 4,
  Baseline = 5,
  SpaceBetween = 6,
  SpaceAround = 7,
  SpaceEvenly = 8,
}

export enum BoxSizing {
  BorderBox = 0,
  ContentBox = 1,
}

export enum Dimension {
  Width = 0,
  Height = 1,
}

export enum Direction {
  Inherit = 0,
  LTR = 1,
  RTL = 2,
}

export enum Display {
  Flex = 0,
  None = 1,
  Contents = 2,
}

export enum Edge {
  Left = 0,
  Top = 1,
  Right = 2,
  Bottom = 3,
  Start = 4,
  End = 5,
  Horizontal = 6,
  Vertical = 7,
  All = 8,
}

export enum Errata {
  None = 0,
  StretchFlexBasis = 1,
  AbsolutePositionWithoutInsetsExcludesPadding = 2,
  AbsolutePercentAgainstInnerSize = 4,
  All = 2147483647,
  Classic = 2147483646,
}

export enum ExperimentalFeature {
  WebFlexBasis = 0,
}

export enum FlexDirection {
  Column = 0,
  ColumnReverse = 1,
  Row = 2,
  RowReverse = 3,
}

export enum Gutter {
  Column = 0,
  Row = 1,
  All = 2,
}

export enum Justify {
  FlexStart = 0,
  Center = 1,
  FlexEnd = 2,
  SpaceBetween = 3,
  SpaceAround = 4,
  SpaceEvenly = 5,
}

export enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
  Verbose = 4,
  Fatal = 5,
}

export enum MeasureMode {
  Undefined = 0,
  Exactly = 1,
  AtMost = 2,
}

export enum NodeType {
  Default = 0,
  Text = 1,
}

export enum Overflow {
  Visible = 0,
  Hidden = 1,
  Scroll = 2,
}

export enum PositionType {
  Static = 0,
  Relative = 1,
  Absolute = 2,
}

export enum Unit {
  Undefined = 0,
  Point = 1,
  Percent = 2,
  Auto = 3,
}

export enum Wrap {
  NoWrap = 0,
  Wrap = 1,
  WrapReverse = 2,
}

type YogaLoaderModule = {
  instantiateWasm(
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance) => void,
  ): WebAssembly.Exports
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function loadYogaWasmBytes(): Uint8Array<ArrayBuffer> {
  const source = readFileSync(yogaBinaryPath, "utf8")
  const match = source.match(/H\s*=\s*"data:application\/octet-stream;base64,([^"]+)"/)
  if (!match) {
    throw new Error("Unable to locate yoga-layout WASM payload")
  }
  return decodeBase64(match[1])
}

function createYoga(): typeof YogaDefault {
  const loadYogaImpl = require(yogaBinaryPath).default as (module: YogaLoaderModule) => Promise<YogaLoaderModule>
  const wrapAssembly = require(yogaWrapAssemblyPath).default as (module: YogaLoaderModule) => typeof YogaDefault
  const wasmBytes = loadYogaWasmBytes()
  const module: YogaLoaderModule = {
    instantiateWasm(imports, receiveInstance) {
      const wasmModule = new WebAssembly.Module(wasmBytes)
      const instance = new WebAssembly.Instance(wasmModule, imports)
      receiveInstance(instance)
      return instance.exports
    },
  }

  void loadYogaImpl(module)
  return wrapAssembly(module)
}

const Yoga: typeof YogaDefault = createYoga()

export default Yoga
