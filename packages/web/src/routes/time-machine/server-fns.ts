import { createServerFn } from '@tanstack/react-start';
import type { PlayerDossier } from 'data/tabs/time-machine/queries';

export interface PlayerResult {
  player_id: string;
  full_name: string;
  from_year: string;
  to_year: string;
  is_active: boolean;
  position?: string | null;
}

export const searchPlayersFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { search: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(
      `SELECT DISTINCT
              p.person_id AS player_id,
              p.first_name || ' ' || p.last_name AS full_name,
              p.from_year::VARCHAR,
              p.to_year::VARCHAR,
              p.to_year >= 2025 AS is_active,
              (SELECT bp.primary_position
                 FROM main.bridge_player_source_id src
                 JOIN main.dim_bref_player bp
                   ON bp.bref_player_id = src.source_player_id
                WHERE src.person_id = p.person_id
                  AND src.source_system = 'basketball_reference'
                LIMIT 1) AS primary_position
       FROM main.dim_player p
       WHERE p.first_name || ' ' || p.last_name ILIKE $1
       ORDER BY p.first_name, p.last_name
       LIMIT 25`,
      [`%${data.search.trim()}%`],
    );
    return rows.map((r) => ({
      player_id: String(r['player_id']),
      full_name: String(r['full_name']),
      from_year: String(r['from_year'] ?? ''),
      to_year: String(r['to_year'] ?? ''),
      is_active: Boolean(r['is_active']),
      position: r['primary_position'] ? String(r['primary_position']) : null,
    }));
  });

export const loadPlayerDossierFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { playerId: string }) => data)
  .handler(async ({ data }): Promise<PlayerDossier> => {
    const { loadPlayerDossier } = await import('data/tabs/time-machine/queries');
    return loadPlayerDossier(data.playerId);
  });

export const loadDefaultPlayerFn = createServerFn({
  method: 'GET',
  strict: { output: false },
}).handler(async (): Promise<PlayerResult | null> => {
  const { loadDefaultPlayer } = await import('data/tabs/time-machine/queries');
  const row = await loadDefaultPlayer();
  if (!row) return null;
  return {
    player_id: String(row.player_id),
    full_name: String(row.full_name),
    from_year: String(row.from_year ?? ''),
    to_year: String(row.to_year ?? ''),
    is_active: Boolean(row.is_active),
  };
});

export const loadFeaturedPlayersFn = createServerFn({
  method: 'GET',
  strict: { output: false },
}).handler(async (): Promise<PlayerResult[]> => {
  const { loadFeaturedPlayers } = await import('data/tabs/time-machine/queries');
  const rows = await loadFeaturedPlayers();
  return rows.map((r) => ({
    player_id: String(r.player_id),
    full_name: String(r.full_name),
    from_year: String(r.from_year ?? ''),
    to_year: String(r.to_year ?? ''),
    is_active: Boolean(r.is_active),
    position: r.position ? String(r.position) : null,
  }));
});

export const loadPlayerByIdFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { playerId: string }) => data)
  .handler(async ({ data }): Promise<PlayerResult | null> => {
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(
      `SELECT DISTINCT
              p.person_id AS player_id,
              p.first_name || ' ' || p.last_name AS full_name,
              p.from_year::VARCHAR,
              p.to_year::VARCHAR,
              p.to_year >= 2025 AS is_active
       FROM main.dim_player p
       WHERE p.person_id = CAST($1 AS INTEGER)
       LIMIT 1`,
      [data.playerId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      player_id: String(r['player_id']),
      full_name: String(r['full_name']),
      from_year: String(r['from_year'] ?? ''),
      to_year: String(r['to_year'] ?? ''),
      is_active: Boolean(r['is_active']),
    };
  });
