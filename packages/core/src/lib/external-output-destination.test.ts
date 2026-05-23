import { afterEach, expect, test } from "bun:test"
import { closeSync, mkdirSync, openSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import {
  hasSameOutputDestination,
  type OutputDestinationStat,
  type OutputDestinationStatFn,
} from "./external-output-destination.js"

const openFds: number[] = []
const tempDirs: string[] = []

function streamWithFd(fd: number): NodeJS.WriteStream {
  return { fd } as NodeJS.WriteStream
}

function stat(options: { dev: number; ino: number; rdev?: number; characterDevice?: boolean }): OutputDestinationStat {
  return {
    dev: options.dev,
    ino: options.ino,
    rdev: options.rdev ?? 0,
    isCharacterDevice: () => options.characterDevice ?? false,
  }
}

function openTempFile(name: string): number {
  const dir = join(tmpdir(), `opentui-output-destination-${process.pid}-${tempDirs.length}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  const fd = openSync(join(dir, name), "w+")
  openFds.push(fd)
  return fd
}

afterEach(() => {
  while (openFds.length > 0) {
    closeSync(openFds.pop()!)
  }

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

test("hasSameOutputDestination detects stdout fd 1 and stderr fd 2 attached to the same terminal", () => {
  const getStat: OutputDestinationStatFn = (fd) => {
    if (fd === 1) {
      return stat({ dev: 10, ino: 1, rdev: 99, characterDevice: true })
    }
    if (fd === 2) {
      return stat({ dev: 10, ino: 2, rdev: 99, characterDevice: true })
    }
    throw new Error(`unexpected fd ${fd}`)
  }

  expect(hasSameOutputDestination(streamWithFd(1), streamWithFd(2), getStat)).toBe(true)
})

test("hasSameOutputDestination detects stdout and stderr redirected to the same file", () => {
  const path = join(tmpdir(), `opentui-output-destination-same-file-${process.pid}`)
  const stdoutFd = openSync(path, "w+")
  const stderrFd = openSync(path, "r+")
  openFds.push(stdoutFd, stderrFd)
  tempDirs.push(path)

  expect(hasSameOutputDestination(streamWithFd(stdoutFd), streamWithFd(stderrFd))).toBe(true)
})

test("hasSameOutputDestination rejects stdout and stderr redirected to different files", () => {
  const stdoutFd = openTempFile("stdout")
  const stderrFd = openTempFile("stderr")

  expect(hasSameOutputDestination(streamWithFd(stdoutFd), streamWithFd(stderrFd))).toBe(false)
})

test("hasSameOutputDestination rejects stdout terminal and stderr redirected to a file", () => {
  const getStat: OutputDestinationStatFn = (fd) => {
    if (fd === 1) {
      return stat({ dev: 10, ino: 1, rdev: 99, characterDevice: true })
    }
    if (fd === 2) {
      return stat({ dev: 20, ino: 2, rdev: 0, characterDevice: false })
    }
    throw new Error(`unexpected fd ${fd}`)
  }

  expect(hasSameOutputDestination(streamWithFd(1), streamWithFd(2), getStat)).toBe(false)
})

test("hasSameOutputDestination accepts an explicit custom stream with fd matching stdout", () => {
  const getStat: OutputDestinationStatFn = () => {
    throw new Error("matching fds should not be statted")
  }

  expect(hasSameOutputDestination(streamWithFd(1), streamWithFd(1), getStat)).toBe(true)
})
