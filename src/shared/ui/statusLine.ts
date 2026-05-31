/**
 * Accumulates non-empty status-line segments and joins them with a configurable
 * separator. The separator is per-tab (e.g. `' | '` for most tabs, `' \xb7 '` for
 * Time Machine), so converging on this builder does not change any tab's output.
 */
export class StatusLine {
  private readonly parts: string[] = [];

  constructor(private readonly sep = ' | ') {}

  /** Append a segment; falsy values (empty string, null, false) are skipped. */
  add(part?: string | null | false): this {
    if (part) this.parts.push(part);
    return this;
  }

  /** True if any already-added segment contains `substr`. */
  includes(substr: string): boolean {
    return this.parts.some((part) => part.includes(substr));
  }

  toString(): string {
    return this.parts.join(this.sep);
  }
}
