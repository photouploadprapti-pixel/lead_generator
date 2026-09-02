const https = require('https')
const { URL } = require('url')

const { parseBody } = require('../lib/parse-body')
const { inferFallbackQuery } = require('../lib/place-types')
const { getGoogleApiKeys, isKeyExhaustedError } = require('../lib/google-keys')
const { firstUsableEmail } = require('../lib/usable-email')
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri'
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
      headers,
      timeout: 12000
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error(data.slice(0, 160) || 'Invalid JSON response'))
        }
      })
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
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
const placesRequest = async (url, options) => {
  const headers = {
    'X-Goog-Api-Key': options.apiKey,
    'X-Goog-FieldMask': options.fieldMask
  }
  let body
  if (options.body) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  try {
    return await httpsJson(url, { method: options.method || 'GET', headers, body })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: { message } }
  }
}

/**
 * Map a Places API (New) place into the fields the frontend CSV expects.
 * @param {Record<string, unknown>} place
 * @returns {{
 *   place_id: string,
 *   name: string,
 *   formatted_address: string,
 *   formatted_phone_number: string,
 *   website: string,
 *   url: string
 * }}
 */
const mapPlace = (place) => {
  const displayName = place.displayName && typeof place.displayName === 'object'
    ? /** @type {{ text?: string }} */ (place.displayName).text
    : ''

  return {
    place_id: String(place.id || ''),
    name: displayName || '',
    formatted_address: String(place.formattedAddress || ''),
    formatted_phone_number: String(place.nationalPhoneNumber || ''),
    website: String(place.websiteUri || ''),
    url: String(place.googleMapsUri || '')
  }
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
 * Whether a Google error is a daily or rate quota limit.
 * @param {string} message
 * @returns {boolean}
 */
const isQuotaError = (message) => /quota exceeded/i.test(message || '')

/**
 * Call Places Text Search or Details, rotating keys when one is exhausted.
 * @param {string} url
 * @param {{ method?: string, fieldMask: string, body?: Record<string, unknown> }} options
 * @returns {Promise<{ payload?: Record<string, unknown>, error?: string, allKeysFailed?: boolean }>}
 */
const placesRequestWithRotation = async (url, options) => {
  const keys = getGoogleApiKeys()
  let lastError = ''

  for (const apiKey of keys) {
    const payload = await placesRequest(url, { ...options, apiKey })
    const googleError = getGoogleError(payload)
    if (!googleError) return { payload }

    lastError = googleError
    if (!isKeyExhaustedError(googleError) && !isQuotaError(googleError) && !/timed out/i.test(googleError)) {
      return { error: googleError }
    }
  }

  return { error: lastError || 'All Google Places API keys failed', allKeysFailed: true }
}

/**
 * Map a Nominatim search hit into the CSV listing shape.
 * @param {Record<string, unknown>} item
 * @returns {{
 *   place_id: string,
 *   name: string,
 *   formatted_address: string,
 *   formatted_phone_number: string,
 *   website: string,
 *   url: string
 * } | null}
 */
const mapNominatimPlace = (item) => {
  const name = String(item.name || '')
  const address = String(item.display_name || '')
  if (!name && !address) return null
  const osmType = String(item.osm_type || 'node')
  const osmId = String(item.osm_id || item.place_id || '')

  return {
    place_id: `osm:${osmType}/${osmId}`,
    name: name || address.split(',')[0],
    formatted_address: address,
    formatted_phone_number: '',
    website: '',
    url: osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : ''
  }
}

/**
 * Map a Photon GeoJSON feature into the CSV listing shape.
 * @param {Record<string, unknown>} feature
 * @returns {{
 *   place_id: string,
 *   name: string,
 *   formatted_address: string,
 *   formatted_phone_number: string,
 *   website: string,
 *   url: string
 * } | null}
 */
const mapPhotonPlace = (feature) => {
  const properties = feature.properties && typeof feature.properties === 'object'
    ? /** @type {Record<string, unknown>} */ (feature.properties)
    : {}
  const name = String(properties.name || properties.street || '')
  if (!name) return null
  const address = [properties.name, properties.street, properties.city, properties.state, properties.country]
    .filter(Boolean)
    .join(', ')
  const osmType = String(properties.osm_type || 'N').toLowerCase() === 'n' ? 'node' : 'way'
  const osmId = String(properties.osm_id || '')

  return {
    place_id: `osm:${osmType}/${osmId || name}`,
    name,
    formatted_address: address,
    formatted_phone_number: '',
    website: '',
    url: osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : ''
  }
}

/**
 * Search Nominatim, then Photon, when Google Places is unavailable.
 * @param {string} city
 * @param {string} placeType
 * @returns {Promise<{ places?: unknown[], error?: { message: string } }>}
 */
const searchOsmFallback = async (city, placeType) => {
  const phrase = `${inferFallbackQuery(placeType)} ${city} USA`
  const headers = {
    'User-Agent': 'ShivWebLeadGenerator/1.0 (places fallback)',
    Accept: 'application/json'
  }

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=20&q=${encodeURIComponent(phrase)}`
    const nominatim = await httpsJson(nominatimUrl, { method: 'GET', headers })
    const nominatimRows = Array.isArray(nominatim) ? nominatim : []
    const nominatimPlaces = nominatimRows
      .map((item) => mapNominatimPlace(/** @type {Record<string, unknown>} */ (item)))
      .filter((place) => place !== null)
    if (nominatimPlaces.length) return { places: nominatimPlaces }
  } catch (err) {
    // Try Photon next.
  }

  try {
    const photonUrl = `https://photon.komoot.io/api/?limit=20&q=${encodeURIComponent(phrase)}`
    const photon = await httpsJson(photonUrl, { method: 'GET', headers })
    const features = Array.isArray(photon.features) ? photon.features : []
    const photonPlaces = features
      .map((feature) => mapPhotonPlace(/** @type {Record<string, unknown>} */ (feature)))
      .filter((place) => place !== null)
    if (photonPlaces.length) return { places: photonPlaces }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: { message: `OpenStreetMap search failed: ${message}` } }
  }

  return { places: [] }
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

  const collected = []
  let text = clean(await fetchPage(website))
  collected.push(...(text.match(emailRegex) || []))

  for (const path of ['contact', 'contact-us', 'about']) {
    if (firstUsableEmail(collected)) break
    const subUrl = website.replace(/\/$/, '') + '/' + path
    text = clean(await fetchPage(subUrl))
    collected.push(...(text.match(emailRegex) || []))
  }
  return firstUsableEmail(collected)
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

    if (action === 'search') {
      const city = String(body.city || query || '')
      const placeType = String(body.placeType || query || '')
      const skipGoogle = body.skipGoogle === true

      /**
       * @param {unknown[]} places
       * @param {string} source
       */
      const succeed = (places, source) => res.status(200).json({
        success: true,
        source,
        data: {
          status: places.length ? 'OK' : 'ZERO_RESULTS',
          results: places
        }
      })

      if (!skipGoogle) {
        const pageToken = body.pagetoken ? String(body.pagetoken) : ''
        const searchBody = pageToken
          ? { textQuery: String(query || ''), pageSize: 20, pageToken }
          : { textQuery: String(query || ''), pageSize: 20 }

        const rotated = await placesRequestWithRotation(PLACES_SEARCH_URL, {
          method: 'POST',
          fieldMask: SEARCH_FIELD_MASK + ',nextPageToken',
          body: searchBody
        })

        if (rotated.payload) {
          const places = Array.isArray(rotated.payload.places) ? rotated.payload.places : []
          return res.status(200).json({
            success: true,
            source: 'google-text',
            data: {
              status: places.length ? 'OK' : 'ZERO_RESULTS',
              results: places.map((place) =>
                mapPlace(/** @type {Record<string, unknown>} */ (place))
              ),
              next_page_token: rotated.payload.nextPageToken || undefined
            }
          })
        }

        return res.status(200).json({
          success: false,
          error: rotated.error,
          retryOsm: true,
          allKeysFailed: rotated.allKeysFailed === true
        })
      }

      const osmPayload = await searchOsmFallback(city, placeType)
      if (osmPayload.error) {
        return res.status(200).json({ success: false, error: osmPayload.error.message })
      }

      return succeed(osmPayload.places || [], 'openstreetmap')
    }

    if (action === 'details') {
      const rotated = await placesRequestWithRotation(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(String(placeId))}`,
        { fieldMask: DETAILS_FIELD_MASK }
      )

      if (!rotated.payload) {
        return res.status(200).json({ success: false, error: rotated.error })
      }

      return res.status(200).json({
        success: true,
        data: {
          status: 'OK',
          result: mapPlace(rotated.payload)
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
