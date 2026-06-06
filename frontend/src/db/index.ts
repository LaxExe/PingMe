import { openDB, DBSchema, IDBPDatabase } from 'idb'
import { Reminder, Category, Settings } from '../types'

// ─── Schema ──────────────────────────────────────────────────────────────────

interface PingMeDB extends DBSchema {
  reminders: {
    key: string
    value: Reminder
    indexes: {
      'by-status': string
      'by-category': string
      'by-nextPingAt': number
    }
  }
  categories: {
    key: string
    value: Category
    indexes: { 'by-order': number }
  }
  settings: {
    key: string
    value: Settings
  }
}

const DB_NAME = 'pingme'
const DB_VERSION = 1

let dbInstance: IDBPDatabase<PingMeDB> | null = null

export async function getDB(): Promise<IDBPDatabase<PingMeDB>> {
  if (dbInstance) return dbInstance
  dbInstance = await openDB<PingMeDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // reminders store
      const reminderStore = db.createObjectStore('reminders', { keyPath: 'id' })
      reminderStore.createIndex('by-status', 'status')
      reminderStore.createIndex('by-category', 'categoryId')
      reminderStore.createIndex('by-nextPingAt', 'nextPingAt')

      // categories store
      const categoryStore = db.createObjectStore('categories', { keyPath: 'id' })
      categoryStore.createIndex('by-order', 'order')

      // settings store (single record keyed as 'settings')
      db.createObjectStore('settings', { keyPath: 'id' as never })
    }
  })
  return dbInstance
}

// ─── Seed defaults ───────────────────────────────────────────────────────────

export async function seedDefaults(): Promise<void> {
  const db = await getDB()
  const existingCategories = await db.getAll('categories')
  if (existingCategories.length === 0) {
    await db.put('categories', {
      id: 'inbox',
      name: 'Inbox',
      isPersistent: false,
      order: 0
    })
    await db.put('categories', {
      id: 'persistent',
      name: 'Persistent box',
      isPersistent: true,
      order: 999
    })
  }

  const existing = await db.get('settings', 'settings' as never)
  if (!existing) {
    const defaultSettings: Settings = {
      name: '',
      phoneNumber: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      presets: {
        morning: '08:00',
        afternoon: '13:00',
        evening: '18:00',
        night: '21:00'
      },
      repingIntervalMinutes: 10
    }
    await db.put('settings', { ...defaultSettings, id: 'settings' } as never)
  }
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export async function getAllReminders(): Promise<Reminder[]> {
  const db = await getDB()
  return db.getAll('reminders')
}

export async function getReminder(id: string): Promise<Reminder | undefined> {
  const db = await getDB()
  return db.get('reminders', id)
}

import { pushDbToWorker } from '../services/workerApi'

export async function triggerPushSync(): Promise<void> {
  try {
    const reminders = await getAllReminders()
    const categories = await getAllCategories()
    const settings = await getSettings()
    await pushDbToWorker({ reminders, categories, settings })
  } catch (e) {
    // Silent fail if network or other error
  }
}

export async function addReminder(reminder: Reminder): Promise<void> {
  const db = await getDB()
  await db.put('reminders', reminder)
  await triggerPushSync()
}

export async function updateReminder(reminder: Reminder): Promise<void> {
  const db = await getDB()
  await db.put('reminders', reminder)
  await triggerPushSync()
}

export async function deleteReminder(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('reminders', id)
  await triggerPushSync()
}

export async function getPendingReminders(): Promise<Reminder[]> {
  const db = await getDB()
  const all = await db.getAll('reminders')
  return all.filter(r => r.status !== 'done' && !r.callsStopped)
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDB()
  const all = await db.getAll('categories')
  return all.sort((a, b) => a.order - b.order)
}

export async function addCategory(category: Category): Promise<void> {
  const db = await getDB()
  await db.put('categories', category)
  await triggerPushSync()
}

export async function updateCategory(category: Category): Promise<void> {
  const db = await getDB()
  await db.put('categories', category)
  await triggerPushSync()
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDB()
  // move reminders in this category to inbox
  const all = await db.getAll('reminders')
  const tx = db.transaction('reminders', 'readwrite')
  for (const r of all) {
    if (r.categoryId === id) {
      await tx.store.put({ ...r, categoryId: 'inbox' })
    }
  }
  await tx.done
  await db.delete('categories', id)
  await triggerPushSync()
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const db = await getDB()
  const raw = await db.get('settings', 'settings' as never) as (Settings & { id: string }) | undefined
  if (!raw) {
    const defaults: Settings = {
      name: '',
      phoneNumber: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      presets: { morning: '08:00', afternoon: '13:00', evening: '18:00', night: '21:00' },
      repingIntervalMinutes: 10
    }
    return defaults
  }
  const { id: _id, ...settings } = raw
  return settings as Settings
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDB()
  await db.put('settings', { ...settings, id: 'settings' } as never)
  await triggerPushSync()
}