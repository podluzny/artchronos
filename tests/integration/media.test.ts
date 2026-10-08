import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../src/domain/authorization/actor.js'
import { acceptFormat } from '../../src/domain/media/media-rules.js'
import type { Db } from '../../src/infrastructure/db/kysely.js'
import { createServices, type Services } from '../../src/server/container.js'
import { freshDb } from '../support/db.js'
import { ctx, makeUser, setupServices } from '../support/fixtures.js'
import { jpegWithGps, pngBuffer, tempStorage, uploadImage } from '../support/media.js'

let db: Db
let services: Services
let admin: Actor
let teacher: Awaited<ReturnType<typeof makeUser>>
let student: Awaited<ReturnType<typeof makeUser>>

beforeAll(async () => {
  db = await freshDb()
  const s = await setupServices(db)
  admin = s.admin
  services = createServices(db, { storage: tempStorage() })
  teacher = await makeUser(services, admin, ['TEACHER'])
  student = await makeUser(services, admin, ['STUDENT'])
})
afterAll(async () => db.destroy())

describe('SPEC-MEDIA-001 Загрузка и метаданные', () => {
  it('AT-MEDIA-001.1 PNG создает MediaAsset с PENDING и превью', async () => {
    const id = await uploadImage(services, student.actor)
    const m = await services.media.getMedia.run(student.actor, { id }, ctx)
    expect(m.kind).toBe('IMAGE')
    expect(m.rightsStatus).toBe('PENDING')
    expect(m.derivativesStatus).toBe('READY')
    expect(m.derivatives.map((d) => d.variant).sort()).toEqual(['PREVIEW', 'THUMB'])
    const thumb = await services.media.readMediaFile.run(student.actor, { id, variant: 'thumb' }, ctx)
    expect(thumb.mime).toBe('image/webp')
    expect((await sharp(thumb.data).metadata()).width).toBeLessThanOrEqual(320)
  })

  it('AT-MEDIA-001.2 подмена расширения (HTML вместо изображения) отклоняется по сигнатуре', async () => {
    await expect(
      services.media.uploadMedia.run(
        student.actor,
        { data: Buffer.from('<html><script>alert(1)</script></html>'), metadata: { title: 'evil.jpg' } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-MEDIA-001.3 превышение лимита размера отклоняется', () => {
    try {
      acceptFormat('image/png', 51 * 1024 * 1024)
      expect.unreachable()
    } catch (e) {
      expect((e as { fieldErrors: { message: string }[] }).fieldErrors[0]!.message).toMatch(/слишком большой/)
    }
    expect(() => acceptFormat('video/mp4', 501 * 1024 * 1024)).toThrow()
    expect(acceptFormat('image/png', 1000)).toBe('IMAGE')
  })

  it('AT-MEDIA-001.4 клиентский rightsStatus при загрузке игнорируется (BR-045)', async () => {
    const { id } = await services.media.uploadMedia.run(
      student.actor,
      { data: await pngBuffer(), metadata: { title: 'x', rightsStatus: 'CLEARED', license: 'CC0' } as never },
      ctx,
    )
    expect((await services.media.getMedia.run(student.actor, { id }, ctx)).rightsStatus).toBe('PENDING')
  })

  it('AT-MEDIA-001.5 GPS-метаданные удаляются из изображения', async () => {
    const src = await jpegWithGps()
    expect((await sharp(src).metadata()).exif).toBeDefined()
    const { id } = await services.media.uploadMedia.run(
      teacher.actor,
      { data: src, metadata: { title: 'Фото с GPS' } },
      ctx,
    )
    const stored = await services.media.readMediaFile.run(teacher.actor, { id }, ctx)
    expect((await sharp(stored.data).metadata()).exif).toBeUndefined()
  })

  it('AT-MEDIA-001.6 поиск по художнику, названию произведения и тегу', async () => {
    const { id } = await services.media.uploadMedia.run(
      teacher.actor,
      {
        data: await pngBuffer('#225522'),
        metadata: { title: 'Утро', artist: 'И. И. Шишкин', workTitle: 'Утро в сосновом лесу' },
        tags: ['Пейзаж', 'передвижники'],
      },
      ctx,
    )
    const q = (filters: Record<string, string>) =>
      services.media.listMedia.run(student.actor, { filters, limit: 50, offset: 0 }, ctx)
    expect((await q({ text: 'Шишкин' })).records.map((m) => m.id)).toContain(id)
    expect((await q({ text: 'сосновом' })).records.map((m) => m.id)).toContain(id)
    expect((await q({ tag: 'пейзаж' })).records.map((m) => m.id)).toEqual([id])
    expect((await q({ text: 'Айвазовский' })).records.map((m) => m.id)).not.toContain(id)
  })

  it('дубликат по sha256 — предупреждение, не запрет', async () => {
    const data = await pngBuffer('#010203')
    const a = await services.media.uploadMedia.run(teacher.actor, { data, metadata: { title: 'a' } }, ctx)
    const b = await services.media.uploadMedia.run(teacher.actor, { data, metadata: { title: 'b' } }, ctx)
    expect(b.duplicateOf).toBe(a.id)
  })
})

describe('SPEC-MEDIA-002 Права, использование, архив', () => {
  it('AT-MEDIA-002.1 преподаватель подтверждает права при заполненных полях; аудит', async () => {
    const id = await uploadImage(services, student.actor)
    const m = await services.media.getMedia.run(teacher.actor, { id }, ctx)
    await services.media.setRightsStatus.run(teacher.actor, { id, status: 'CLEARED', revision: m.revision }, ctx)
    const after = await services.media.getMedia.run(teacher.actor, { id }, ctx)
    expect(after.rightsStatus).toBe('CLEARED')
    expect(after.rightsVerifiedBy).toBe(teacher.id)
    const audit = await db.selectFrom('audit_log').select('action').where('resource_id', '=', id).execute()
    expect(audit.map((a) => a.action)).toContain('media.rights.cleared')
  })

  it('CLEARED требует лицензию, источник и для несвободных — правообладателя и credit line', async () => {
    const { id } = await services.media.uploadMedia.run(
      teacher.actor,
      { data: await pngBuffer(), metadata: { title: 'без сведений' } },
      ctx,
    )
    const m = await services.media.getMedia.run(teacher.actor, { id }, ctx)
    await expect(
      services.media.setRightsStatus.run(teacher.actor, { id, status: 'CLEARED', revision: m.revision }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('AT-MEDIA-002.2 студент не может подтвердить права', async () => {
    const id = await uploadImage(services, student.actor)
    await expect(
      services.media.setRightsStatus.run(student.actor, { id, status: 'CLEARED', revision: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-MEDIA-002.3 изменение лицензии студентом у CLEARED возвращает PENDING', async () => {
    const id = await uploadImage(services, student.actor, { cleared: true, clearer: teacher.actor })
    const m = await services.media.getMedia.run(student.actor, { id }, ctx)
    await services.media.updateMediaMetadata.run(
      student.actor,
      { id, metadata: { license: 'CC_BY', rightsHolder: 'X', creditLine: 'X' }, revision: m.revision },
      ctx,
    )
    expect((await services.media.getMedia.run(student.actor, { id }, ctx)).rightsStatus).toBe('PENDING')
  })

  it('студент не редактирует чужие медиа', async () => {
    const id = await uploadImage(services, teacher.actor)
    await expect(
      services.media.updateMediaMetadata.run(student.actor, { id, metadata: { title: 'x' }, revision: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('AT-MEDIA-002.7 RESTRICTED требует основание', async () => {
    const id = await uploadImage(services, teacher.actor)
    const m = await services.media.getMedia.run(teacher.actor, { id }, ctx)
    await expect(
      services.media.setRightsStatus.run(teacher.actor, { id, status: 'RESTRICTED', revision: m.revision }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await services.media.setRightsStatus.run(
      teacher.actor,
      { id, status: 'RESTRICTED', note: 'Запрос правообладателя', revision: m.revision },
      ctx,
    )
    expect((await services.media.getMedia.run(teacher.actor, { id }, ctx)).rightsStatus).toBe('RESTRICTED')
  })

  it('неиспользуемое медиа можно удалить, архивирование и восстановление', async () => {
    const id = await uploadImage(services, student.actor)
    await services.media.archiveMedia.run(student.actor, { id, reason: 'не нужно' }, ctx)
    expect(
      (await services.media.listMedia.run(student.actor, { filters: {}, limit: 500, offset: 0 }, ctx)).records.map(
        (m) => m.id,
      ),
    ).not.toContain(id)
    await services.media.restoreMedia.run(student.actor, { id }, ctx)
    await services.media.deleteMedia.run(student.actor, { id }, ctx)
    await expect(services.media.getMedia.run(student.actor, { id }, ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
