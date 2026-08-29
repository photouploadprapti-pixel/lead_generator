/**
 * Map a free-text place type to Nearby Search (New) includedTypes.
 * @param {string} placeType
 * @returns {string[]}
 */
const inferNearbyTypes = (placeType) => {
  const text = String(placeType || '').toLowerCase()

  if (/yoga/.test(text)) return ['yoga_studio', 'gym']
  if (/pilates|fitness|gym/.test(text)) return ['gym']
  if (/rehab|clinic|hospital|ortho|chiro|medical|doctor|physio/.test(text)) {
    return ['hospital', 'physiotherapist', 'doctor']
  }
  if (/cafe|coffee/.test(text)) return ['cafe']
  if (/restaurant|diner/.test(text)) return ['restaurant']
  if (/cowork/.test(text)) return ['coworking_space']
  if (/hotel/.test(text)) return ['hotel']
  if (/spa/.test(text)) return ['spa']

  const slug = text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return slug ? [slug] : ['point_of_interest']
}

module.exports = { inferNearbyTypes }
