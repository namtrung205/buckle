import type { AgentCheckpoint } from './AgentRunner.ts'
import type { AiMode } from '../../core/ai/types.ts'

export type SavedAgentRun = { run: AgentCheckpoint; modelHash: string; mode: AiMode; connectionId: string; modelId: string }
const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('buckle-copilot-archive', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('entries')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export async function saveCopilotArchive(key: string, value: unknown) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('entries', 'readwrite')
      transaction.objectStore('entries').put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
export async function loadCopilotArchive<T>(key: string): Promise<T | undefined> {
  const db = await database()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction('entries').objectStore('entries').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
