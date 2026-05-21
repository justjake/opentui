import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { isAnyArrayBuffer, isArrayBuffer, isArrayBufferView } from "node:util/types"
import {
  LIBRARY_CLOSED,
  NODE_CALLBACK_THREADSAFE,
  NODE_NAPI_UNSUPPORTED,
  NODE_POINTER_OVERRIDE,
  NODE_PTR_VALUE,
  NODE_STRING_RETURN,
  POINTER_NEGATIVE,
  POINTER_UNSAFE,
  type FFICallbackInstance,
  type FFIFunction,
  type FFITypeOrString,
  type FfiBackend,
  type Pointer,
} from "./ffi.js"

type KoffiExternal = object & { __koffi_external__: true }
type KoffiFunction = ((...args: unknown[]) => unknown) & { async?: unknown }
type KoffiRegisteredCallback = KoffiExternal
type KoffiTypeSpec = unknown
type UnsafePointerOf = (value: ArrayBuffer) => Pointer
type UnsafeArrayBufferAt = (pointer: Pointer, offset: number | undefined, length: number) => ArrayBuffer

interface KoffiModule {
  address(pointer: KoffiExternal): bigint | number
  extension: string
  load(path: string): KoffiLib
  opaque(name?: string): KoffiTypeSpec
  pointer(nameOrType: string | KoffiTypeSpec, type?: KoffiTypeSpec): KoffiTypeSpec
  proto(returns: KoffiTypeSpec, args: KoffiTypeSpec[]): KoffiTypeSpec
  register(callback: (...args: any[]) => any, type: KoffiTypeSpec): KoffiRegisteredCallback
  unregister(callback: KoffiRegisteredCallback): void
  types: Record<string, KoffiTypeSpec>
}

interface KoffiLib {
  func(name: string, returns: KoffiTypeSpec, args: KoffiTypeSpec[]): KoffiFunction
  unload(): void
}

interface UnsafePointerModule {
  unsafePointerOf: UnsafePointerOf
  unsafeArrayBufferAt: UnsafeArrayBufferAt
}

interface Node22Modules {
  koffi: KoffiModule
  unsafePointerOf: UnsafePointerOf
  unsafeArrayBufferAt: UnsafeArrayBufferAt
}

const requireModule = createRequire(import.meta.url)
const emptyPtrSentinel = new Uint8Array(1)

export function createNode22Backend(modules = loadNode22Modules()): FfiBackend {
  const { koffi, unsafePointerOf, unsafeArrayBufferAt } = modules
  const bunPtrType = koffi.pointer("BunPtr", koffi.opaque())
  const bufferType = koffi.opaque("Buffer")
  const napiEnvType = koffi.opaque("NapiEnv")
  const napiValueType = koffi.opaque("NapiValue")

  const ffiTypeToKoffiType = (type: FFITypeOrString, position: "parameter" | "result"): KoffiTypeSpec => {
    switch (type) {
      case "char":
        return koffi.types.char
      case "int8_t":
      case "i8":
        return koffi.types.int8_t
      case "uint8_t":
      case "u8":
        return koffi.types.uint8_t
      case "int16_t":
      case "i16":
        return koffi.types.int16_t
      case "uint16_t":
      case "u16":
        return koffi.types.uint16_t
      case "int32_t":
      case "int":
      case "i32":
        return koffi.types.int32_t
      case "uint32_t":
      case "u32":
        return koffi.types.uint32_t
      case "int64_t":
      case "i64":
        return koffi.types.int64_t
      case "uint64_t":
      case "u64":
      case "usize":
        return koffi.types.uint64_t
      case "double":
      case "f64":
        return koffi.types.double
      case "float":
      case "f32":
        return koffi.types.float
      case "bool":
        return koffi.types.bool
      case "ptr":
      case "pointer":
      case "function":
      case "callback":
        return bunPtrType
      case "void":
        return koffi.types.void
      case "cstring":
        if (position === "result") {
          throw new Error(NODE_STRING_RETURN)
        }

        return koffi.types.string
      case "buffer":
        return bufferType
      case "napi_env":
        throw new Error(NODE_NAPI_UNSUPPORTED, { cause: napiEnvType })
      case "napi_value":
        throw new Error(NODE_NAPI_UNSUPPORTED, { cause: napiValueType })
      default:
        return unsupportedNode22FFIType(type)
    }
  }

  const argsToKoffiTypes = (args: readonly FFITypeOrString[] | undefined): KoffiTypeSpec[] =>
    args?.map((type) => ffiTypeToKoffiType(type, "parameter")) ?? []

  const returnsToKoffiType = (returns: FFITypeOrString | undefined): KoffiTypeSpec =>
    ffiTypeToKoffiType(returns ?? "void", "result")

  const createRawCallback = (callback: (...args: any[]) => any, definition: FFIFunction): FFICallbackInstance => {
    if (definition.ptr != null) {
      throw new Error(NODE_POINTER_OVERRIDE)
    }

    if (definition.threadsafe) {
      throw new Error(NODE_CALLBACK_THREADSAFE)
    }

    const pointerArgIndices = getTypeIndices(definition.args, isPointerType)
    const wrappedCallback =
      pointerArgIndices.length === 0
        ? callback
        : (...args: any[]) => {
            for (const index of pointerArgIndices) {
              args[index] = koffiPointerToPointer(koffi, args[index])
            }
            return callback(...args)
          }

    const proto = koffi.proto(returnsToKoffiType(definition.returns), argsToKoffiTypes(definition.args))
    let registeredCallback: KoffiRegisteredCallback | null = koffi.register(wrappedCallback, koffi.pointer(proto))

    return {
      get ptr() {
        return registeredCallback ? koffiPointerToPointer(koffi, registeredCallback) : null
      },
      threadsafe: false,
      close() {
        if (!registeredCallback) {
          return
        }

        koffi.unregister(registeredCallback)
        registeredCallback = null
      },
    }
  }

  const createFunction = (lib: KoffiLib, name: string, definition: FFIFunction): KoffiFunction => {
    if (definition.ptr != null) {
      throw new Error(NODE_POINTER_OVERRIDE)
    }

    const func = lib.func(name, returnsToKoffiType(definition.returns), argsToKoffiTypes(definition.args))
    const pointerArgIndices = getTypeIndices(definition.args, isPointerType)
    const boolArgIndices = getTypeIndices(definition.args, isBoolType)
    const returnsPointer = isPointerType(definition.returns)
    const returnsBigInt = isBigIntType(definition.returns)

    if (pointerArgIndices.length === 0 && boolArgIndices.length === 0 && !returnsPointer && !returnsBigInt) {
      return func
    }

    const wrapper = (...args: unknown[]) => {
      for (const index of boolArgIndices) {
        args[index] = Boolean(args[index])
      }

      for (const index of pointerArgIndices) {
        args[index] = pointerArgToKoffiArg(args[index])
      }

      const result = func(...args)

      if (returnsPointer) {
        return koffiPointerToPointer(koffi, result)
      }

      if (returnsBigInt) {
        return typeof result === "bigint" ? result : BigInt(result as number)
      }

      return result
    }

    Object.defineProperty(wrapper, "name", { value: name })
    return wrapper
  }

  return {
    dlopen(path, symbols) {
      if (path === null) {
        throw new Error("Node 22 FFI backend does not support dlopen(null)")
      }

      const lib = koffi.load(path instanceof URL ? fileURLToPath(path) : path)
      const callbacks = new Set<FFICallbackInstance>()
      let closed = false

      return {
        symbols: Object.fromEntries(
          Object.entries(symbols).map(([name, definition]) => [name, createFunction(lib, name, definition)]),
        ) as { [K in keyof typeof symbols]: (...args: any[]) => any },
        createCallback(callback, definition) {
          if (closed) {
            throw new Error(LIBRARY_CLOSED)
          }

          const raw = createRawCallback(callback, definition)
          const managed = createManagedCallback(raw, callbacks)
          callbacks.add(managed)
          return managed
        },
        close() {
          if (closed) {
            return
          }

          closed = true

          try {
            lib.unload()
          } finally {
            for (const callback of [...callbacks]) {
              callback.close()
            }
          }
        },
      }
    },
    ptr(value) {
      if (isArrayBufferView(value)) {
        if (!isArrayBuffer(value.buffer)) {
          throw new TypeError(NODE_PTR_VALUE)
        }

        return offsetPointer(unsafePointerOf(value.buffer), value.byteOffset)
      }

      if (isAnyArrayBuffer(value)) {
        return unsafePointerOf(value as ArrayBuffer)
      }

      throw new TypeError(NODE_PTR_VALUE)
    },
    suffix: koffi.extension.slice(1),
    toArrayBuffer: unsafeArrayBufferAt,
  }
}

function loadNode22Modules(): Node22Modules {
  const koffiModule = requireModule("koffi") as KoffiModule & { default?: KoffiModule }
  const unsafePointerModule = requireModule("unsafe-pointer") as UnsafePointerModule

  return {
    koffi: koffiModule.default ?? koffiModule,
    unsafePointerOf: unsafePointerModule.unsafePointerOf,
    unsafeArrayBufferAt: unsafePointerModule.unsafeArrayBufferAt,
  }
}

function createManagedCallback(raw: FFICallbackInstance, callbacks: Set<FFICallbackInstance>): FFICallbackInstance {
  let ptr = raw.ptr
  let closed = false

  const instance: FFICallbackInstance = {
    get ptr() {
      return ptr
    },
    get threadsafe() {
      return raw.threadsafe
    },
    close() {
      if (closed) {
        return
      }

      closed = true
      callbacks.delete(instance)
      try {
        raw.close()
      } finally {
        ptr = null
      }
    },
  }

  return instance
}

function getTypeIndices(
  types: readonly FFITypeOrString[] | undefined,
  predicate: (type: FFITypeOrString | undefined) => boolean,
): number[] {
  const indices: number[] = []

  for (let index = 0; index < (types?.length ?? 0); index++) {
    if (predicate(types?.[index])) {
      indices.push(index)
    }
  }

  return indices
}

function isPointerType(type: FFITypeOrString | undefined): boolean {
  return type === "ptr" || type === "pointer" || type === "function" || type === "callback"
}

function isBoolType(type: FFITypeOrString | undefined): boolean {
  return type === "bool"
}

function isBigIntType(type: FFITypeOrString | undefined): boolean {
  return type === "int64_t" || type === "i64" || type === "uint64_t" || type === "u64" || type === "usize"
}

function pointerArgToKoffiArg(arg: unknown): unknown {
  if (typeof arg === "number") {
    return BigInt(arg)
  }

  if (typeof arg === "bigint") {
    return arg
  }

  if ((isArrayBufferView(arg) || isAnyArrayBuffer(arg)) && arg.byteLength === 0) {
    return emptyPtrSentinel
  }

  return arg
}

function koffiPointerToPointer(koffi: KoffiModule, pointer: KoffiExternal | bigint | number | null | unknown): Pointer {
  if (pointer === null) {
    return 0 as Pointer
  }

  if (typeof pointer === "object") {
    return toSafeNumberPointer(koffi.address(pointer as KoffiExternal)) as Pointer
  }

  return toSafeNumberPointer(pointer as bigint | number) as Pointer
}

function offsetPointer(pointer: Pointer, offset: number): Pointer {
  return toSafeNumberPointer(BigInt(pointer) + BigInt(offset)) as Pointer
}

function toSafeNumberPointer(pointer: bigint | number): number {
  if (typeof pointer === "number") {
    if (pointer < 0) {
      throw new Error(POINTER_NEGATIVE)
    }

    if (!Number.isSafeInteger(pointer)) {
      throw new Error(POINTER_UNSAFE)
    }

    return pointer
  }

  if (pointer < 0n) {
    throw new Error(POINTER_NEGATIVE)
  }

  if (pointer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(POINTER_UNSAFE)
  }

  return Number(pointer)
}

function unsupportedNode22FFIType(type: never): never {
  throw new Error(`Unsupported FFIType for Node 22 koffi backend: ${String(type)}`)
}
