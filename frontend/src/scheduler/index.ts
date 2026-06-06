import { Reminder } from '../types'
import { getAllReminders, updateReminder } from '../db'

// ─── Ring tone via Web Audio API ─────────────────────────────────────────────

let audioCtx: AudioContext | null = null
let ringInterval: ReturnType<typeof setInterval> | null = null
let titleInterval: ReturnType<typeof setInterval> | null = null
const originalTitle = 'PingMe'

function createRingTone(ctx: AudioContext): void {
  // Classic double-ring pattern: two short tones, then a pause
  const now = ctx.currentTime

  function beep(start: number, freq: number, duration: number) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, start)
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
    osc.start(start)
    osc.stop(start + duration)
  }

  // Two beeps per ring cycle
  beep(now + 0.0, 480, 0.4)
  beep(now + 0.5, 480, 0.4)
}

export function startRing(reminderText: string): void {
  stopRing()

  audioCtx = new AudioContext()
  createRingTone(audioCtx)
  ringInterval = setInterval(() => {
    if (audioCtx) createRingTone(audioCtx)
  }, 2000)

  // Flash tab title
  let shown = false
  titleInterval = setInterval(() => {
    document.title = shown ? originalTitle : `🔔 ${reminderText}`
    shown = !shown
  }, 800)
}

export function stopRing(): void {
  if (audioCtx) {
    audioCtx.close()
    audioCtx = null
  }
  if (ringInterval) {
    clearInterval(ringInterval)
    ringInterval = null
  }
  if (titleInterval) {
    clearInterval(titleInterval)
    titleInterval = null
    document.title = originalTitle
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

type PingCallback = (reminder: Reminder) => void

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let onPingCallback: PingCallback | null = null

export function setOnPing(cb: PingCallback): void {
  onPingCallback = cb
}

export async function rescheduleAll(): Promise<void> {
  // Clear existing timers
  for (const [, timer] of timers) clearTimeout(timer)
  timers.clear()

  const reminders = await getAllReminders()
  const now = Date.now()

  for (const reminder of reminders) {
    if (reminder.status === 'done') continue
    if (reminder.callsStopped) continue

    const delay = reminder.nextPingAt - now
    if (delay <= 0) {
      // Overdue — fire immediately
      firePing(reminder)
    } else {
      const timer = setTimeout(() => firePing(reminder), delay)
      timers.set(reminder.id, timer)
    }
  }
}

function firePing(reminder: Reminder): void {
  timers.delete(reminder.id)
  if (onPingCallback) onPingCallback(reminder)
}

export function cancelTimer(reminderId: string): void {
  const timer = timers.get(reminderId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(reminderId)
  }
}

// ─── Re-ping after no response ───────────────────────────────────────────────

export async function handleNoResponse(
  reminder: Reminder,
  repingIntervalMinutes: number
): Promise<Reminder> {
  const updated: Reminder = {
    ...reminder,
    attemptCount: reminder.attemptCount + 1,
    callsStopped: reminder.attemptCount + 1 >= 3
  }
  if (!updated.callsStopped) {
    updated.nextPingAt = Date.now() + repingIntervalMinutes * 60 * 1000
    updated.status = 'pending'
  }
  await updateReminder(updated)
  if (!updated.callsStopped) {
    const delay = updated.nextPingAt - Date.now()
    const timer = setTimeout(() => firePing(updated), Math.max(0, delay))
    timers.set(updated.id, timer)
  }
  return updated
}