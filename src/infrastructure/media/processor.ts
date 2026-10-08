import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import type { Derivative, InspectedFile, MediaProcessor } from '../../application/media/ports.js'
import { MAX_IMAGE_SIDE, MEDIA_FORMATS } from '../../domain/media/media-rules.js'
import { DomainError } from '../../domain/shared/errors.js'

/**
 * NFR-SEC-006: формат определяется по сигнатуре (не по расширению); изображения перекодируются
 * (метаданные EXIF/GPS не переносятся), TIFF → PNG. Производные — WebP 320 и 1600 px (FR-MEDIA-004).
 */
export class SharpMediaProcessor implements MediaProcessor {
  async inspect(data: Buffer): Promise<InspectedFile | null> {
    const ft = await fileTypeFromBuffer(data)
    if (!ft) return null
    const fmt = MEDIA_FORMATS[ft.mime]
    if (!fmt) return { mime: ft.mime, kind: 'IMAGE', width: null, height: null }
    if (fmt.kind === 'VIDEO') return { mime: ft.mime, kind: 'VIDEO', width: null, height: null }
    const meta = await sharp(data, { limitInputPixels: MAX_IMAGE_SIDE * MAX_IMAGE_SIDE }).metadata()
    return { mime: ft.mime, kind: 'IMAGE', width: meta.width ?? null, height: meta.height ?? null }
  }

  async sanitize(data: Buffer, file: InspectedFile) {
    if (file.kind === 'VIDEO') return { data, mime: file.mime, width: null, height: null }
    if ((file.width ?? 0) > MAX_IMAGE_SIDE || (file.height ?? 0) > MAX_IMAGE_SIDE) {
      throw DomainError.validation([{ field: 'file', message: `Изображение больше ${MAX_IMAGE_SIDE} px по стороне` }])
    }
    const img = sharp(data, { limitInputPixels: MAX_IMAGE_SIDE * MAX_IMAGE_SIDE }).rotate()
    const target = file.mime === 'image/tiff' ? 'png' : (file.mime.split('/')[1] as 'jpeg' | 'png' | 'webp')
    const out = await img
      .toFormat(target, target === 'jpeg' ? { quality: 92, mozjpeg: true } : {})
      .toBuffer({ resolveWithObject: true })
    return { data: out.data, mime: `image/${target}`, width: out.info.width, height: out.info.height }
  }

  async derivatives(data: Buffer, file: InspectedFile): Promise<Derivative[]> {
    if (file.kind !== 'IMAGE') return []
    const make = async (variant: 'THUMB' | 'PREVIEW', size: number): Promise<Derivative> => {
      const r = await sharp(data)
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true })
      return { variant, data: r.data, mime: 'image/webp', width: r.info.width, height: r.info.height }
    }
    return [await make('THUMB', 320), await make('PREVIEW', 1600)]
  }

  sha256(data: Buffer) {
    return createHash('sha256').update(data).digest('hex')
  }
}
