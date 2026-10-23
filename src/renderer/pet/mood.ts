/**
 * Classic QQPet face-poke mood by current value (#131):
 * 兴奋 +5 / 高兴 +10 / 平静 +30 / 郁闷 +50 / 低落 +70.
 * The old rand(5, 15) made low mood almost impossible to raise without buying toys.
 */
export function pokeMoodGain(value: number): number {
  if (value >= 900) return 5
  if (value >= 800) return 10
  if (value >= 500) return 30
  if (value >= 200) return 50
  return 70
}

/**
 * Per-minute mood drain. Tencent's post-fix rate was 1/min idle; work/study/travel add 1.
 */
export function moodDecayPerMinute(busy: boolean): number {
  return 1 + (busy ? 1 : 0)
}
