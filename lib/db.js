import { randomUUID } from 'node:crypto'
import timers from 'node:timers/promises'

export const db = {
  measurements: [],
  cids: []
}

;(async () => {
  while (true) {
    db.measurements.push({
      jobId: randomUUID(),
      peerId: randomUUID(),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      cid: null
    })
    await timers.setTimeout(100)
  }
})()