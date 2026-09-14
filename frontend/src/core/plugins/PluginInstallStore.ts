/** Raw reviewed ZIPs are kept in IndexedDB; localStorage is too small for the
 * accepted bundle size. Nothing in this store is executed until revalidated. */
export type InstalledBundleRecord = Readonly<{
  id: string
  version: string
  source: string
  zip: Uint8Array
  /** SHA-256 of the exact ZIP bytes selected during permission review. */
  reviewedSha256?: string
  /** SHA-256 of the reviewed Ed25519 public key, if this ZIP was signed. */
  publisherKeySha256?: string
  enabled: boolean
  grantedPermissions: readonly string[]
  crashCount?: number
  quarantined?: boolean
}>

export type PluginInstallStore = Readonly<{
  list: () => Promise<readonly InstalledBundleRecord[]>
  put: (record: InstalledBundleRecord) => Promise<void>
  delete: (id: string) => Promise<void>
}>

const DATABASE_NAME = 'buckle-plugin-installs'
const STORE_NAME = 'bundles'

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Plugin database request failed'))
})

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onabort = () => reject(transaction.error ?? new Error('Plugin database write aborted'))
  transaction.onerror = () => reject(transaction.error ?? new Error('Plugin database write failed'))
})

let database: Promise<IDBDatabase> | null = null
const openDatabase = (): Promise<IDBDatabase> => {
  if (database) return database
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable; persistent plugin installation is disabled'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        database = null
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Cannot open plugin database'))
  }).catch(error => {
    database = null
    throw error
  })
  return database!
}

export const browserPluginInstallStore: PluginInstallStore = {
  list: async () => {
    const db = await openDatabase()
    return requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll())
  },
  put: async record => {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORE_NAME).put(record)
    await done
  },
  delete: async id => {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORE_NAME).delete(id)
    await done
  },
}
