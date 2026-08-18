const https = require('https')

const { parseBody } = require('../lib/parse-body')

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyC-9KFTgkwhobbxmRrQOqih5Y8Admd9cA4'

/**
 * Fetch a URL over HTTPS and parse the JSON response.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
const httpsGet = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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
    }).on('error', reject)
  })
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

    let result

    if (action === 'search') {
      let url
      if (pagetoken) {
        url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(String(pagetoken))}&key=${API_KEY}`
      } else {
        url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(String(query))}&key=${API_KEY}`
      }
      result = await httpsGet(url)
    } else if (action === 'details') {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,url&key=${API_KEY}`
      result = await httpsGet(url)
    } else if (action === 'scrapeEmail') {
      const website = String(body.website || '')
      const email = await scrapeEmailFromWebsite(website)
      return res.status(200).json({ success: true, email })
    } else {
      return res.status(400).json({ error: 'Unknown action' })
    }

    return res.status(200).json({ success: true, data: result })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error })
  }
}
