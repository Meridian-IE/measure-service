import getRawBody from 'raw-body'
import assert from 'http-assert'
import { validate } from './lib/validate.js'
import timers from 'node:timers/promises'
import { MerkleTree } from 'merkletreejs'
import crypto from 'node:crypto'
import { Message } from '@glif/filecoin-message'
import { FilecoinNumber } from '@glif/filecoin-number'
import http from 'node:http'
import { Client } from 'pg'

const {
  MEASURE_CONTRACT_ADDRESS,
  MEASURE_SERVICE_ADDRESS,
  MEASURE_CONTRACT_METHOD_NUMBER
} = process.env

const client = new Client()
await client.connect()

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
// Phase 2: Commit the measurements
//
const commit = async (client) => {
  // Fetch measurements
  const { rows: measurements } = await client.query(`
    SELECT *
    FROM measurements
    WHERE committment_id IS NULL;
  `)

  // Create Merkle tree
  const sha256 = str => crypto.createHash('sha256').update(str).digest()
  const leaves = measurements
    .map(measurement => sha256(JSON.stringify(measurement)))
  const tree = new MerkleTree(leaves, sha256, { sortLeaves: true })

  // Store Merkle tree
  const { rows: [commitment] } = await client.query(`
    INSERT INTO commitments (tree)
    VALUES ($1)
    RETURNING id;
  `, [
    MerkleTree.marshallTree(tree)
  ]);
  await client.query(`
    UPDATE measurements
    SET commitment_id = $1
    WHERE id IN ($2);
  `, [
    commitment.id,
    measurements.map(({ id }) => id)
  ])

  // Call contract with Merkle root hash
  const message = new Message({
    to: MEASURE_CONTRACT_ADDRESS,
    from: MEASURE_SERVICE_ADDRESS,
    nonce: await provider.getNonce(MEASURE_SERVICE_ADDRESS),
    value: new FilecoinNumber('0'),
    method: MEASURE_CONTRACT_METHOD_NUMBER,
    params: JSON.stringify({
      root: tree.getRoot().toString('hex')
    })
  })
  const messageWithGas = await provider.gasEstimateMessageGas(
    message.toLotusType()
  )
  const lotusMessage = messageWithGas.toLotusType()
  const signedMessage = await provider.wallet.sign(from, lotusMessage)
  const { '/': cid } = await provider.sendMessage(signedMessage)
  console.log({ cid })
}

const startCommitLoop = async () => {
  while (true) {
    await commit()
    await timers.setTimeout(60_000)
  }
}

startCommitLoop()
