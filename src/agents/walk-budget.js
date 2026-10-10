/**
 * How many seconds a walk of `far` units, as the crow flies, is given before it is taken to
 * have failed: time to cover three times that distance at a slow walk, and never less than
 * the three quarters of a minute it always was.
 *
 * @param {number} far
 * @param {number} [speed]  a robot's walking speed, in units a second
 * @returns {number}
 */
export function walkBudget(far, speed = 2.1) {
  return 45 + (far * 3) / (speed * 0.6)
}
