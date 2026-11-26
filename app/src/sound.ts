/** Short notification sounds made with Web Audio (no audio files needed). */
export type Cue = 'start' | 'done' | 'error'

const KEY = 'sound'
export const soundEnabled = () => localStorage.getItem(KEY) !== 'false'
export const setSoundEnabled = (on: boolean) => localStorage.setItem(KEY, String(on))

let ctx: AudioContext | undefined

const NOTES: Record<Cue, [number, number][]> = {
  // [frequency Hz, duration s]
  start: [[523, 0.12], [659, 0.16]],              // C5 → E5
  done: [[523, 0.12], [659, 0.12], [784, 0.28]],  // C5 → E5 → G5
  error: [[392, 0.18], [262, 0.32]],              // G4 → C4
}

export function play(cue: Cue) {
  if (!soundEnabled()) return
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    let t = ctx.currentTime + 0.02
    for (const [freq, dur] of NOTES[cue]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur + 0.02)
      t += dur
    }
  } catch { /* audio not available */ }
}
