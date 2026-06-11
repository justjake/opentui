import { fstatSync } from "fs"

export interface OutputDestinationStat {
  dev: number
  ino: number
  rdev: number
  isCharacterDevice(): boolean
}

export type OutputDestinationStatFn = (fd: number) => OutputDestinationStat

function getWriteStreamFd(stream: NodeJS.WriteStream): number | undefined {
  const fd = (stream as { fd?: unknown }).fd
  return typeof fd === "number" && Number.isInteger(fd) && fd >= 0 ? fd : undefined
}

export function hasSameOutputDestination(
  stdout: NodeJS.WriteStream,
  stderr: NodeJS.WriteStream,
  getStat: OutputDestinationStatFn = fstatSync,
): boolean {
  if (stdout === stderr) {
    return true
  }

  const stdoutFd = getWriteStreamFd(stdout)
  const stderrFd = getWriteStreamFd(stderr)
  if (stdoutFd === undefined || stderrFd === undefined) {
    return false
  }
  if (stdoutFd === stderrFd) {
    return true
  }

  try {
    const stdoutStat = getStat(stdoutFd)
    const stderrStat = getStat(stderrFd)
    if (stdoutStat.isCharacterDevice() && stderrStat.isCharacterDevice()) {
      return stdoutStat.rdev === stderrStat.rdev
    }

    return stdoutStat.dev === stderrStat.dev && stdoutStat.ino === stderrStat.ino
  } catch {
    return false
  }
}
