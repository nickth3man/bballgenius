import { existsSync } from 'node:fs';
import type { DuckDBConnection } from '@duckdb/node-api';
import { DuckDBInstance } from '@duckdb/node-api';
import type { SqlParam } from './types.js';

let honorsInstance: DuckDBInstance | null = null;
let honorsConnection: DuckDBConnection | null = null;
let honorsConnecting: Promise<DuckDBConnection> | null = null;

/**
 * Optional path to a DuckDB file with richer honors (e.g. basketball-data nba.duckdb).
 * When set and the file exists, Time Machine accolades load from `v_player_honors_full`.
 */
export function resolveHonorsDbPath(): string | null {
  const path = process.env['NBA_HONORS_DUCKDB_PATH']?.trim();
  if (!path) return null;
  return existsSync(path) ? path : null;
}

export function isHonorsDbConfigured(): boolean {
  return resolveHonorsDbPath() !== null;
}

async function getHonorsConnection(): Promise<DuckDBConnection | null> {
  const path = resolveHonorsDbPath();
  if (!path) return null;

  if (honorsConnection) {
    return honorsConnection;
  }
  // Cache the in-flight promise so concurrent callers share a single connection.
  if (!honorsConnecting) {
    honorsConnecting = (async () => {
      honorsInstance = await DuckDBInstance.fromCache(path);
      const conn = await honorsInstance.connect();
      honorsConnection = conn;
      return conn;
    })().catch((err) => {
      honorsConnecting = null;
      honorsInstance = null;
      throw err;
    });
  }
  return honorsConnecting;
}

/** Runs SQL against the optional honors database; returns [] if not configured. */
export async function queryHonors<T>(sql: string, params?: SqlParam[]): Promise<T[]> {
  const conn = await getHonorsConnection();
  if (!conn) return [];

  const reader =
    params && params.length > 0
      ? await conn.runAndReadAll(sql, params)
      : await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as T[];
}

export async function closeHonorsDb(): Promise<void> {
  if (honorsConnection) {
    honorsConnection.disconnectSync();
    honorsConnection = null;
  }
  honorsConnecting = null;
  honorsInstance = null;
}
