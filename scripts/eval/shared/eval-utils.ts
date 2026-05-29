// Shared utility functions for eval scripts

/**
 * Wraps a promise with a timeout. Rejects if the promise doesn't resolve within timeoutMs.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Normalizes text for comparison: lowercases, replaces smart quotes, strips special chars,
 * collapses whitespace.
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9.'"-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts only numeric characters (digits, dots, hyphens) from a string.
 */
export function normalizeNumeric(value: string): string {
  return value.replace(/[^\d.-]+/g, '');
}

/**
 * Counts non-overlapping occurrences of needle in haystack.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) return count;
    count++;
    index = found + needle.length;
  }
}

/**
 * Detects duplicate/repeated content in a final answer — either the expected token
 * appearing 4+ times, sentences repeated 3+ times, or paragraphs repeated 2+ times.
 */
export function detectDuplicateFinalAnswer(
  answer: string,
  expected: string,
): {
  duplicate: boolean;
  evidence?: string;
} {
  const normalized = normalizeText(answer);
  if (!normalized) return { duplicate: false };

  const expectedNorm = normalizeText(expected);
  if (expectedNorm && expectedNorm !== 'clarification' && expectedNorm !== 'not available') {
    const expectedMentions = countOccurrences(normalized, expectedNorm);
    if (expectedMentions >= 4) {
      return {
        duplicate: true,
        evidence: `expected token "${expected}" appears ${expectedMentions} times`,
      };
    }
  }

  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= 30);

  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const count = (counts.get(sentence) || 0) + 1;
    counts.set(sentence, count);
    if (count >= 3) {
      return {
        duplicate: true,
        evidence: `sentence repeated ${count} times: ${sentence.slice(0, 100)}`,
      };
    }
  }

  const paragraphs = answer
    .split(/\n{2,}/)
    .map((p) => normalizeText(p))
    .filter((p) => p.length >= 40);

  const paragraphCounts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const count = (paragraphCounts.get(paragraph) || 0) + 1;
    paragraphCounts.set(paragraph, count);
    if (count >= 2) {
      return {
        duplicate: true,
        evidence: `paragraph repeated ${count} times: ${paragraph.slice(0, 100)}`,
      };
    }
  }

  return { duplicate: false };
}

/**
 * Simplifies an answer string: lowercases and strips special characters beyond basic punctuation.
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/[^a-z0-9\s.,'-]/g, '')
    .trim();
}

/**
 * Removes commas from a numeric string.
 */
export function normalizeNumbers(s: string): string {
  return s.replace(/,/g, '');
}
