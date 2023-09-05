import getRawBody from 'raw-body'
import assert from 'http-assert'
import { validate } from './lib/validate.js'
import timers from 'node:timers/promises'
import http from 'node:http'
import { ethers } from 'ethers'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { db } from './lib/db.js'
import { newDelegatedEthAddress } from '@glif/filecoin-address'
import { Web3Storage } from 'web3.storage'

// Configuration
const {
  IE_CONTRACT_ADDRESS = '0x816830a1e536784ecb37cf97dfd7a98a82c86643',
  WALLET_SEED = 'test test test test test test test test test test test junk',
  RPC_URL = 'https://api.calibration.node.glif.io/rpc/v0',
  WEB3_STORAGE_API_TOKEN
} = process.env

// Set up contract
const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
// provider.on('debug', d => console.log(JSON.stringify(d, null, 2)))
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
console.log(
  'Wallet address:',
  signer.address,
  newDelegatedEthAddress(signer.address, 't').toString()
)

const web3Storage = new Web3Storage({ token: WEB3_STORAGE_API_TOKEN })

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
  const file = new File([JSON.stringify(measurements)], 'measurements.json', { type: 'application/json' })
  const cid = await web3Storage.put([file])
  console.log(`Measurements packaged in ${cid}`)

  // Call contract with CID
  console.log('ie.addMeasurements()...')
  const tx = await ieContractWithSigner.addMeasurements(cid.toString())
  const receipt = await tx.wait()
  const event = receipt.events.find(e => e.event === 'MeasurementsAdded')
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
    publish().catch(console.error)
    await timers.setTimeout(120_000)
  }
}

startPublishLoop()
