import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import GameProgressRoadmap from "./GameProgressRoadmap";
import type { RoadmapNode } from "./GameProgressRoadmap.types";

const nodes: RoadmapNode[] = [
  {
    id: "p1",
    title: "Intro to Stellar",
    description: "Learn the basics",
    status: "completed",
    difficulty: "easy",
    column: 0,
    row: 0,
  },
  {
    id: "p2",
    title: "Account Setup",
    description: "Create your first account",
    status: "current",
    difficulty: "easy",
    dependsOn: ["p1"],
    column: 1,
    row: 0,
  },
  {
    id: "p3",
    title: "Transactions",
    description: "Send XLM",
    status: "locked",
    difficulty: "medium",
    dependsOn: ["p2"],
    column: 2,
    row: 0,
  },
];

describe("GameProgressRoadmap", () => {
  it("renders all node titles", () => {
    render(<GameProgressRoadmap nodes={nodes} />);
    expect(screen.getAllByText("Intro to Stellar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Account Setup").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Transactions").length).toBeGreaterThan(0);
  });

  it("shows empty state when no nodes are provided", () => {
    render(<GameProgressRoadmap nodes={[]} />);
    expect(screen.getByText(/no puzzles in the roadmap/i)).toBeInTheDocument();
  });

  it("calls onRevisit when a completed node is clicked", () => {
    const onRevisit = jest.fn();
    render(<GameProgressRoadmap nodes={nodes} onRevisit={onRevisit} />);
    const completedBtn = screen.getAllByRole("button", { name: /Intro to Stellar – Completed/i })[0];
    fireEvent.click(completedBtn);
    expect(onRevisit).toHaveBeenCalledWith("p1");
  });

  it("calls onStart when the current node is clicked", () => {
    const onStart = jest.fn();
    render(<GameProgressRoadmap nodes={nodes} onStart={onStart} />);
    const currentBtn = screen.getAllByRole("button", { name: /Account Setup – Current/i })[0];
    fireEvent.click(currentBtn);
    expect(onStart).toHaveBeenCalledWith("p2");
  });

  it("locked nodes are disabled (not clickable)", () => {
    const onRevisit = jest.fn();
    const onStart = jest.fn();
    render(<GameProgressRoadmap nodes={nodes} onRevisit={onRevisit} onStart={onStart} />);
    const lockedBtn = screen.getAllByRole("button", { name: /Transactions – Locked/i })[0];
    expect(lockedBtn).toBeDisabled();
    fireEvent.click(lockedBtn);
    expect(onRevisit).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("completed node has aria-label indicating Completed", () => {
    render(<GameProgressRoadmap nodes={nodes} />);
    expect(
      screen.getAllByRole("button", { name: /Intro to Stellar – Completed/i }).length,
    ).toBeGreaterThan(0);
  });

  it("current node has aria-label indicating Current", () => {
    render(<GameProgressRoadmap nodes={nodes} />);
    expect(
      screen.getAllByRole("button", { name: /Account Setup – Current/i }).length,
    ).toBeGreaterThan(0);
  });

  it("renders difficulty badges", () => {
    render(<GameProgressRoadmap nodes={nodes} />);
    // Multiple 'easy' badges (desktop + mobile)
    const easyBadges = screen.getAllByText("easy");
    expect(easyBadges.length).toBeGreaterThan(0);
  });

  it("applies custom className to the root element", () => {
    const { container } = render(
      <GameProgressRoadmap nodes={nodes} className="my-custom-class" />,
    );
    expect(container.firstChild).toHaveClass("my-custom-class");
  });
});
