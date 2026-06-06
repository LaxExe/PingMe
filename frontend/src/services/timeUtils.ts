import { PresetTimes, PushOption, PushSlot } from '../types'

// Given a slot name and a date, return the unix timestamp ms for that slot on that date
export function slotToTimestamp(slot: PushSlot, date: Date, presets: PresetTimes): number {
  const [hours, minutes] = presets[slot].split(':').map(Number)
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result.getTime()
}

// Returns available push options for TODAY based on current time
export function getTodayOptions(presets: PresetTimes): PushOption[] {
  const now = Date.now()
  const today = new Date()
  const slots: PushSlot[] = ['morning', 'afternoon', 'evening', 'night']

  return slots
    .map(slot => ({
      slot,
      label: slot.charAt(0).toUpperCase() + slot.slice(1),
      timestamp: slotToTimestamp(slot, today, presets)
    }))
    .filter(option => option.timestamp > now)
}

// Returns all 4 options for TOMORROW — always available
export function getTomorrowOptions(presets: PresetTimes): PushOption[] {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const slots: PushSlot[] = ['morning', 'afternoon', 'evening', 'night']

  return slots.map(slot => ({
    slot,
    label: slot.charAt(0).toUpperCase() + slot.slice(1),
    timestamp: slotToTimestamp(slot, tomorrow, presets)
  }))
}

// Returns true if tonight has fully passed (past the night preset)
export function isTonightPast(presets: PresetTimes): boolean {
  return getTodayOptions(presets).length === 0
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}