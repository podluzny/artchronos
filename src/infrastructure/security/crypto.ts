import { createHash, randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import type { PasswordHasher, TokenService } from '../../application/identity/ports.js'

/** argon2id, параметры OWASP (NFR-SEC-002). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export class Argon2Hasher implements PasswordHasher {
  private dummy: Promise<string> | null = null

  hash(password: string) {
    return argon2.hash(password, OPTIONS)
  }

  async verify(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password)
    } catch {
      return false
    }
  }

  async dummyVerify(password: string) {
    this.dummy ??= argon2.hash('dummy-password-for-timing', OPTIONS)
    await this.verify(await this.dummy, password)
  }
}

export class RandomTokenService implements TokenService {
  generate() {
    return randomBytes(32).toString('base64url')
  }

  hash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }
}
