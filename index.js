import getRawBody from 'raw-body'
import assert from 'http-assert'
import { validate } from './lib/validate.js'
import timers from 'node:timers/promises'
import { Message } from '@glif/filecoin-message'
import { FilecoinNumber } from '@glif/filecoin-number'
import http from 'node:http'
import { Client } from 'pg'
import Filecoin, { HDWalletProvider } from '@glif/filecoin-wallet-provider'
import { createHelia } from 'healia'
import { dagCbor } from '@helia/dag-cbor'

const {
  IE_CONTRACT_ADDRESS,
  MEASURE_SERVICE_ADDRESS,
  IE_CONTRACT_MEASURE_METHOD_NUMBER,
  WALLET_SEED
} = process.env

const provider = new Filecoin(new HDWalletProvider(WALLET_SEED), {
  apiAddress: 'https://api.node.glif.io/rpc/v0'
})
const client = new Client()
await client.connect()

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
  await client.query(`
    INSERT INTO measurements (job_id, peer_id, started_at, ended_at)
    VALUES ($1, $2, $3, $4);
  `, [
    measurement.job_id,
    measurement.peer_id,
    new Date(measurement.started_at),
    new Date(measurement.ended_at)
  ])
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
const publish = async (client) => {
  // Fetch measurements
  const { rows: measurements } = await client.query(`
    SELECT *
    FROM measurements
    WHERE commitment_id IS NULL;
  `)

  // Expose measurements
  const cid = await heliaDagCbor.add(measurements)
  await helia.pins.add(cid)
  // TODO: Add cleanup

  // Call contract with CID
  const message = new Message({
    to: IE_CONTRACT_ADDRESS,
    from: MEASURE_SERVICE_ADDRESS,
    nonce: await provider.getNonce(MEASURE_SERVICE_ADDRESS),
    value: new FilecoinNumber('0'),
    method: IE_CONTRACT_MEASURE_METHOD_NUMBER,
    params: cid
  })
  const messageWithGas = await provider.gasEstimateMessageGas(
    message.toLotusType()
  )
  const lotusMessage = messageWithGas.toLotusType()
  const signedMessage = await provider.wallet.sign(from, lotusMessage)
  const res = await provider.sendMessage(signedMessage)
  console.log(res)
}

const startPublishLoop = async () => {
  while (true) {
    await publish()
    await timers.setTimeout(60_000)
  }
}

startPublishLoop()
