// NBA Court Dimensions and Coordinate Transformations
// All measurements in feet unless noted

export const COURT = {
  // Full court
  length: 94,
  width: 50,
  // Half-court (baseline to half-court line)
  halfLength: 47,
  // Basket
  basketFromBaseline: 5.25,
  rimRadius: 0.75, // 9 inches
  // Backboard
  backboardFromBaseline: 4,
  backboardWidth: 6,
  // Paint (key)
  keyWidth: 16,
  keyLength: 19,
  // Free throw
  freeThrowLine: 19, // from baseline
  freeThrowCircleRadius: 6,
  // Three-point line
  threePointArcRadius: 23.75, // 23'9"
  threePointCornerDist: 22, // horizontal distance from basket
  threePointStraightLength: 14, // from baseline to arc start (approx)
  // Restricted area
  restrictedAreaRadius: 4,
  // Key marks
  keyMarkPositions: [7, 8, 11, 14], // feet from baseline
  keyMarkWidth: 0.5,
} as const;

// SVG configuration
export const SVG = {
  width: 500,
  height: 470,
  scale: 10, // pixels per foot
} as const;

/**
 * Convert database coordinates to court feet coordinates.
 *
 * Database convention (from fact_pbp_events):
 *   x: 0..100 (left baseline to right baseline across full 94ft court)
 *   y: 0..100 (bottom sideline to top sideline across 50ft width)
 *
 * For half-court display, we "fold" shots from the far basket
 * to the near basket.
 *
 * Court feet coordinates (origin at basket center):
 *   cx: -25..25 (left sideline to right sideline)
 *   cy: -5.25..41.75 (baseline to half-court line)
 */
export function dataToCourtFeet(dataX: number, dataY: number): { cx: number; cy: number } {
  // Fold to nearest baseline (0-50 scale = 0-47 feet)
  const xHalf = dataX <= 50 ? dataX : 100 - dataX;

  // Distance from baseline in feet, then offset by basket position
  const cy = (xHalf / 50) * COURT.halfLength - COURT.basketFromBaseline;

  // Lateral position: 0-100 maps to -25..25 feet
  const cx = (dataY / 100) * COURT.width - COURT.width / 2;

  return { cx, cy };
}

/**
 * Convert court feet coordinates to SVG pixel coordinates.
 *
 * SVG coordinate system:
 *   (0, 0) is top-left
 *   x increases to the right
 *   y increases downward
 *
 * Court layout in SVG:
 *   Half-court line at top (y=0)
 *   Baseline at bottom (y=470)
 *   Left sideline at left (x=0)
 *   Right sideline at right (x=500)
 */
export function courtFeetToSvg(cx: number, cy: number): { x: number; y: number } {
  return {
    x: (cx + COURT.width / 2) * SVG.scale,
    y: SVG.height - (cy + COURT.basketFromBaseline) * SVG.scale,
  };
}

/**
 * Convert database coordinates directly to SVG coordinates.
 */
export function dataToSvg(dataX: number, dataY: number): { x: number; y: number } {
  const feet = dataToCourtFeet(dataX, dataY);
  return courtFeetToSvg(feet.cx, feet.cy);
}

/**
 * Build the SVG path for the three-point line.
 */
export function threePointLinePath(): string {
  const { basketFromBaseline, threePointArcRadius, threePointCornerDist } = COURT;

  // Calculate where the arc intersects the straight corner lines
  // Horizontal distance from basket: 22 ft
  // Arc radius: 23.75 ft
  // Vertical distance from basket to intersection
  const arcStartOffset = Math.sqrt(threePointArcRadius ** 2 - threePointCornerDist ** 2);

  // Key points in feet (origin at basket)
  const cornerX = threePointCornerDist;
  const arcStartY = arcStartOffset;
  const baselineY = -basketFromBaseline;

  // Convert to SVG coordinates
  const bl = courtFeetToSvg(-cornerX, baselineY);
  const ls = courtFeetToSvg(-cornerX, arcStartY);
  const rs = courtFeetToSvg(cornerX, arcStartY);
  const br = courtFeetToSvg(cornerX, baselineY);

  // Arc radius in SVG pixels
  const arcR = threePointArcRadius * SVG.scale;

  // SVG path: left baseline → left straight → arc → right straight → right baseline
  return [
    `M ${bl.x} ${bl.y}`,
    `L ${ls.x} ${ls.y}`,
    `A ${arcR} ${arcR} 0 0 1 ${rs.x} ${rs.y}`,
    `L ${br.x} ${br.y}`,
  ].join(' ');
}

/**
 * Build the SVG path for the restricted area (semi-circle under basket
 * with straight lines to the backboard face).
 */
export function restrictedAreaPath(): string {
  const r = COURT.restrictedAreaRadius * SVG.scale;
  const left = courtFeetToSvg(-COURT.restrictedAreaRadius, 0);
  const right = courtFeetToSvg(COURT.restrictedAreaRadius, 0);
  const backboardY = SVG.height - COURT.backboardFromBaseline * SVG.scale;

  // Semi-circle away from the baseline with straight lines to the backboard face.
  return [
    `M ${left.x} ${backboardY}`,
    `L ${left.x} ${left.y}`,
    `A ${r} ${r} 0 0 0 ${right.x} ${right.y}`,
    `L ${right.x} ${backboardY}`,
  ].join(' ');
}

/**
 * Build SVG path for one half of the free-throw circle.
 */
export function freeThrowCirclePath(half: 'outer' | 'lane' = 'outer'): string {
  const r = COURT.freeThrowCircleRadius * SVG.scale;
  const center = courtFeetToSvg(0, COURT.freeThrowLine - COURT.basketFromBaseline);
  const sweepFlag = half === 'outer' ? 0 : 1;

  return [
    `M ${center.x - r} ${center.y}`,
    `A ${r} ${r} 0 0 ${sweepFlag} ${center.x + r} ${center.y}`,
  ].join(' ');
}

/**
 * Build SVG path for the half-court circle.
 */
export function halfCourtCirclePath(): string {
  const r = COURT.freeThrowCircleRadius * SVG.scale; // Same radius as FT circle
  const centerX = SVG.width / 2;
  const centerY = SVG.height - COURT.halfLength * SVG.scale;

  return [
    `M ${centerX - r} ${centerY}`,
    `A ${r} ${r} 0 1 1 ${centerX + r} ${centerY}`,
    `A ${r} ${r} 0 1 1 ${centerX - r} ${centerY}`,
  ].join(' ');
}
