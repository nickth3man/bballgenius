import type { AppShell, AppShellTab } from '../../core/appShell.js';
import { getTabById } from '../../tabs/registry.js';

/** Resolves a tab by stable id (preferred over numeric index in tests). */
export function getTab<T extends AppShellTab = AppShellTab>(shell: AppShell, id: string): T {
  const tab = shell.getTabById(id) ?? getTabById(shell.tabs, id);
  if (!tab) {
    throw new Error(`Tab not found: ${id}`);
  }
  return tab as T;
}
