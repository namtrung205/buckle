import type { AnalysisRun } from './AnalysisResults.ts'

const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('buckle-analysis-archive', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('runs', { keyPath: 'id' })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export async function archiveAnalysis(run: AnalysisRun) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('runs', 'readwrite')
      transaction.objectStore('runs').put(run)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
export async function loadAnalysisArchive(): Promise<AnalysisRun[]> {
  const db = await database()
  try {
    return await new Promise<AnalysisRun[]>((resolve, reject) => {
      const request = db.transaction('runs').objectStore('runs').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
