export interface AppKeyEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

export interface FrameworkKeyEventLike {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  stopPropagation?: () => void;
  preventDefault?: () => void;
}

export function toAppKeyEvent(event: FrameworkKeyEventLike): AppKeyEvent {
  return {
    name: event.name ?? '',
    sequence: event.sequence ?? event.name ?? '',
    ctrl: event.ctrl ?? false,
    shift: event.shift ?? false,
    stopPropagation: event.stopPropagation ?? (() => {}),
    preventDefault: event.preventDefault ?? (() => {}),
  };
}
