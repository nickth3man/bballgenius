/** OpenTUI stdin parser buffers bare ESC (20ms) before emitting escape. */
export async function pressEscapeAndFlush(virtualUI: {
  mockInput: { pressEscape: () => void };
  renderOnce: () => Promise<void>;
}): Promise<void> {
  virtualUI.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await virtualUI.renderOnce();
}

/** Allow async tab DB callbacks to finish before destroying renderer. */
export async function settleAsyncTabWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
