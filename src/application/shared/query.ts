export interface ListQuery {
  filters: Record<string, string>
  sortBy?: string
  direction?: 'asc' | 'desc'
  limit: number
  offset: number
}
