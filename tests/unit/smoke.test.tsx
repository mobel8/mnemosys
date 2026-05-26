import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "@/App";
import { cn } from "@/lib/utils";

describe("scaffold smoke test", () => {
  it("renders the Mnemosys app shell", async () => {
    render(<App />);
    // The Sidebar brand label and the home page heading both contain the
    // text "Mnemosys"; the router resolves asynchronously so we wait until
    // at least one is mounted.
    await waitFor(() => {
      expect(screen.getAllByText("Mnemosys").length).toBeGreaterThan(0);
    });
  });

  it("merges tailwind classes via cn()", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});
