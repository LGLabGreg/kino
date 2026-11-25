/** What lights a mark, such as a cited sentence and the sources it cites: the pointer's and the focus's marks are held apart, so one leaving gives the light back to the other. */
type LightVia = 'pointer' | 'focus'

interface MarkLights<T> {
  pointer: T | null
  focus: T | null
  /** Which came last, and lights when both are on a mark. */
  newest: LightVia
}

const NO_LIGHTS: MarkLights<never> = { pointer: null, focus: null, newest: 'pointer' }

/** The lights after the pointer or the focus comes to a mark, or leaves one with null. */
function lightMark<T>(
  lights: MarkLights<T>,
  via: LightVia,
  mark: T | null,
): MarkLights<T> {
  if (lights[via] === mark) return lights
  return { ...lights, [via]: mark, newest: mark === null ? lights.newest : via }
}

/** The mark that is lit: the newest light's, else the other's. */
function litMark<T>(lights: MarkLights<T>): T | null {
  const other = lights.newest === 'pointer' ? 'focus' : 'pointer'
  return lights[lights.newest] ?? lights[other]
}

export { lightMark, litMark, NO_LIGHTS }
export type { LightVia, MarkLights }
