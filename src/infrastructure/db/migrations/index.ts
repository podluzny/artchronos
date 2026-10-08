import type { Migration } from 'kysely/migration'
import * as m0001 from './0001_identity.js'
import * as m0002 from './0002_education.js'

/**
 * Статический список миграций: без чтения файловой системы, чтобы работать в serverless-бандле (ADR-009).
 * Новая миграция = новый файл + строка здесь. Имена сортируются лексикографически.
 */
export const migrations: Record<string, Migration> = {
  '0001_identity': m0001,
  '0002_education': m0002,
}
