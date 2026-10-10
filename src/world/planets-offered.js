/**
 * Which worlds a person can choose.
 *
 * Only the campus. The others came with the project this one grew out of and are not offered
 * any more: they are not in the picker, and a setting that still names one opens the campus.
 * The worlds to come are new ones, added here as they are built.
 */
export const OFFERED = ['campus']

/** The world to open for a remembered or asked-for id: itself if it is on offer, else the first that is. */
export function offeredPlanet(id) {
  return OFFERED.includes(id) ? id : OFFERED[0]
}
