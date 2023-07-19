import getRawBody from 'raw-body'
import assert from 'http-assert'

//
// Phase 1: Store the measurements
//
const validate = (obj, key, { type }) => {
  assert(Object.keys(obj).includes(key) && obj[key] !== null, 400)
  if (type === 'date') {
    const date = new Date(obj[key])
    assert(!isNaN(date.getTime()), 400)
  } else {
    assert.strictEqual(typeof obj[key], type, 400)
  }
}

const handler = async (req, res, client) => {
  assert.strictEqual(req.url, '/measurements', 404)
  assert.strictEqual(req.method, 'POST', 404)
  const body = await getRawBody(req, { limit: '100kb' })
  const measurement = JSON.parse(body)
  validate(measurement, 'job_id', { type: 'string' })
  validate(measurement, 'peer_id', { type: 'string' })
  validate(measurement, 'started_at', { type: 'date' })
  validate(measurement, 'ended_at', { type: 'date' })
  try {
    await client.query(`
      INSERT INTO measurements (job_id, peer_id, started_at, ended_at)
      VALUES ($1, $2, $3, $4);
    `, [
      measurement.job_id,
      measurement.peer_id,
      new Date(measurement.started_at),
      new Date(measurement.ended_at)
    ])
  } catch (err) {
    if (err.constraint === 'measurements_pkey') {
      assert.fail(409, 'Measurement Already Recorded')
    } else {
      throw err
    }
  }
  res.end('OK')
}

export const createHandler = client => (req, res) =>
  handler(req, res, client)
    .catch(err => {
      console.error(err)
      res.statusCode = 500
      res.end(String(err))
    })

//
// Phase 2: Commit the measurements
//

// TODO
