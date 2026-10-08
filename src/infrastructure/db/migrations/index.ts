import type { Migration } from 'kysely/migration'
import * as m0001 from './0001_identity.js'
import * as m0002 from './0002_education.js'
import * as m0003 from './0003_question_platform.js'
import * as m0004 from './0004_test_authoring.js'

/**
 * Статический список миграций: без чтения файловой системы, чтобы работать в serverless-бандле (ADR-009).
 * Новая миграция = новый файл + строка здесь. Имена сортируются лексикографически.
 */
export const migrations: Record<string, Migration> = {
  '0001_identity': m0001,
  '0002_education': m0002,
  '0003_question_platform': m0003,
  '0004_test_authoring': m0004,
}
