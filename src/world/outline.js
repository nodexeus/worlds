/**
 * Whether (x, z) is on a floor with one of these outlines, and at least `margin` in from its
 * edge. A margin below zero takes in that much beyond the edge too.
 *
 * @param {Array<Array<{x: number, z: number}>>} outlines
 */
export function onOutlines(outlines, x, z, margin = 0) {
  for (const outline of outlines) {
    let inside = false
    let nearest = Infinity
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i]
      const b = outline[j]
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
      const ex = b.x - a.x
      const ez = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)))
      nearest = Math.min(nearest, Math.hypot(x - a.x - ex * t, z - a.z - ez * t))
    }
    if (inside ? nearest >= margin : margin < 0 && nearest <= -margin) return true
  }
  return false
}
