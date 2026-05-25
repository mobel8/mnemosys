import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "@/App";
import { cn } from "@/lib/utils";

describe("scaffold smoke test", () => {
  it("renders the Mnemosys placeholder", () => {
    render(<App />);
    expect(screen.getByText("Mnemosys")).toBeInTheDocument();
  });

  it("merges tailwind classes via cn()", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});
