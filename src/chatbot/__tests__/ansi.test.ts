import { describe, expect, test } from 'bun:test';
import { ansiToStyledText } from '../utils/ansi.js';

describe('ansiToStyledText', () => {
  test('returns single chunk with text and no styling for plain input', () => {
    const styled = ansiToStyledText('Hello World');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Hello World');
    expect(styled.chunks[0].fg).toBeUndefined();
    expect(styled.chunks[0].attributes).toBeUndefined();
  });

  test('sets bold attribute for \\x1b[1m code', () => {
    const styled = ansiToStyledText('\x1b[1mBold text\x1b[0m');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Bold text');
    expect(styled.chunks[0].attributes).toBeDefined();
    expect(styled.chunks[0].attributes! & (1 << 0)).not.toBe(0);
  });

  test('sets dim attribute for \\x1b[2m code', () => {
    const styled = ansiToStyledText('\x1b[2mDim text\x1b[0m');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Dim text');
    expect(styled.chunks[0].attributes).toBeDefined();
    expect(styled.chunks[0].attributes! & (1 << 1)).not.toBe(0);
  });

  test('parses blue foreground from \\x1b[1;34m code', () => {
    const styled = ansiToStyledText('\x1b[1;34mBlue bold\x1b[0m');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Blue bold');
    expect(styled.chunks[0].fg).toBeDefined();
  });

  test('parses green foreground from \\x1b[1;32m code', () => {
    const styled = ansiToStyledText('\x1b[1;32mGreen bold\x1b[0m');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Green bold');
    expect(styled.chunks[0].fg).toBeDefined();
  });

  test('parses brightBlack foreground from \\x1b[90m code', () => {
    const styled = ansiToStyledText('\x1b[90mBright black\x1b[0m');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Bright black');
    expect(styled.chunks[0].fg).toBeDefined();
  });

  test('splits text into multiple chunks for mixed ANSI codes', () => {
    const styled = ansiToStyledText('A \x1b[1mB\x1b[0m C \x1b[2mD\x1b[0m E');
    expect(styled.chunks.length).toBe(5);
    expect(styled.chunks[0].text).toBe('A ');
    expect(styled.chunks[0].fg).toBeUndefined();
    expect(styled.chunks[0].attributes).toBeUndefined();
    expect(styled.chunks[1].text).toBe('B');
    expect(styled.chunks[1].attributes! & (1 << 0)).not.toBe(0);
    expect(styled.chunks[2].text).toBe(' C ');
    expect(styled.chunks[2].attributes).toBeUndefined();
    expect(styled.chunks[3].text).toBe('D');
    expect(styled.chunks[3].attributes! & (1 << 1)).not.toBe(0);
    expect(styled.chunks[4].text).toBe(' E');
    expect(styled.chunks[4].attributes).toBeUndefined();
  });

  test('reset code (0) clears all active attributes', () => {
    const styled = ansiToStyledText('\x1b[1mBold\x1b[0mNormal');
    expect(styled.chunks.length).toBe(2);
    expect(styled.chunks[0].text).toBe('Bold');
    expect(styled.chunks[0].attributes).toBeDefined();
    expect(styled.chunks[1].text).toBe('Normal');
    expect(styled.chunks[1].attributes).toBeUndefined();
    expect(styled.chunks[1].fg).toBeUndefined();
  });

  test('returns StyledText with empty chunks array for empty string', () => {
    const styled = ansiToStyledText('');
    expect(styled).toBeDefined();
    expect(Array.isArray(styled.chunks)).toBe(true);
    expect(styled.chunks.length).toBe(0);
  });

  test('strips ANSI codes from output chunk text', () => {
    const styled = ansiToStyledText('\x1b[1mHello\x1b[0m');
    const plain = styled.chunks.map((c) => c.text).join('');
    expect(plain).not.toContain('\x1b');
    expect(plain).toBe('Hello');
  });

  test('handles sequential codes without intermixed text', () => {
    const styled = ansiToStyledText('\x1b[1m\x1b[34mBlue bold\x1b[0m');
    expect(styled.chunks.length).toBe(1);
    expect(styled.chunks[0].text).toBe('Blue bold');
    expect(styled.chunks[0].fg).toBeDefined();
    expect(styled.chunks[0].attributes).toBeDefined();
  });

  test('\\x1b[22m clears bold and dim without affecting color', () => {
    const styled = ansiToStyledText('\x1b[1;34mBold blue\x1b[22mNot bold but blue\x1b[0m');
    // After [22m, bold is cleared but blue fg persists
    expect(styled.chunks.length).toBe(2);
    expect(styled.chunks[0].text).toBe('Bold blue');
    expect(styled.chunks[0].attributes! & (1 << 0)).not.toBe(0);
    expect(styled.chunks[1].text).toBe('Not bold but blue');
    expect(styled.chunks[1].attributes).toBeUndefined();
    expect(styled.chunks[1].fg).toBeDefined();
  });
});
