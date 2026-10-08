import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaStorage } from '../../application/media/ports.js'
import type { Db } from '../db/kysely.js'

/** Локальная файловая система (разработка, тесты). Ключи — только сгенерированные приложением (ADR-007 п.3). */
export class LocalFsStorage implements MediaStorage {
  constructor(private readonly root: string) {}

  private file(key: string) {
    const p = path.resolve(this.root, key)
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Недопустимый ключ хранилища')
    return p
  }

  async put(key: string, data: Buffer) {
    const f = this.file(key)
    await mkdir(path.dirname(f), { recursive: true })
    await writeFile(f, data)
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key))
    } catch {
      return null
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true })
  }
}

/** Байты в PostgreSQL — драйвер тестового стенда Vercel (ADR-009 п.5): у serverless нет постоянного диска. */
export class DbBlobStorage implements MediaStorage {
  constructor(private readonly db: Db) {}

  async put(key: string, data: Buffer) {
    await this.db
      .insertInto('media_blobs')
      .values({ storage_key: key, data })
      .onConflict((oc) => oc.column('storage_key').doUpdateSet({ data }))
      .execute()
  }

  async get(key: string) {
    const r = await this.db.selectFrom('media_blobs').select('data').where('storage_key', '=', key).executeTakeFirst()
    return r ? Buffer.from(r.data) : null
  }

  async delete(key: string) {
    await this.db.deleteFrom('media_blobs').where('storage_key', '=', key).execute()
  }
}

export function createStorage(db: Db, env = process.env): MediaStorage {
  const driver = env.MEDIA_STORAGE ?? (env.VERCEL ? 'db' : 'local')
  if (driver === 'db') return new DbBlobStorage(db)
  if (driver === 'local') return new LocalFsStorage(env.MEDIA_DIR ?? path.resolve('.data', 'media'))
  throw new Error(
    `Неизвестный драйвер медиа: ${driver}. Доступны: local, db (S3 — при выборе production-хостинга, ADR-007)`,
  )
}
