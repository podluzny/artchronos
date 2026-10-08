import { BaseProperty, BaseRecord, BaseResource, flat, type ActionContext, type Filter, type ParamsType } from 'adminjs'
import type { Actor } from '../../domain/authorization/actor.js'
import { isDomainError } from '../../domain/shared/errors.js'
import type { RequestContext } from '../../application/shared/context.js'
import type { ListQuery } from '../../application/shared/query.js'
import { adminCall } from '../errors.js'
import { currentActor, currentScope } from '../context.js'

export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'textarea'
  | 'richtext'
  | 'reference'
  | 'mixed'
  | 'password'
  | 'key-value'
  | 'currency'
  | 'phone'
  | 'uuid'

export interface PropertyDef {
  path: string
  type?: PropertyType
  isId?: boolean
  isArray?: boolean
  isSortable?: boolean
  reference?: string
  availableValues?: { value: string; label: string }[]
}

/**
 * Шлюз ресурса к application layer. Каждый метод вызывает use case с текущим actor —
 * авторизация и бизнес-правила выполняются там, а не в AdminJS (ADR-004).
 */
export interface ResourceGateway<T extends Record<string, unknown> = Record<string, unknown>> {
  list(actor: Actor, query: ListQuery, ctx: RequestContext): Promise<{ records: T[]; total: number }>
  get(actor: Actor, id: string, ctx: RequestContext): Promise<T>
  create?(actor: Actor, params: Record<string, any>, ctx: RequestContext): Promise<T>
  update?(actor: Actor, id: string, params: Record<string, any>, ctx: RequestContext): Promise<T>
  delete?(actor: Actor, id: string, ctx: RequestContext): Promise<void>
}

class DomainProperty extends BaseProperty {
  private readonly def: PropertyDef
  constructor(def: PropertyDef, position: number) {
    super({
      path: def.path,
      type: def.type ?? 'string',
      isId: def.isId ?? false,
      isSortable: def.isSortable ?? false,
      position,
    })
    this.def = def
  }
  override isArray() {
    return this.def.isArray ?? false
  }
  override reference() {
    return this.def.reference ?? null
  }
  override availableValues() {
    return this.def.availableValues?.map((v) => v.value) ?? null
  }
  override isEditable() {
    return !this.def.isId
  }
}

export class DomainResource extends BaseResource {
  private readonly resourceId: string
  private readonly props: DomainProperty[]
  private readonly gateway: ResourceGateway

  constructor(opts: { id: string; properties: PropertyDef[]; gateway: ResourceGateway }) {
    super(null)
    this.resourceId = opts.id
    this.props = opts.properties.map((p, i) => new DomainProperty(p, i))
    this.gateway = opts.gateway
  }

  static override isAdapterFor(): boolean {
    return false
  }

  override databaseName() {
    return 'artchronos'
  }

  override databaseType() {
    return 'domain'
  }

  override id() {
    return this.resourceId
  }

  override properties() {
    return this.props
  }

  override property(path: string) {
    return this.props.find((p) => p.path() === path) ?? null
  }

  private query(
    filter: Filter,
    options: { limit?: number; offset?: number; sort?: { sortBy?: string; direction?: 'asc' | 'desc' } } = {},
  ): ListQuery {
    const filters: Record<string, string> = {}
    for (const [key, f] of Object.entries(filter?.filters ?? {})) {
      const v = (f as { value: unknown }).value
      if (typeof v === 'string' && v !== '') filters[key] = v
      else if (v && typeof v === 'object') {
        const r = v as { from?: string; to?: string }
        if (r.from) filters[`${key}From`] = r.from
        if (r.to) filters[`${key}To`] = r.to
      }
    }
    return {
      filters,
      limit: Math.min(options.limit ?? 10, 500),
      offset: options.offset ?? 0,
      ...(options.sort?.sortBy ? { sortBy: options.sort.sortBy } : {}),
      ...(options.sort?.direction ? { direction: options.sort.direction } : {}),
    }
  }

  override async count(filter: Filter, _context?: ActionContext): Promise<number> {
    return adminCall(async () => {
      const r = await this.gateway.list(
        currentActor(),
        { ...this.query(filter), limit: 1, offset: 0 },
        currentScope().ctx,
      )
      return r.total
    })
  }

  override async find(filter: Filter, options: any, _context?: ActionContext): Promise<BaseRecord[]> {
    return adminCall(async () => {
      const r = await this.gateway.list(currentActor(), this.query(filter, options), currentScope().ctx)
      return r.records.map((rec) => new BaseRecord(flat.flatten(rec) as ParamsType, this))
    })
  }

  override async findOne(id: string, _context?: ActionContext): Promise<BaseRecord | null> {
    try {
      const rec = await this.gateway.get(currentActor(), id, currentScope().ctx)
      return new BaseRecord(flat.flatten(rec) as ParamsType, this)
    } catch (e) {
      if (isDomainError(e) && (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN')) return null
      return adminCall(() => Promise.reject(e))
    }
  }

  override async findMany(ids: Array<string | number>, context?: ActionContext): Promise<BaseRecord[]> {
    const out: BaseRecord[] = []
    for (const id of ids) {
      const r = await this.findOne(String(id), context)
      if (r) out.push(r)
    }
    return out
  }

  override async create(params: Record<string, any>, _context?: ActionContext): Promise<ParamsType> {
    return adminCall(async () => {
      if (!this.gateway.create) throw new Error('create not supported')
      const r = await this.gateway.create(currentActor(), flat.unflatten(params), currentScope().ctx)
      return flat.flatten(r) as ParamsType
    })
  }

  override async update(id: string, params: Record<string, any>, _context?: ActionContext): Promise<ParamsType> {
    return adminCall(async () => {
      if (!this.gateway.update) throw new Error('update not supported')
      const r = await this.gateway.update(currentActor(), id, flat.unflatten(params), currentScope().ctx)
      return flat.flatten(r) as ParamsType
    })
  }

  override async delete(id: string, _context?: ActionContext): Promise<void> {
    return adminCall(async () => {
      if (!this.gateway.delete) throw new Error('delete not supported')
      await this.gateway.delete(currentActor(), id, currentScope().ctx)
    })
  }
}
