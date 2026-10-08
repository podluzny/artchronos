import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { Actor } from '../../src/domain/authorization/actor.js'
import { LocalFsStorage } from '../../src/infrastructure/media/storage.js'
import type { Services } from '../../src/server/container.js'
import { ctx } from './fixtures.js'

export function tempStorage() {
  return new LocalFsStorage(mkdtempSync(path.join(os.tmpdir(), 'artchronos-media-')))
}

let n = 0
export async function pngBuffer(color = '#336699', size = 64): Promise<Buffer> {
  n += 1
  // уникальный пиксель, чтобы sha256 различались
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .composite([
      {
        input: Buffer.from([n % 255, (n * 7) % 255, (n * 13) % 255]),
        raw: { width: 1, height: 1, channels: 3 },
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer()
}

export async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa3300' } })
    .withExif({
      IFD0: { Copyright: 'Owner', Make: 'Camera' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 45/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '37/1 37/1 0/1' },
    })
    .jpeg()
    .toBuffer()
}

/** Загружает изображение и (опционально) подтверждает права. */
export async function uploadImage(
  services: Services,
  actor: Actor,
  opts: { title?: string; cleared?: boolean; clearer?: Actor; alt?: string | null } = {},
): Promise<string> {
  const { id } = await services.media.uploadMedia.run(
    actor,
    {
      data: await pngBuffer(),
      metadata: {
        title: opts.title ?? 'Саврасов. Грачи прилетели',
        altText: opts.alt === undefined ? 'Пейзаж с грачами на березах' : opts.alt,
        artist: 'А. К. Саврасов',
        workTitle: 'Грачи прилетели',
        license: 'PUBLIC_DOMAIN',
        sourceUrl: 'https://commons.wikimedia.org/',
      },
    },
    ctx,
  )
  if (opts.cleared) {
    const m = await services.media.getMedia.run(actor, { id }, ctx)
    await services.media.setRightsStatus.run(
      opts.clearer ?? actor,
      { id, status: 'CLEARED', revision: m.revision },
      ctx,
    )
  }
  return id
}
