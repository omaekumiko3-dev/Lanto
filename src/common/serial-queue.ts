export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve()

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work)
    this.pending = result.catch(() => {})
    return result
  }

  async drain(): Promise<void> {
    await this.pending
  }
}
