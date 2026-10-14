import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
type Result = { data: Row[] | Row | null; error: { message: string } | null }
type Operation = 'select' | 'insert' | 'update'

export function createSupabaseStub(
  initialTables: Record<string, Row[]>,
  failures: Record<string, string> = {}
) {
  const tables = structuredClone(initialTables)
  let sequence = 0

  class Query implements PromiseLike<Result> {
    private filters: Array<(row: Row) => boolean> = []
    private operation: Operation = 'select'
    private payload: Row | Row[] = {}
    private singleRow = false
    private maximum = Infinity
    private offset = 0
    private sort: { column: string; ascending: boolean } | null = null
    private table: string

    constructor(table: string) { this.table = table }

    select() { return this }
    eq(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value)
      return this
    }
    is(column: string, value: unknown) { return this.eq(column, value) }
    not(column: string, operator: string, value: unknown) {
      if (operator !== 'is') throw new Error('Unsupported fixture operator')
      this.filters.push((row) => row[column] !== value)
      return this
    }
    gte(column: string, value: string) { this.filters.push((row) => String(row[column]) >= value); return this }
    lte(column: string, value: string) { this.filters.push((row) => String(row[column]) <= value); return this }
    lt(column: string, value: string) { this.filters.push((row) => String(row[column]) < value); return this }
    gt(column: string, value: number) {
      this.filters.push((row) => Number(row[column]) > value)
      return this
    }
    in(column: string, values: unknown[]) {
      this.filters.push((row) => values.includes(row[column]))
      return this
    }
    order(column: string, options: { ascending: boolean } = { ascending: true }) {
      this.sort = { column, ascending: options.ascending }
      return this
    }
    limit(maximum: number) { this.maximum = maximum; return this }
    range(from: number, to: number) { this.offset = from; this.maximum = to - from + 1; return this }
    insert(payload: Row | Row[]) { this.operation = 'insert'; this.payload = payload; return this }
    update(payload: Row) { this.operation = 'update'; this.payload = payload; return this }
    maybeSingle() { this.singleRow = true; return Promise.resolve(this.execute()) }
    single() { this.singleRow = true; return Promise.resolve(this.execute()) }

    private execute(): Result {
      const failure = failures[`${this.table}:${this.operation}`]
      if (failure) return { data: null, error: { message: failure } }
      const rows = tables[this.table] ??= []
      let selected = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.sort) {
        const { column, ascending } = this.sort
        selected = [...selected].sort((a, b) =>
          String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)
        )
      }
      selected = selected.slice(this.offset, this.offset + this.maximum)
      if (this.operation === 'insert') {
        selected = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(payload =>
          ({ id: `fixture-${++sequence}`, canceled_at: null, ...payload }))
        rows.push(...selected)
      } else if (this.operation === 'update') {
        selected.forEach((row) => Object.assign(row, this.payload))
      }
      return { data: structuredClone(this.singleRow ? selected[0] ?? null : selected), error: null }
    }

    then<TResult1 = Result, TResult2 = never>(
      onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
    }
  }

  return {
    client: { from: (table: string) => new Query(table) } as unknown as SupabaseClient,
    rows: (table: string) => structuredClone(tables[table] ?? []),
  }
}
