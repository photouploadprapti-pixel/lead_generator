/**
 * Parse a Vercel request body as JSON.
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @returns {Record<string, unknown>}
 */
const parseBody = (req) => {
  if (req.body && typeof req.body === 'object') {
    return /** @type {Record<string, unknown>} */ (req.body)
  }
  if (typeof req.body === 'string' && req.body.length) {
    return JSON.parse(req.body)
  }
  return {}
}

module.exports = { parseBody }
