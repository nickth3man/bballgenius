import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { TextRenderable } from '@opentui/core';
import { initDb, closeDb } from '../db.js';
import { drawHalfCourt, ansiToStyledText } from '../utils/formatters.js';
import { loadRecentGames, loadGameShots } from './helpers/queries.js';
import { assertNoAnsiLeaks, styledPlainText } from './helpers/ansi.js';

type ShotRow = {
  player_id: string;
  team_id: string;
  action_type: string;
  shot_result: string;
  x: number;
  y: number;
};

function buildShotChartContent(shots: ShotRow[]): string {
  const makes = shots.filter(
    (s) => s.shot_result.toLowerCase().includes('made') || s.shot_result === '1'
  ).length;
  const total = shots.length;
  const pct = total > 0 ? ((makes / total) * 100).toFixed(1) : '0.0';
  const courtLines = drawHalfCourt(shots);
  const titleOverlay = `\x1b[1;33mAll Players\x1b[0m\nShots: \x1b[32m${makes}\x1b[0m/\x1b[31m${total - makes}\x1b[0m (${pct}% FG)`;
  return `${titleOverlay}\n\n${courtLines.join('\n')}`;
}

describe('Shot chart OpenTUI rendering', () => {
  let gameId: string;
  let shots: ShotRow[];

  beforeAll(async () => {
    await initDb();
    const games = await loadRecentGames(20);
    expect(games.length).toBeGreaterThan(0);

    for (const game of games) {
      const candidateShots = await loadGameShots(String(game.game_id)) as ShotRow[];
      if (candidateShots.length > 0) {
        gameId = String(game.game_id);
        shots = candidateShots;
        return;
      }
    }

    throw new Error('No game with field-goal shot coordinates found in fact_pbp_events');
  });

  afterAll(async () => {
    await closeDb();
  });

  test('styled shot chart plain text has no raw ANSI leaks', () => {
    const raw = buildShotChartContent(shots);
    const styled = ansiToStyledText(raw);
    const plain = styledPlainText(styled);

    assertNoAnsiLeaks(plain);
    expect(plain).toContain('All Players');
    expect(plain).toContain('Shots:');
  });

  test('TextRenderable plainText after renderOnce has no ANSI leaks', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const styled = ansiToStyledText(buildShotChartContent(shots));

    const shotChartText = new TextRenderable(renderer, {
      id: 'shot-chart',
      content: styled,
    });
    renderer.root.add(shotChartText);

    await virtualUI.renderOnce();

    assertNoAnsiLeaks(shotChartText.plainText);

    renderer.destroy();
  });

  test('captureCharFrame shows made/missed symbols without ANSI leaks', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const styled = ansiToStyledText(buildShotChartContent(shots));

    const shotChartText = new TextRenderable(renderer, {
      id: 'shot-chart-frame',
      content: styled,
    });
    renderer.root.add(shotChartText);

    await virtualUI.renderOnce();

    const frame = virtualUI.captureCharFrame();
    assertNoAnsiLeaks(frame);

    const hasMade = shots.some(
      (s) => s.shot_result.toLowerCase().includes('made') || s.shot_result === '1'
    );
    const hasMissed = shots.some(
      (s) => !s.shot_result.toLowerCase().includes('made') && s.shot_result !== '1'
    );

    if (hasMade) {
      expect(frame).toMatch(/o/);
    }
    if (hasMissed) {
      expect(frame).toMatch(/x/);
    }

    renderer.destroy();
  });

  test('loads real shots from fact_pbp_events for selected game_id', () => {
    expect(gameId).toBeTruthy();
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]).toHaveProperty('x');
    expect(shots[0]).toHaveProperty('y');
    expect(shots[0]).toHaveProperty('shot_result');
  });
});
