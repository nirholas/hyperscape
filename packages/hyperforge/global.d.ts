// Type declarations for modules without type definitions

declare module "better-sqlite3" {
  /**
   * Database connection options
   */
  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message: string, ...additionalArgs: string[]) => void;
  }

  /**
   * Result from executing a statement that modifies data
   */
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  /**
   * Row type for SQLite results - key-value pairs with primitive values
   */
  type SqliteValue = string | number | bigint | Buffer | null;
  type SqliteRow = Record<string, SqliteValue>;

  /**
   * Bind parameter types that SQLite accepts
   */
  type BindValue = SqliteValue | boolean;
  type BindParameters = BindValue[] | Record<string, BindValue>;

  /**
   * Prepared statement for executing SQL queries
   * @template TRow The row type returned by get/all/iterate
   * @template TParams The parameter types for binding
   */
  interface Statement<
    TRow extends SqliteRow = SqliteRow,
    TParams extends BindParameters = BindParameters,
  > {
    run(
      ...params: TParams extends BindValue[] ? TParams : [TParams]
    ): RunResult;
    get(
      ...params: TParams extends BindValue[] ? TParams : [TParams]
    ): TRow | undefined;
    all(...params: TParams extends BindValue[] ? TParams : [TParams]): TRow[];
    iterate(
      ...params: TParams extends BindValue[] ? TParams : [TParams]
    ): IterableIterator<TRow>;
    bind(...params: TParams extends BindValue[] ? TParams : [TParams]): this;
    pluck(toggle?: boolean): this;
    expand(toggle?: boolean): this;
    raw(toggle?: boolean): this;
    columns(): ColumnDefinition[];
    readonly source: string;
    readonly reader: boolean;
  }

  /**
   * Column definition returned by statement.columns()
   */
  interface ColumnDefinition {
    name: string;
    column: string | null;
    table: string | null;
    database: string | null;
    type: string | null;
  }

  /**
   * Pragma result types
   */
  type PragmaValue = string | number | null;
  type PragmaResult = PragmaValue | SqliteRow | SqliteRow[];

  /**
   * Transaction function type
   */
  type TransactionFunction<TArgs extends BindValue[], TReturn> = (
    ...args: TArgs
  ) => TReturn;

  /**
   * Database instance for executing queries
   */
  interface DatabaseInstance {
    prepare<
      TRow extends SqliteRow = SqliteRow,
      TParams extends BindParameters = BindParameters,
    >(
      source: string,
    ): Statement<TRow, TParams>;
    exec(source: string): this;
    close(): this;
    pragma(source: string, options?: { simple?: boolean }): PragmaResult;
    transaction<TArgs extends BindValue[], TReturn>(
      fn: TransactionFunction<TArgs, TReturn>,
    ): TransactionFunction<TArgs, TReturn>;
    backup(
      destinationFile: string,
      options?: BackupOptions,
    ): Promise<BackupResult>;
    readonly name: string;
    readonly open: boolean;
    readonly inTransaction: boolean;
    readonly memory: boolean;
    readonly readonly: boolean;
  }

  /**
   * Backup options
   */
  interface BackupOptions {
    progress?: (info: { totalPages: number; remainingPages: number }) => void;
  }

  /**
   * Backup result
   */
  interface BackupResult {
    totalPages: number;
    remainingPages: number;
  }

  /**
   * Database constructor
   */
  interface DatabaseConstructor {
    new (
      filename: string | Buffer,
      options?: DatabaseOptions,
    ): DatabaseInstance;
    (filename: string | Buffer, options?: DatabaseOptions): DatabaseInstance;
  }

  const Database: DatabaseConstructor;
  export default Database;
  export type {
    DatabaseInstance as Database,
    Statement,
    RunResult,
    SqliteRow,
    SqliteValue,
    BindValue,
    BindParameters,
  };
}
