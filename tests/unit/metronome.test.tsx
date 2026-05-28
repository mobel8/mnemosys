/**
 * Tests for the Metronome (Vague 16 — Mode Musique).
 *
 * Targets:
 *  - the control renders with the default tempo + beat dots
 *  - the start/stop button toggles between "Démarrer" and "Stop"
 *
 * The Web-Audio AudioContext is stubbed globally in `tests/setup.ts`, so the
 * component can start its scheduler without a real audio backend.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Metronome } from "@/components/music/Metronome";

afterEach(() => {
  vi.useRealTimers();
});

describe("Metronome", () => {
  it("renders the default tempo and one dot per beat (4/4)", () => {
    render(<Metronome />);
    expect(screen.getByTestId("metronome")).toBeInTheDocument();
    expect(screen.getByTestId("bpm-value")).toHaveTextContent("100");
    // Default signature 4/4 → beats 0..3 are rendered.
    expect(screen.getByTestId("beat-dot-0")).toBeInTheDocument();
    expect(screen.getByTestId("beat-dot-3")).toBeInTheDocument();
    expect(screen.queryByTestId("beat-dot-4")).toBeNull();
    expect(screen.getByTestId("metronome-toggle")).toHaveTextContent(/Démarrer/i);
  });

  it("toggles between start and stop when the button is pressed", () => {
    vi.useFakeTimers();
    render(<Metronome />);
    const toggle = screen.getByTestId("metronome-toggle");

    expect(toggle).toHaveTextContent(/Démarrer/i);
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent(/Stop/i);

    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent(/Démarrer/i);
  });
});
