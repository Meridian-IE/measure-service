import { randomUUID } from 'node:crypto'
import timers from 'node:timers/promises'
import { generateMnemonic } from '@zondax/filecoin-signing-tools'
import { ethers } from 'ethers'

export const db = {
  measurements: []
}

const peerIds = []
for (let i = 0; i < 100; i++) {
  peerIds.push(ethers.Wallet.fromMnemonic(generateMnemonic()).address)
}

;(async () => {
  while (true) {
    db.measurements.push({
      jobId: randomUUID(),
      peerId: peerIds[Math.floor(Math.random() * peerIds.length)],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      cid: null
    })
    await timers.setTimeout(100)
  }
})()
