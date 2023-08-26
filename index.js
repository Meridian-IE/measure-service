import getRawBody from 'raw-body'
import assert from 'http-assert'
import { validate } from './lib/validate.js'
import timers from 'node:timers/promises'
import http from 'node:http'
import { createHelia } from 'helia'
import { dagCbor } from '@helia/dag-cbor'
import { ethers } from 'ethers'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { db } from './lib/db.js'

// Configuration
const {
  IE_CONTRACT_ADDRESS = '0xedb63b83ca55233432357a7aa2b150407f8ea256',
  WALLET_SEED = 'test test test test test test test test test test test junk',
  RPC_URL = 'https://api.calibration.node.glif.io/rpc/v1',
} = process.env

// Set up contract
const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
const signer = ethers.Wallet.fromMnemonic(WALLET_SEED).connect(provider)

const ieContract = new ethers.Contract(
  IE_CONTRACT_ADDRESS,
  JSON.parse(
    await fs.readFile(
      fileURLToPath(new URL('./abi.json', import.meta.url)),
      'utf8'
    )
  ),
  provider
)
const ieContractWithSigner = ieContract.connect(signer)

// Set up IPFS
const helia = await createHelia()
const heliaDagCbor = dagCbor(helia)

//
// Phase 1: Store the measurements
//
const handler = async (req, res) => {
  assert.strictEqual(req.url, '/measurements', 404)
  assert.strictEqual(req.method, 'POST', 404)
  const body = await getRawBody(req, { limit: '100kb' })
  const measurement = JSON.parse(body)
  validate(measurement, 'job_id', { type: 'string' })
  validate(measurement, 'peer_id', { type: 'string' })
  validate(measurement, 'started_at', { type: 'date' })
  validate(measurement, 'ended_at', { type: 'date' })
  db.measurements.push({
    jobId: measurement.job_id,
    peerId: measurement.peer_id,
    startedAt: measurement.started_at,
    endedAt: measurement.ended_at,
    cid: null
  })
  res.end('OK')
}

http.createServer((req, res) => {
  handler(req, res).catch(err => {
    console.error(err)
    res.statusCode = 500
    res.end(String(err))
  })
}).listen()

//
// Phase 2: Publish the measurements
//
const publish = async () => {
  // Fetch measurements
  const measurements = db.measurements.filter(m => m.cid === null)
  console.log(`Publishing ${measurements.length} measurements`)

  // Share measurements
  const cid = await heliaDagCbor.add(measurements)
  console.log(`Measurements packaged in ${cid}`)
  await helia.pins.add(cid)
  // TODO: Add cleanup

  // Call contract with CID
  console.log('ie.addMeasurement()...')
  const tx = await ieContractWithSigner.addMeasurement(cid.toString())
  const receipt = await tx.wait()
  const event = receipt.events.find(e => e.event === 'MeasurementAdded')
  const { roundIndex } = event.args
  console.log('Measurements added to round', roundIndex.toString())

  // Mark measurements as shared
  for (const m of measurements) {
    m.cid = cid
  }

  console.log('Done!')
}

const startPublishLoop = async () => {
  while (true) {
    await publish()
    await timers.setTimeout(10_000)
  }
}

startPublishLoop()
