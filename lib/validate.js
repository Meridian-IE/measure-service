import assert from 'http-assert'

export const validate = (obj, key, { type }) => {
  assert(Object.keys(obj).includes(key) && obj[key] !== null, 400)
  if (type === 'date') {
    const date = new Date(obj[key])
    assert(!isNaN(date.getTime()), 400)
  } else {
    assert.strictEqual(typeof obj[key], type, 400)
  }
}
