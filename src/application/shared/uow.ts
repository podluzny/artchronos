/** Unit of Work: одна транзакция на use case (NFR-DATA-004). `read` — без транзакции, для запросов. */
export interface UnitOfWork<Tx> {
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>
  readonly read: Tx
}
