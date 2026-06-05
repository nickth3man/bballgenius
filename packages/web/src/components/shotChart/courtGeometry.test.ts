import { describe, expect, test } from 'bun:test';

import {
  COURT,
  courtFeetToSvg,
  dataToCourtFeet,
  dataToSvg,
  restrictedAreaPath,
  SVG,
  threePointLinePath,
} from './courtGeometry.js';

describe('NBA shot chart court geometry', () => {
  test('uses the official basket center distance from the baseline', () => {
    // NBA Rule 1: backboard face is 4 ft from the end line, the nearest inside
    // ring edge is 6 in from the board, and the ring radius is 9 in.
    expect(Number(COURT.basketFromBaseline)).toBe(5.25);
  });

  test('maps the normalized rim coordinate to the basket center', () => {
    const normalizedRimX = (COURT.basketFromBaseline / COURT.halfLength) * 50;
    const rim = dataToCourtFeet(normalizedRimX, 50);

    expect(rim.cx).toBeCloseTo(0, 6);
    expect(rim.cy).toBeCloseTo(0, 6);
  });

  test('renders a standard half court with the baseline and basket at the bottom', () => {
    const baseline = courtFeetToSvg(0, -COURT.basketFromBaseline);
    const basket = courtFeetToSvg(0, 0);
    const normalizedRimX = (COURT.basketFromBaseline / COURT.halfLength) * 50;
    const plottedRim = dataToSvg(normalizedRimX, 50);

    expect(baseline.y).toBeCloseTo(SVG.height, 6);
    expect(basket.y).toBeCloseTo(SVG.height - COURT.basketFromBaseline * SVG.scale, 6);
    expect(plottedRim.x).toBeCloseTo(basket.x, 6);
    expect(plottedRim.y).toBeCloseTo(basket.y, 6);
  });

  test('draws the restricted-area arc away from the baseline', () => {
    const path = restrictedAreaPath();
    const firstSegment = path.match(
      /^M (?<startX>[\d.]+) (?<backboardY>[\d.]+) L (?<lineX>[\d.]+) (?<basketY>[\d.]+)/,
    );

    expect(firstSegment).not.toBeNull();
    expect(Number(firstSegment?.groups?.backboardY)).toBeGreaterThan(
      Number(firstSegment?.groups?.basketY),
    );
    expect(path).toContain('A 40 40 0 0 0');
  });

  test('draws the three-point arc away from the baseline after vertical flipping', () => {
    const arcRadius = COURT.threePointArcRadius * SVG.scale;

    expect(threePointLinePath()).toContain(`A ${arcRadius} ${arcRadius} 0 0 1`);
  });

  test('keeps the half-court SVG scaled to regulation dimensions', () => {
    expect(Number(SVG.width)).toBeCloseTo(COURT.width * SVG.scale, 6);
    expect(Number(SVG.height)).toBeCloseTo(COURT.halfLength * SVG.scale, 6);
  });
});
