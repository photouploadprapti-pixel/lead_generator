/**
 * All Google Places keys provided for this project, newest first.
 * Extra keys can be added with GOOGLE_PLACES_API_KEY or GOOGLE_PLACES_API_KEYS.
 * @returns {string[]}
 */
const getGoogleApiKeys = () => {
  const fromEnv = [
    process.env.GOOGLE_PLACES_API_KEY,
    ...(String(process.env.GOOGLE_PLACES_API_KEYS || '').split(','))
  ]

  const hardcoded = [
    'AIzaSyCaOPk-RMuSsGZB-t-SmArSYYt4D2-XBPw',
    'AIzaSyAlYbELxMzQnIDPvSYdcEOgDhtiSsj0hNI',
    'AIzaSyDJt_83h5jYhu-KT5EsLFy24HZhMw57vQU',
    'AIzaSyBTE8u7TtPmYG6oTyOz5vNin1QpsF-Y7wc',
    'AIzaSyC-9KFTgkwhobbxmRrQOqih5Y8Admd9cA4'
  ]

  const unique = []
  for (const key of [...hardcoded, ...fromEnv]) {
    const trimmed = String(key || '').trim()
    if (trimmed && !unique.includes(trimmed)) unique.push(trimmed)
  }
  return unique
}

/**
 * Whether Google asked us to stop using this key for now.
 * @param {string} message
 * @returns {boolean}
 */
const isKeyExhaustedError = (message) =>
  /quota exceeded|permission|not authorized|api key not valid|request_denied/i.test(message || '')

module.exports = { getGoogleApiKeys, isKeyExhaustedError }
