const PLACEHOLDER_EMAILS = new Set([
  'example@domain.com',
  'name@domain.com',
  'email@domain.com',
  'user@domain.com',
  'test@example.com',
  'example@example.com'
])

/**
 * Return true when an address looks like a real contact email.
 * @param {string} email
 * @returns {boolean}
 */
const isUsableEmail = (email) => {
  const value = String(email || '').trim().toLowerCase()
  if (!value || !value.includes('@')) return false
  if (PLACEHOLDER_EMAILS.has(value)) return false
  if (/^(example|name|user|email|test|admin)@/i.test(value)) return false
  if (/@(example|domain|email|test)\./i.test(value)) return false
  if (/\.(png|gif|jpe?g|webp|svg|ico)(\?|$)/i.test(value)) return false
  return true
}

/**
 * Pick the first usable email from a list of matches.
 * @param {string[]} matches
 * @returns {string}
 */
const firstUsableEmail = (matches) => {
  if (!Array.isArray(matches)) return ''
  const found = matches.find((item) => isUsableEmail(item))
  return found || ''
}

module.exports = { isUsableEmail, firstUsableEmail }
