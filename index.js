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

// Configuration
const {
  IE_CONTRACT_ADDRESS = '0xc7893bee1d78178120ea8d7c98906ae904eef5f0',
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

// Database
const allMeasurements = []

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
  allMeasurements.push({
    jobId: measurement.job_id,
    peerId: measurement.peer_id,
    startedAt: new Date(measurement.started_at),
    endedAt: new Date(measurement.ended_at),
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
  const measurements = allMeasurements.filter(m => m.cid === null)
  if (!measurements.length) {
    console.log('No measurements to publish')
    return
  }
  console.log(`Publishing ${measurements.length} measurements`)

  // Share measurements
  const cid = await heliaDagCbor.add(measurements)
  console.log(`CID: ${cid}`)
  await helia.pins.add(cid)
  // TODO: Add cleanup

  // Call contract with CID
  console.log('ie.addMeasurement()...')
  await ieContractWithSigner.addMeasurement(cid.toString())
  console.log('ie.addMeasurement()')

  // Mark measurements as shared
  for (const m of measurements) {
    m.cid = cid
  }
}

const startPublishLoop = async () => {
  while (true) {
    await publish()
    await timers.setTimeout(60_000)
  }
}

startPublishLoop()
