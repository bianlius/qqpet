import { div } from './dom'

/** Bottom-right / top-left cue on a good card (study 4/9, inventory count, …). */
export type CardBadgeCorner = 'br' | 'tl'

export { progressMark } from './progress-mark'

export function cardBadge(text: string, corner: CardBadgeCorner = 'br'): HTMLDivElement {
  return div(`cardBadge cardBadge-${corner}`, text)
}
