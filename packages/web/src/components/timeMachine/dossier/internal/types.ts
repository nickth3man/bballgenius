import type { PlayerPerGameRow } from 'data/tabs/time-machine/queries';

export interface CareerSummaryRow {
  label: string;
  isBold: boolean;
  row: Partial<PlayerPerGameRow>;
}
