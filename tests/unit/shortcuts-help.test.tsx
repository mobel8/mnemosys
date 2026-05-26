/**
 * Smoke tests for the global shortcuts dialog and error boundary.
 *
 * These guard against the most obvious regressions: the dialog rendering
 * with key bindings, and the boundary swallowing render errors into a
 * friendly fallback rather than a blank screen.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";

describe("ShortcutsHelpDialog", () => {
  it("renders nothing when closed", () => {
    render(<ShortcutsHelpDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("Raccourcis clavier")).toBeNull();
  });

  it("lists at least one shortcut per category when open", () => {
    render(<ShortcutsHelpDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByText("Raccourcis clavier")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Session de révision")).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
    // `?` is shown both in the cheat-sheet body and in the dialog
    // metadata, so it appears more than once — checking >=1 is enough.
    expect(screen.getAllByText("?").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ErrorBoundary", () => {
  function Boom(): ReactNode {
    throw new Error("kaboom");
  }

  it("renders the fallback when a child throws", () => {
    // Silence the predictable React error log so the test output stays clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /réessayer/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <span data-testid="ok">hello</span>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toHaveTextContent("hello");
  });

  it("resets via the retry button", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let throwIt = true;
    function MaybeBoom() {
      if (throwIt) throw new Error("transient");
      return <span data-testid="ok">recovered</span>;
    }
    render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
    throwIt = false;
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(screen.getByTestId("ok")).toHaveTextContent("recovered");
    spy.mockRestore();
  });
});
