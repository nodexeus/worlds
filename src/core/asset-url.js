/**
 * The address of one of the campus's own files in `public/assets/`.
 *
 * Those files keep their names from one build to the next, and a browser that has fetched one
 * keeps it. So each build asks under a new address: the build's own stamp on the end.
 *
 * @param {string} path  under `assets/`, for example `campus/settlement.glb`
 * @returns {string}
 */
export function assetUrl(path) {
  const stamp = typeof __ASSET_STAMP__ === 'string' ? `?v=${__ASSET_STAMP__}` : ''
  return `${import.meta.env.BASE_URL}assets/${path}${stamp}`
}
