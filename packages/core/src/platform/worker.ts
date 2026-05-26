import { Worker as NodeWorker } from "node:worker_threads"

type WorkerPath = string | URL

export interface PlatformWorker {
  onerror: ((error: ErrorEvent) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: unknown): void
  terminate(): Promise<unknown> | void
}

export class Worker implements PlatformWorker {
  public onerror: ((error: ErrorEvent) => void) | null = null
  public onmessage: ((event: MessageEvent) => void) | null = null

  private readonly worker: NodeWorker

  constructor(workerPath: WorkerPath) {
    this.worker = new NodeWorker(resolveNodeWorkerPath(workerPath))

    this.worker.on("message", (data) => {
      this.onmessage?.({ data } as MessageEvent)
    })

    this.worker.on("error", (error) => {
      this.onerror?.({ error, message: error.message } as ErrorEvent)
    })
  }

  public postMessage(message: unknown): void {
    this.worker.postMessage(message)
  }

  public terminate(): Promise<number> {
    return this.worker.terminate()
  }
}

function resolveNodeWorkerPath(workerPath: WorkerPath): WorkerPath {
  if (workerPath instanceof URL) {
    return workerPath
  }

  if (workerPath.startsWith("file:")) {
    return new URL(workerPath)
  }

  return workerPath
}
