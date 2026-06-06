// ─── Reminder ────────────────────────────────────────────────────────────────

export type RecurrenceRule = 'none' | 'daily' | 'weekly' | number // number = custom interval in minutes

export type ReminderStatus = 'pending' | 'snoozed' | 'pushed' | 'done'

export interface Reminder {
  id: string
  text: string
  scheduledAt: number       // unix timestamp ms — original scheduled time
  nextPingAt: number        // unix timestamp ms — when to next ping/call
  categoryId: string        // foreign key to Category.id
  recurrence: RecurrenceRule
  status: ReminderStatus
  isPersistent: boolean     // if true, never auto-delete when marked done
  attemptCount: number      // unanswered call count, 0–3
  callsStopped: boolean     // true once attemptCount hits 3
  createdAt: number         // unix timestamp ms
}

// ─── Category ────────────────────────────────────────────────────────────────

export interface Category {
  id: string
  name: string
  isPersistent: boolean     // persistent box = true, cannot be deleted by user
  order: number             // display order
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface PresetTimes {
  morning: string           // 24hr "HH:MM" e.g. "08:00"
  afternoon: string         // "13:00"
  evening: string           // "18:00"
  night: string             // "21:00"
}

export type PresetKey = keyof PresetTimes

export interface Settings {
  name: string
  phoneNumber: string       // E.164 format e.g. "+14165550123"
  timezone: string          // IANA e.g. "America/Toronto"
  presets: PresetTimes
  repingIntervalMinutes: number  // default 10
}

// ─── Worker sync types ───────────────────────────────────────────────────────

export type SyncAction =
  | { type: 'done'; reminderId: string }
  | { type: 'rescheduled'; reminderId: string; nextPingAt: number }
  | { type: 'callsStopped'; reminderId: string }
  | { type: 'attemptIncremented'; reminderId: string; attemptCount: number }

export interface SyncResponse {
  actions: SyncAction[]
}

export interface SchedulePayload {
  reminderId: string
  reminderText: string
  nextPingAt: number        // unix timestamp ms
  recurrence?: RecurrenceRule
}

// ─── Push later options ──────────────────────────────────────────────────────

export type PushDay = 'today' | 'tomorrow'
export type PushSlot = 'morning' | 'afternoon' | 'evening' | 'night'

export interface PushOption {
  slot: PushSlot
  label: string
  timestamp: number         // unix timestamp ms for when to schedule
}