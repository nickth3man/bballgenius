import { isNoColor } from './theme.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

export function markdownToAnsi(text: string): string {
  if (text === '') return '';

  const plain = isNoColor();
  const wrap = (open: string, content: string): string =>
    plain ? content : `${open}${content}${RESET}`;

  const placeholders: string[] = [];
  const placeholder = (s: string): string => {
    const i = placeholders.length;
    placeholders.push(s);
    return `\x00P${i}\x00`;
  };

  let result = text;

  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    return placeholder(wrap(CYAN, inner));
  });

  result = result.replace(/`([^`]+)`/g, (_, code: string) => wrap(CYAN, code));

  result = result.replace(/\*\*([^*]+)\*\*/g, (_, content: string) => wrap(BOLD, content));

  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, content: string) => wrap(BOLD, content));

  result = result.replace(
    /^(\s*)[-*]\s+(.+)$/gm,
    (_, indent: string, content: string) => `${indent}\u2022 ${content}`,
  );

  result = result.replace(/^>\s?(.+)$/gm, (_, content: string) => wrap(DIM, `\u2502 ${content}`));

  result = result.replace(/\*([^*]+)\*/g, (_, content: string) => wrap(DIM, content));

  result = result.replace(/\x00P(\d+)\x00/g, (_, idx: string) => placeholders[Number(idx)] ?? '');

  return result;
}
