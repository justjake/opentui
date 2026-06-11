// @ts-nocheck
import { ptr, toArrayBuffer } from "./ffi.js"

export const pointerSize = process.arch === "x64" || process.arch === "arm64" ? 8 : 4

const typeSizes = {
  u8: 1,
  bool_u8: 1,
  bool_u32: 4,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  u64: 8,
  f32: 4,
  f64: 8,
  pointer: pointerSize,
}

const typeAlignments = { ...typeSizes }
const primitiveKeys = Object.keys(typeSizes)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function alignOffset(offset: number, align: number): number {
  return (offset + (align - 1)) & ~(align - 1)
}

function isPrimitiveType(type: unknown): boolean {
  return typeof type === "string" && primitiveKeys.includes(type)
}

function isEnum(type: unknown): boolean {
  return typeof type === "object" && type !== null && type.__type === "enum"
}

function isStruct(type: unknown): boolean {
  return typeof type === "object" && type !== null && type.__type === "struct"
}

function primitivePackers(type: string) {
  switch (type) {
    case "u8":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setUint8(offset, value ?? 0),
        unpack: (view: DataView, offset: number) => view.getUint8(offset),
      }
    case "bool_u8":
      return {
        pack: (view: DataView, offset: number, value: boolean) => view.setUint8(offset, value ? 1 : 0),
        unpack: (view: DataView, offset: number) => Boolean(view.getUint8(offset)),
      }
    case "bool_u32":
      return {
        pack: (view: DataView, offset: number, value: boolean) => view.setUint32(offset, value ? 1 : 0, true),
        unpack: (view: DataView, offset: number) => Boolean(view.getUint32(offset, true)),
      }
    case "u16":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setUint16(offset, value ?? 0, true),
        unpack: (view: DataView, offset: number) => view.getUint16(offset, true),
      }
    case "i16":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setInt16(offset, value ?? 0, true),
        unpack: (view: DataView, offset: number) => view.getInt16(offset, true),
      }
    case "u32":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setUint32(offset, value ?? 0, true),
        unpack: (view: DataView, offset: number) => view.getUint32(offset, true),
      }
    case "i32":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setInt32(offset, value ?? 0, true),
        unpack: (view: DataView, offset: number) => view.getInt32(offset, true),
      }
    case "u64":
      return {
        pack: (view: DataView, offset: number, value: bigint | number) =>
          view.setBigUint64(offset, BigInt(value ?? 0), true),
        unpack: (view: DataView, offset: number) => view.getBigUint64(offset, true),
      }
    case "f32":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setFloat32(offset, value ?? 0, true),
        unpack: (view: DataView, offset: number) => view.getFloat32(offset, true),
      }
    case "f64":
      return {
        pack: (view: DataView, offset: number, value: number) => view.setFloat64(offset, value ?? 0, true),
        unpack: (view: DataView, offset: number) => view.getFloat64(offset, true),
      }
    case "pointer":
      return {
        pack: (view: DataView, offset: number, value: bigint | number | null) => {
          if (pointerSize === 8) {
            view.setBigUint64(offset, value == null ? 0n : BigInt(value), true)
          } else {
            view.setUint32(offset, value == null ? 0 : Number(value), true)
          }
        },
        unpack: (view: DataView, offset: number) => {
          const value = pointerSize === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true))
          return Number(value)
        },
      }
    default:
      throw new Error(`Unsupported primitive type: ${type}`)
  }
}

const { pack: packPointer, unpack: unpackPointer } = primitivePackers("pointer")

export function defineEnum(mapping: Record<string, number>, base = "u32") {
  const reverse = Object.fromEntries(Object.entries(mapping).map(([key, value]) => [value, key]))

  return {
    __type: "enum",
    type: base,
    enum: mapping,
    to(value: string | number) {
      if (typeof value === "number") {
        return value
      }

      if (Object.hasOwn(mapping, value)) {
        return mapping[value]
      }

      throw new TypeError(`Invalid enum value: ${value}`)
    },
    from(value: number | bigint) {
      const key = reverse[Number(value)]
      if (key == null) {
        throw new TypeError(`Invalid enum value: ${String(value)}`)
      }
      return key
    },
  }
}

export function objectPtr() {
  return { __type: "objectPointer" }
}

export function packObjectArray(values: Array<{ ptr?: number | bigint | null } | null>): DataView {
  const buffer = new ArrayBuffer(values.length * pointerSize)
  const view = new DataView(buffer)

  for (let i = 0; i < values.length; i++) {
    packPointer(view, i * pointerSize, values[i]?.ptr ?? null)
  }

  return view
}

export function allocStruct(structDef: any, options?: { lengths?: Record<string, number> }) {
  const buffer = new ArrayBuffer(structDef.size)
  const view = new DataView(buffer)
  const result: { buffer: ArrayBuffer; view: DataView; subBuffers?: Record<string, ArrayBuffer> } = { buffer, view }

  if (!options?.lengths) {
    return result
  }

  const subBuffers: Record<string, ArrayBuffer> = {}
  for (const [fieldName, length] of Object.entries(options.lengths)) {
    const arrayMeta = structDef.arrayFields.get(fieldName)
    if (!arrayMeta) {
      throw new Error(`Field '${fieldName}' is not an array field with a lengthOf field`)
    }

    const subBuffer = new ArrayBuffer(length * arrayMeta.elementSize)
    subBuffers[fieldName] = subBuffer
    packPointer(view, arrayMeta.arrayOffset, length > 0 ? ptr(subBuffer) : null)
    arrayMeta.lengthPack(view, arrayMeta.lengthOffset, length)
  }

  result.subBuffers = subBuffers
  return result
}

export function defineStruct(fields: any[], structDefOptions: any = {}) {
  const layout: any[] = []
  const lengthOfFields = new Map<string, any>()
  const arrayFields = new Map<string, any>()
  let offset = 0
  let maxAlign = 1

  for (const [name, rawType, options = {}] of fields) {
    if (options.condition && !options.condition()) {
      continue
    }

    const field = buildField(name, rawType, options)
    offset = alignOffset(offset, field.align)
    field.offset = offset
    layout.push(field)
    offset += field.size
    maxAlign = Math.max(maxAlign, field.align)

    if (options.lengthOf) {
      lengthOfFields.set(options.lengthOf, field)
    }

    if (field.arrayElementType) {
      arrayFields.set(name, {
        elementSize: field.elementSize,
        arrayOffset: field.offset,
        lengthOffset: 0,
        lengthPack: primitivePackers("u32").pack,
      })
    }
  }

  const totalSize = alignOffset(offset, maxAlign)

  for (const [arrayName, lengthField] of lengthOfFields) {
    const field = layout.find((candidate) => candidate.name === arrayName)
    if (field) {
      field.lengthField = lengthField
    }

    const arrayMeta = arrayFields.get(arrayName)
    if (arrayMeta) {
      arrayMeta.lengthOffset = lengthField.offset
      arrayMeta.lengthPack = lengthField.packRaw
    }
  }

  const structDef = {
    __type: "struct",
    size: totalSize,
    align: maxAlign,
    layoutByName: new Map(layout.map((field) => [field.name, field])),
    arrayFields,
    pack(value: any, options?: any) {
      const buffer = new ArrayBuffer(totalSize)
      const view = new DataView(buffer)
      const mappedValue = structDefOptions.mapValue ? structDefOptions.mapValue(value) : value
      const context = { lengths: new Map<string, number>(), subBuffers: [] as ArrayBuffer[] }

      for (const field of layout) {
        const fieldValue = mappedValue[field.name] ?? field.default
        field.pack(view, field.offset, fieldValue, mappedValue, options, context)
      }

      if (context.subBuffers.length > 0) {
        Object.defineProperty(buffer, "__opentuiSubBuffers", { value: context.subBuffers })
      }

      return buffer
    },
    packInto(value: any, view: DataView, baseOffset: number, options?: any) {
      const mappedValue = structDefOptions.mapValue ? structDefOptions.mapValue(value) : value
      const context = { lengths: new Map<string, number>(), subBuffers: [] as ArrayBuffer[] }

      for (const field of layout) {
        const fieldValue = mappedValue[field.name] ?? field.default
        field.pack(view, baseOffset + field.offset, fieldValue, mappedValue, options, context)
      }
    },
    unpack(buffer: ArrayBuffer) {
      if (buffer.byteLength < totalSize) {
        throw new Error(`Buffer size (${buffer.byteLength}) is smaller than struct size (${totalSize}) for unpacking.`)
      }

      const view = new DataView(buffer)
      const result: Record<string, unknown> = structDefOptions.default ? { ...structDefOptions.default } : {}

      for (const field of layout) {
        if (!field.deferredUnpack) {
          result[field.name] = field.unpack(view, field.offset, result)
        }
      }

      for (const field of layout) {
        if (field.deferredUnpack) {
          result[field.name] = field.unpack(view, field.offset, result)
        }
      }

      return structDefOptions.reduceValue ? structDefOptions.reduceValue(result) : result
    },
    packList(values: any[], options?: any) {
      const buffer = new ArrayBuffer(totalSize * values.length)
      const view = new DataView(buffer)
      const subBuffers: ArrayBuffer[] = []

      values.forEach((value, index) => {
        const mappedValue = structDefOptions.mapValue ? structDefOptions.mapValue(value) : value
        const context = { lengths: new Map<string, number>(), subBuffers }
        for (const field of layout) {
          const fieldValue = mappedValue[field.name] ?? field.default
          field.pack(view, index * totalSize + field.offset, fieldValue, mappedValue, options, context)
        }
      })

      if (subBuffers.length > 0) {
        Object.defineProperty(buffer, "__opentuiSubBuffers", { value: subBuffers })
      }

      return buffer
    },
    unpackList(buffer: ArrayBuffer, count: number) {
      const result = []
      for (let index = 0; index < count; index++) {
        result.push(structDef.unpack(buffer.slice(index * totalSize, (index + 1) * totalSize)))
      }
      return result
    },
  }

  return structDef
}

function buildField(name: string, rawType: any, options: any) {
  const field: any = {
    name,
    type: rawType,
    default: options.default,
    optional: options.optional || options.default !== undefined || options.lengthOf !== undefined,
    deferredUnpack: false,
  }

  if (isPrimitiveType(rawType)) {
    const { pack, unpack } = primitivePackers(rawType)
    field.size = typeSizes[rawType]
    field.align = typeAlignments[rawType]
    field.packRaw = pack
    field.pack = (view: DataView, offset: number, value: unknown, input: any, _packOptions: any, context: any) => {
      const lengthValue = options.lengthOf ? context.lengths.get(options.lengthOf) : undefined
      const packedValue = options.packTransform ? options.packTransform(value) : (lengthValue ?? value)
      pack(view, offset, packedValue)
    }
    field.unpack = (view: DataView, offset: number) => {
      const value = unpack(view, offset)
      return options.unpackTransform ? options.unpackTransform(value) : value
    }
    return field
  }

  if (rawType === "char*" || rawType === "cstring") {
    field.size = pointerSize
    field.align = pointerSize
    field.deferredUnpack = rawType === "char*"
    field.pack = (
      view: DataView,
      offset: number,
      value: string | null | undefined,
      _input: any,
      _packOptions: any,
      context: any,
    ) => {
      if (!value) {
        packPointer(view, offset, null)
        context.lengths.set(name, 0)
        return
      }

      const buffer = rawType === "cstring" ? encoder.encode(`${value}\0`).buffer : encoder.encode(value).buffer
      context.subBuffers.push(buffer)
      context.lengths.set(name, rawType === "cstring" ? buffer.byteLength - 1 : buffer.byteLength)
      packPointer(view, offset, ptr(buffer))
    }
    field.unpack = (view: DataView, offset: number, result: Record<string, unknown>) => {
      const pointer = unpackPointer(view, offset)
      if (!pointer) {
        return rawType === "char*" && field.lengthField == null ? 0 : null
      }

      const length = Number(result[field.lengthField?.name] ?? 0)
      if (rawType === "char*" && field.lengthField != null) {
        // bun-ffi-structs@0.2.3: non-null pointer with zero length decodes to ""
        if (length === 0) return ""
        return decoder.decode(toArrayBuffer(pointer, 0, length))
      }

      return pointer
    }
    return field
  }

  if (isEnum(rawType)) {
    const { pack, unpack } = primitivePackers(rawType.type)
    field.size = typeSizes[rawType.type]
    field.align = typeAlignments[rawType.type]
    field.packRaw = pack
    field.pack = (view: DataView, offset: number, value: unknown) =>
      pack(view, offset, rawType.to(value ?? field.default))
    field.unpack = (view: DataView, offset: number) => rawType.from(unpack(view, offset))
    return field
  }

  if (isStruct(rawType)) {
    field.size = rawType.size
    field.align = rawType.align
    field.pack = (view: DataView, offset: number, value: unknown, _input: any, packOptions: any) =>
      rawType.packInto(value, view, offset, packOptions)
    field.unpack = (view: DataView, offset: number) => rawType.unpack(view.buffer.slice(offset, offset + rawType.size))
    return field
  }

  if (Array.isArray(rawType) && rawType.length === 1) {
    const elementType = rawType[0]
    field.size = pointerSize
    field.align = pointerSize
    field.arrayElementType = elementType
    field.elementSize = isPrimitiveType(elementType) ? typeSizes[elementType] : elementType.size
    field.deferredUnpack = true
    field.pack = (
      view: DataView,
      offset: number,
      value: Iterable<unknown> | null | undefined,
      _input: any,
      packOptions: any,
      context: any,
    ) => {
      const values = [...(value ?? [])]
      context.lengths.set(name, values.length)

      if (values.length === 0) {
        packPointer(view, offset, null)
        return
      }

      const buffer = new ArrayBuffer(values.length * field.elementSize)
      const arrayView = new DataView(buffer)
      const { pack } = isPrimitiveType(elementType) ? primitivePackers(elementType) : { pack: elementType.packInto }
      values.forEach((item, index) => pack(arrayView, index * field.elementSize, item, item, packOptions))
      context.subBuffers.push(buffer)
      packPointer(view, offset, ptr(buffer))
    }
    field.unpack = (view: DataView, offset: number, result: Record<string, unknown>) => {
      const pointer = unpackPointer(view, offset)
      const length = Number(result[field.lengthField?.name] ?? 0)
      if (!pointer || length === 0) {
        return []
      }

      const buffer = toArrayBuffer(pointer, 0, length * field.elementSize)
      const arrayView = new DataView(buffer)
      if (isPrimitiveType(elementType)) {
        const { unpack } = primitivePackers(elementType)
        return Array.from({ length }, (_, index) => unpack(arrayView, index * field.elementSize))
      }

      return Array.from({ length }, (_, index) =>
        elementType.unpack(buffer.slice(index * field.elementSize, (index + 1) * field.elementSize)),
      )
    }
    return field
  }

  throw new Error(`Unsupported struct field type for ${name}: ${String(rawType)}`)
}
