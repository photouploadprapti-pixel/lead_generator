const https = require('https')
const { URL } = require('url')

const { parseBody } = require('../lib/parse-body')
const { inferNearbyTypes, inferOsmFilters } = require('../lib/place-types')

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDJt_83h5jYhu-KT5EsLFy24HZhMw57vQU'
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby'
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
 * Geocode a city name with OpenStreetMap so Nearby Search can run without Text Search.
 * @param {string} city
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
const geocodeCity = async (city) => {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${city}, USA`)}`
    const payload = await httpsJson(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'ShivWebLeadGenerator/1.0 (places fallback)',
        Accept: 'application/json'
      }
    })

    const first = Array.isArray(payload) ? payload[0] : null
    if (!first || typeof first !== 'object') return null
    const lat = Number(/** @type {{ lat?: string }} */ (first).lat)
    const lng = Number(/** @type {{ lon?: string }} */ (first).lon)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
  } catch (err) {
    return null
  }
}

/**
 * Search nearby businesses when daily Text Search quota is exhausted.
 * @param {string} city
 * @param {string} placeType
 * @returns {Promise<Record<string, unknown>>}
 */
const searchNearbyFallback = async (city, placeType) => {
  const coords = await geocodeCity(city)
  if (!coords) {
    return { error: { message: `Could not locate city: ${city}` } }
  }

  return placesRequest(PLACES_NEARBY_URL, {
    method: 'POST',
    fieldMask: SEARCH_FIELD_MASK,
    body: {
      includedTypes: inferNearbyTypes(placeType),
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: coords.lat, longitude: coords.lng },
          radius: 25000.0
        }
      }
    }
  })
}

/**
 * Build a CSV-ready listing from an OpenStreetMap element.
 * @param {Record<string, unknown>} element
 * @returns {{
 *   place_id: string,
 *   name: string,
 *   formatted_address: string,
 *   formatted_phone_number: string,
 *   website: string,
 *   url: string
 * } | null}
 */
const mapOsmPlace = (element) => {
  const tags = element.tags && typeof element.tags === 'object'
    ? /** @type {Record<string, string>} */ (element.tags)
    : {}
  const name = tags.name || tags['name:en'] || ''
  if (!name) return null

  const address = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'],
    tags['addr:state']
  ].filter(Boolean).join(', ')

  const osmType = String(element.type || 'node')
  const osmId = String(element.id || '')

  return {
    place_id: `osm:${osmType}/${osmId}`,
    name,
    formatted_address: address,
    formatted_phone_number: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    url: osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : ''
  }
}

/**
 * Search OpenStreetMap when both Google Places daily quotas are exhausted.
 * @param {string} city
 * @param {string} placeType
 * @returns {Promise<{ places?: unknown[], error?: { message: string } }>}
 */
const searchOsmFallback = async (city, placeType) => {
  try {
    const coords = await geocodeCity(city)
    if (!coords) {
      return { error: { message: `Could not locate city: ${city}` } }
    }

    const filters = inferOsmFilters(placeType)
      .map((filter) => `nwr${filter}(around:25000,${coords.lat},${coords.lng});`)
      .join('\n  ')

    const query = `[out:json][timeout:20];\n(\n  ${filters}\n);\nout center tags 20;`
    const payload = await httpsJson(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ShivWebLeadGenerator/1.0 (places fallback)'
      },
      body: `data=${encodeURIComponent(query)}`
    })

    const elements = Array.isArray(payload.elements) ? payload.elements : []
    const places = elements
      .map((element) => mapOsmPlace(/** @type {Record<string, unknown>} */ (element)))
      .filter((place) => place !== null)

    return { places }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: { message: `OpenStreetMap search failed: ${message}` } }
  }
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
        const payload = await placesRequest(PLACES_SEARCH_URL, {
          method: 'POST',
          fieldMask: SEARCH_FIELD_MASK,
          body: { textQuery: String(query || ''), pageSize: 20 }
        })

        const googleError = getGoogleError(payload)
        if (!googleError) {
          const places = Array.isArray(payload.places) ? payload.places : []
          return succeed(
            places.map((place) => mapPlace(/** @type {Record<string, unknown>} */ (place))),
            'google-text'
          )
        }

        if (!isQuotaError(googleError)) {
          return res.status(200).json({ success: false, error: googleError })
        }

        const nearbyPayload = await searchNearbyFallback(city, placeType)
        const nearbyError = getGoogleError(nearbyPayload)
        if (!nearbyError) {
          const places = Array.isArray(nearbyPayload.places) ? nearbyPayload.places : []
          return succeed(
            places.map((place) => mapPlace(/** @type {Record<string, unknown>} */ (place))),
            'google-nearby'
          )
        }

        if (!isQuotaError(nearbyError)) {
          return res.status(200).json({ success: false, error: nearbyError })
        }
      }

      const osmPayload = await searchOsmFallback(city, placeType)
      if (osmPayload.error) {
        return res.status(200).json({ success: false, error: osmPayload.error.message })
      }

      return succeed(osmPayload.places || [], 'openstreetmap')
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

      return res.status(200).json({
        success: true,
        data: {
          status: 'OK',
          result: mapPlace(payload)
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
