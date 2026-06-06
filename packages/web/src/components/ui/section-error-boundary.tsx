import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

interface SectionErrorBoundaryProps {
  children: ReactNode;
  sectionName: string;
}

interface SectionErrorBoundaryState {
  error: Error | null;
}

export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  override state: SectionErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[time-machine] ${this.props.sectionName} section failed:`, error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded border border-danger/20 bg-danger/5 p-3 text-xs text-danger/80">
          {this.props.sectionName} data unavailable for this player.
        </div>
      );
    }
    return this.props.children;
  }
}
