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
  if (/co-?work/.test(text)) return ['coworking_space']
  if (/hotel/.test(text)) return ['hotel']
  if (/spa/.test(text)) return ['spa']

  const slug = text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return slug ? [slug] : ['point_of_interest']
}

/**
 * Map a free-text place type to OpenStreetMap Overpass tag filters.
 * @param {string} placeType
 * @returns {string[]}
 */
const inferOsmFilters = (placeType) => {
  const text = String(placeType || '').toLowerCase()

  if (/yoga/.test(text)) {
    return ['["sport"="yoga"]', '["leisure"="fitness_centre"]']
  }
  if (/pilates|fitness|gym/.test(text)) {
    return ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]', '["amenity"="gym"]']
  }
  if (/rehab|clinic|hospital|ortho|chiro|medical|doctor|physio/.test(text)) {
    return [
      '["amenity"="hospital"]',
      '["amenity"="clinic"]',
      '["healthcare"="rehabilitation"]',
      '["healthcare"="physiotherapist"]'
    ]
  }
  if (/cafe|coffee/.test(text)) return ['["amenity"="cafe"]']
  if (/restaurant|diner/.test(text)) return ['["amenity"="restaurant"]']
  if (/co-?work/.test(text)) {
    return ['["office"="coworking"]', '["amenity"="coworking_space"]', '["office"="coworking_space"]']
  }
  if (/hotel/.test(text)) return ['["tourism"="hotel"]']
  if (/spa/.test(text)) return ['["leisure"="spa"]']

  return ['["name"~"' + text.replace(/"/g, '') + '",i]']
}

/**
 * Build a short search phrase for Nominatim / Photon fallbacks.
 * @param {string} placeType
 * @returns {string}
 */
const inferFallbackQuery = (placeType) => {
  const text = String(placeType || '').toLowerCase()
  if (/co-?work/.test(text)) return 'coworking'
  if (/yoga/.test(text)) return 'yoga studio'
  if (/pilates|fitness|gym/.test(text)) return 'gym'
  if (/rehab/.test(text)) return 'rehabilitation center'
  if (/clinic|hospital|ortho|chiro|medical|doctor|physio/.test(text)) return 'clinic'
  if (/cafe|coffee/.test(text)) return 'cafe'
  if (/restaurant|diner/.test(text)) return 'restaurant'
  if (/hotel/.test(text)) return 'hotel'
  if (/spa/.test(text)) return 'spa'
  return String(placeType || '').trim()
}

module.exports = { inferNearbyTypes, inferOsmFilters, inferFallbackQuery }
