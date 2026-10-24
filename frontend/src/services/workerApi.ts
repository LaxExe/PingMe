import { Reminder, Settings, SyncResponse, SchedulePayload, Category } from '../types'

const rawUrl = (import.meta.env.VITE_WORKER_URL as string) || ''
const WORKER_URL = rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')
  ? `https://${rawUrl}`
  : rawUrl
const SECRET = (import.meta.env.VITE_PINGME_SECRET as string) || ''

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-PingMe-Secret': SECRET
  }
}

function getSignal(timeoutMs = 8000): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return AbortSignal.timeout(timeoutMs)
  }
  return undefined
}

// ─── Schedule a reminder job on the Worker ───────────────────────────────────

export async function scheduleReminder(reminder: Reminder): Promise<void> {
  if (!WORKER_URL) return
  const payload: SchedulePayload = {
    reminderId: reminder.id,
    reminderText: reminder.text,
    nextPingAt: reminder.nextPingAt,
    recurrence: reminder.recurrence
  }
  try {
    await fetch(`${WORKER_URL}/schedule`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
      signal: getSignal()
    })
  } catch (err) {
    console.error('Failed to schedule reminder on worker:', err)
  }
}

// ─── Cancel a scheduled job ──────────────────────────────────────────────────

export async function cancelSchedule(reminderId: string): Promise<void> {
  if (!WORKER_URL || !reminderId) return
  try {
    await fetch(`${WORKER_URL}/schedule/${encodeURIComponent(reminderId)}`, {
      method: 'DELETE',
      headers: headers(),
      signal: getSignal()
    })
  } catch (err) {
    console.error('Failed to cancel schedule on worker:', err)
  }
}

// ─── Sync state changes from Worker → app ───────────────────────────────────

export async function syncFromWorker(): Promise<SyncResponse> {
  if (!WORKER_URL) return { actions: [] }
  try {
    const res = await fetch(`${WORKER_URL}/sync`, {
      method: 'GET',
      headers: headers(),
      signal: getSignal()
    })
    if (!res.ok) return { actions: [] }
    return await res.json()
  } catch {
    return { actions: [] }
  }
}

// ─── Push settings to Worker KV ─────────────────────────────────────────────

export async function pushSettingsToWorker(settings: Settings): Promise<void> {
  if (!WORKER_URL) return
  try {
    await fetch(`${WORKER_URL}/settings`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(settings),
      signal: getSignal()
    })
  } catch (err) {
    console.error('Failed to push settings to worker:', err)
  }
}

// ─── Push complete database to Worker KV ─────────────────────────────────────

export async function pushDbToWorker(dbData: { reminders: Reminder[], categories: Category[], settings: Settings }): Promise<void> {
  if (!WORKER_URL) return
  try {
    await fetch(`${WORKER_URL}/db`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(dbData),
      signal: getSignal(10000)
    })
  } catch (err) {
    console.error('Failed to push DB to worker:', err)
  }
}

// ─── Pull complete database from Worker KV ───────────────────────────────────

export async function pullDbFromWorker(): Promise<{ reminders: Reminder[], categories: Category[], settings: Settings } | null> {
  if (!WORKER_URL) return null
  try {
    const res = await fetch(`${WORKER_URL}/db`, {
      method: 'GET',
      headers: headers(),
      signal: getSignal(10000)
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !data.reminders) return null
    return data
  } catch {
    return null
  }
}