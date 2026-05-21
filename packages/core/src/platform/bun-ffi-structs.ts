let mod: typeof import("bun-ffi-structs")

try {
  mod = await import("bun-ffi-structs")
} catch (error) {
  if (process.versions.bun) {
    throw error
  }
  mod = (await import("./node22-bun-ffi-structs.js")) as typeof import("bun-ffi-structs")
}

export const defineStruct = mod.defineStruct
export const defineEnum = mod.defineEnum
