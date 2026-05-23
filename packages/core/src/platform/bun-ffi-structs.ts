import { defineEnum as defineEnumImpl, defineStruct as defineStructImpl } from "./node22-bun-ffi-structs.js"
import type { defineEnum as DefineEnum, defineStruct as DefineStruct } from "bun-ffi-structs"

export const defineStruct = defineStructImpl as typeof DefineStruct
export const defineEnum = defineEnumImpl as typeof DefineEnum
