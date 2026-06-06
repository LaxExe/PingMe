import { Reminder, Settings, SyncResponse, SchedulePayload } from '../types'

const WORKER_URL = import.meta.env.VITE_WORKER_URL as string
const SECRET = import.meta.env.VITE_PINGME_SECRET as string

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-PingMe-Secret': SECRET
  }
}

// ─── Schedule a reminder job on the Worker ───────────────────────────────────

export async function scheduleReminder(reminder: Reminder): Promise<void> {
  const payload: SchedulePayload = {
    reminderId: reminder.id,
    reminderText: reminder.text,
    nextPingAt: reminder.nextPingAt,
    recurrence: reminder.recurrence
  }
  await fetch(`${WORKER_URL}/schedule`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload)
  })
}

// ─── Cancel a scheduled job ──────────────────────────────────────────────────

export async function cancelSchedule(reminderId: string): Promise<void> {
  await fetch(`${WORKER_URL}/schedule/${reminderId}`, {
    method: 'DELETE',
    headers: headers()
  })
}

// ─── Sync state changes from Worker → app ───────────────────────────────────

export async function syncFromWorker(): Promise<SyncResponse> {
  const res = await fetch(`${WORKER_URL}/sync`, {
    method: 'GET',
    headers: headers()
  })
  if (!res.ok) return { actions: [] }
  return res.json()
}

// ─── Push settings to Worker KV ─────────────────────────────────────────────

export async function pushSettingsToWorker(settings: Settings): Promise<void> {
  await fetch(`${WORKER_URL}/settings`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(settings)
  })
}