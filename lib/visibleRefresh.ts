/** Background tabs must not create recurring Auth/API traffic. No audit is sampled. */
export function visibleRefresh(task: () => Promise<void>, visible: () => boolean) {
  let running = false
  let stopped = false
  return {
    async tick() {
      if (stopped || running || !visible()) return
      running = true
      try { await task() } finally { running = false }
    },
    stop() { stopped = true },
  }
}
