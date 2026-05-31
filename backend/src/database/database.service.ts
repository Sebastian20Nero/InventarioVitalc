import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool, PoolClient } from 'pg';
import { runSeed } from './seed';

export type Queryable = Pool | PoolClient;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
  }

  async onModuleInit() {
    await this.esperarConexion();
    this.logger.log('Conexion a PostgreSQL establecida');

    if ((process.env.DB_AUTO_INIT ?? 'true').toLowerCase() === 'true') {
      await this.applySchema();
    }

    if ((process.env.DB_RUN_SEED ?? 'true').toLowerCase() === 'true') {
      await runSeed(this);
    }
  }

  private async esperarConexion() {
    const intentos = Number(process.env.DB_CONNECT_RETRIES ?? 15);
    const esperaMs = Number(process.env.DB_CONNECT_RETRY_MS ?? 2000);

    for (let intento = 1; intento <= intentos; intento++) {
      try {
        await this.pool.query('SELECT 1');
        return;
      } catch (error) {
        if (intento === intentos) {
          throw error;
        }
        this.logger.warn(
          `PostgreSQL no disponible (intento ${intento}/${intentos}). Reintentando en ${esperaMs} ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, esperaMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T = any>(text: string, params: unknown[] = [], client?: Queryable): Promise<T[]> {
    const result = await (client ?? this.pool).query(text, params as unknown[]);
    return result.rows as T[];
  }

  async one<T = any>(text: string, params: unknown[] = [], client?: Queryable): Promise<T | null> {
    const rows = await this.query<T>(text, params, client);
    return rows[0] ?? null;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applySchema() {
    const schemaPath = join(process.cwd(), 'db', 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf8');
    await this.pool.query(sql);
    this.logger.log('Esquema aplicado (db/schema.sql)');
  }
}
