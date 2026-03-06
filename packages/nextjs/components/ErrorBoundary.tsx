"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="card-unlloo max-w-md text-center">
            <div className="text-error mb-4">
              <ExclamationTriangleIcon className="h-16 w-16 mx-auto" />
            </div>
            <h2 className="text-2xl font-bold text-base-content mb-2">Something went wrong</h2>
            <p className="text-base-content/60 mb-4">{this.state.error?.message || "An unexpected error occurred"}</p>
            <button onClick={this.handleReset} className="btn-unlloo">
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
