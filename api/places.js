const https = require('https')
const { URL } = require('url')

const { parseBody } = require('../lib/parse-body')

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDJt_83h5jYhu-KT5EsLFy24HZhMw57vQU'
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const SEARCH_FIELD_MASK = 'places.id,nextPageToken'
const DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri'

/**
 * Send an HTTPS request and parse the JSON response.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
const httpsJson = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const headers = { ...(options.headers || {}) }
    if (options.body) {
      headers['Content-Length'] = String(Buffer.byteLength(options.body))
    }

    const req = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

/**
 * Call Places API (New) with the shared API key headers.
 * @param {string} url
 * @param {{ method?: string, fieldMask: string, body?: Record<string, unknown> }} options
 * @returns {Promise<Record<string, unknown>>}
 */
const placesRequest = (url, options) => {
  const headers = {
    'X-Goog-Api-Key': API_KEY,
    'X-Goog-FieldMask': options.fieldMask
  }
  let body
  if (options.body) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  return httpsJson(url, { method: options.method || 'GET', headers, body })
}

/**
 * Return a readable error from a Places API (New) response, if present.
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
const getGoogleError = (payload) => {
  const error = payload.error
  if (!error || typeof error !== 'object') return ''
  const message = /** @type {{ message?: unknown }} */ (error).message
  return typeof message === 'string' ? message : 'Google Places request failed'
}

/**
 * Fetch a web page, following a single redirect hop.
 * @param {string} url
 * @returns {Promise<string>}
 */
const fetchPage = (url) => {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? require('https') : require('http')
      const req = mod.get(url, {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          fetchPage(res.headers.location).then(resolve)
          return
        }
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve(data))
      })
      req.on('error', () => resolve(''))
      req.on('timeout', () => {
        req.destroy()
        resolve('')
      })
    } catch (e) {
      resolve('')
    }
  })
}

/**
 * Scrape the first email address found on a website homepage or contact page.
 * @param {string} website
 * @returns {Promise<string>}
 */
const scrapeEmailFromWebsite = async (website) => {
  if (!website) return ''
  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

  /**
   * Normalize common email obfuscation patterns.
   * @param {string} text
   * @returns {string}
   */
  const clean = (text) =>
    text
      .replace(/\[at\]/g, '@')
      .replace(/\(at\)/g, '@')
      .replace(/\[dot\]/g, '.')
      .replace(/\(dot\)/g, '.')

  let text = clean(await fetchPage(website))
  let matches = text.match(emailRegex)
  if (matches && matches.length) return matches[0]

  for (const path of ['contact', 'contact-us', 'about']) {
    const subUrl = website.replace(/\/$/, '') + '/' + path
    text = clean(await fetchPage(subUrl))
    matches = text.match(emailRegex)
    if (matches && matches.length) return matches[0]
  }
  return ''
}

/**
 * Google Places search, details, and website email scrape API.
 * @param {import('http').IncomingMessage & { method?: string, body?: unknown }} req
 * @param {import('http').ServerResponse & { status: Function, json: Function, send: Function }} res
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed')
  }

  try {
    const body = parseBody(req)
    const action = body.action
    const query = body.query
    const placeId = body.placeId
    const pagetoken = body.pagetoken

    if (action === 'search') {
      const payload = await placesRequest(PLACES_SEARCH_URL, {
        method: 'POST',
        fieldMask: SEARCH_FIELD_MASK,
        body: pagetoken
          ? { textQuery: String(query || ''), pageToken: String(pagetoken) }
          : { textQuery: String(query || ''), pageSize: 20 }
      })

      const googleError = getGoogleError(payload)
      if (googleError) {
        return res.status(200).json({ success: false, error: googleError })
      }

      const places = Array.isArray(payload.places) ? payload.places : []
      return res.status(200).json({
        success: true,
        data: {
          status: places.length ? 'OK' : 'ZERO_RESULTS',
          results: places.map((place) => ({
            place_id: /** @type {{ id?: string }} */ (place).id
          })),
          next_page_token: payload.nextPageToken || undefined
        }
      })
    }

    if (action === 'details') {
      const payload = await placesRequest(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(String(placeId))}`,
        { fieldMask: DETAILS_FIELD_MASK }
      )

      const googleError = getGoogleError(payload)
      if (googleError) {
        return res.status(200).json({ success: false, error: googleError })
      }

      const displayName = payload.displayName && typeof payload.displayName === 'object'
        ? /** @type {{ text?: string }} */ (payload.displayName).text
        : ''

      return res.status(200).json({
        success: true,
        data: {
          status: 'OK',
          result: {
            name: displayName || '',
            formatted_address: payload.formattedAddress || '',
            formatted_phone_number: payload.nationalPhoneNumber || '',
            website: payload.websiteUri || '',
            url: payload.googleMapsUri || ''
          }
        }
      })
    }

    if (action === 'scrapeEmail') {
      const website = String(body.website || '')
      const email = await scrapeEmailFromWebsite(website)
      return res.status(200).json({ success: true, email })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error })
  }
}
