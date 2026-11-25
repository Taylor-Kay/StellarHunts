"use client";

import React, { useMemo } from "react";
import type { RoadmapNode, GameProgressRoadmapProps, NodeStatus } from "./GameProgressRoadmap.types";

// ── Icon helpers ──────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-5 h-5"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-5 h-5"
    >
      <rect x={3} y={11} width={18} height={11} rx={2} ry={2} />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-5 h-5"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

// ── Status-based visual config ────────────────────────────────────────────────

interface StatusConfig {
  ring: string;
  bg: string;
  text: string;
  label: string;
  icon: React.ReactNode;
  glowClass: string;
}

const STATUS_CONFIG: Record<NodeStatus, StatusConfig> = {
  completed: {
    ring: "ring-2 ring-emerald-400",
    bg: "bg-emerald-500",
    text: "text-white",
    label: "Completed",
    icon: <CheckIcon />,
    glowClass: "",
  },
  current: {
    ring: "ring-4 ring-indigo-400 ring-offset-2 ring-offset-gray-900",
    bg: "bg-indigo-600",
    text: "text-white",
    label: "Current",
    icon: <StarIcon />,
    glowClass: "animate-pulse shadow-[0_0_20px_4px_rgba(99,102,241,0.6)]",
  },
  locked: {
    ring: "ring-2 ring-gray-600",
    bg: "bg-gray-700",
    text: "text-gray-400",
    label: "Locked",
    icon: <LockIcon />,
    glowClass: "",
  },
};

// ── Difficulty badge ───────────────────────────────────────────────────────────

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-700 text-green-200",
  medium: "bg-yellow-700 text-yellow-200",
  hard: "bg-red-800 text-red-200",
  master: "bg-purple-800 text-purple-200",
};

function DifficultyBadge({ difficulty }: { difficulty?: string }) {
  if (!difficulty) return null;
  const cls = DIFFICULTY_COLORS[difficulty] ?? "bg-gray-600 text-gray-200";
  return (
    <span className={`mt-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {difficulty}
    </span>
  );
}

// ── Single roadmap node ───────────────────────────────────────────────────────

interface RoadmapNodeProps {
  node: RoadmapNode;
  onRevisit?: (id: string) => void;
  onStart?: (id: string) => void;
}

function RoadmapNodeItem({ node, onRevisit, onStart }: RoadmapNodeProps) {
  const cfg = STATUS_CONFIG[node.status];
  const isClickable = node.status === "completed" || node.status === "current";

  function handleClick() {
    if (node.status === "completed") onRevisit?.(node.id);
    else if (node.status === "current") onStart?.(node.id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isClickable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <div className="flex flex-col items-center gap-1 w-24 md:w-28">
      {/* Circle node */}
      <button
        type="button"
        disabled={!isClickable}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={`${node.title} – ${cfg.label}`}
        title={node.description ?? node.title}
        className={[
          "relative flex items-center justify-center w-14 h-14 rounded-full",
          "transition-transform duration-200",
          cfg.ring,
          cfg.bg,
          cfg.text,
          cfg.glowClass,
          isClickable
            ? "cursor-pointer hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            : "cursor-not-allowed opacity-60",
        ].join(" ")}
      >
        {cfg.icon}
      </button>

      {/* Title */}
      <span className="text-xs font-semibold text-center text-gray-200 leading-tight max-w-[6rem] line-clamp-2">
        {node.title}
      </span>

      {/* Difficulty badge */}
      <DifficultyBadge difficulty={node.difficulty} />
    </div>
  );
}

// ── SVG dependency paths ──────────────────────────────────────────────────────

/**
 * Layout constants – must match the CSS widths above.
 * NODE_W: horizontal space allocated per node (px)
 * NODE_H: vertical space allocated per node (px)
 * CIRCLE_R: radius of the circle node (px)
 */
const NODE_W = 112; // w-28 = 7rem = 112px
const NODE_H = 110;
const CIRCLE_R = 28; // half of h-14

interface PathsProps {
  nodes: RoadmapNode[];
  nodeMap: Map<string, { col: number; row: number }>;
}

function DependencyPaths({ nodes, nodeMap }: PathsProps) {
  const paths = useMemo(() => {
    const lines: { key: string; d: string; status: NodeStatus }[] = [];

    for (const node of nodes) {
      if (!node.dependsOn?.length) continue;
      const to = nodeMap.get(node.id);
      if (!to) continue;

      for (const depId of node.dependsOn) {
        const from = nodeMap.get(depId);
        if (!from) continue;

        const x1 = from.col * NODE_W + CIRCLE_R;
        const y1 = from.row * NODE_H + CIRCLE_R;
        const x2 = to.col * NODE_W + CIRCLE_R;
        const y2 = to.row * NODE_H + CIRCLE_R;

        // Cubic bezier for a smooth curve
        const mx = (x1 + x2) / 2;
        const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;

        const depNode = nodes.find((n) => n.id === depId);
        lines.push({
          key: `${depId}->${node.id}`,
          d,
          status: depNode?.status ?? "locked",
        });
      }
    }

    return lines;
  }, [nodes, nodeMap]);

  if (!paths.length) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {paths.map(({ key, d, status }) => (
        <path
          key={key}
          d={d}
          fill="none"
          strokeWidth={3}
          strokeDasharray={status === "locked" ? "6 4" : undefined}
          className={
            status === "completed"
              ? "stroke-emerald-500"
              : status === "current"
              ? "stroke-indigo-400"
              : "stroke-gray-600"
          }
        />
      ))}
    </svg>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

/**
 * GameProgressRoadmap
 *
 * Renders a visual node graph showing puzzle progression paths.
 *
 * - Completed nodes → green with a checkmark; clicking calls `onRevisit`.
 * - Current node    → indigo with a pulsing glow; clicking calls `onStart`.
 * - Locked nodes    → grey with a lock icon; not interactive.
 * - Dependency edges are drawn as SVG cubic-bezier curves (dashed when locked).
 * - Collapses to a vertical list on mobile screens.
 *
 * Layout is determined by the optional `column`/`row` fields on each node.
 * When those are absent the nodes are placed in a single row in order.
 */
export default function GameProgressRoadmap({
  nodes,
  onRevisit,
  onStart,
  className = "",
}: GameProgressRoadmapProps) {
  // Build a position map for SVG path calculations
  const nodeMap = useMemo<Map<string, { col: number; row: number }>>(() => {
    const map = new Map<string, { col: number; row: number }>();
    nodes.forEach((node, i) => {
      map.set(node.id, {
        col: node.column ?? i,
        row: node.row ?? 0,
      });
    });
    return map;
  }, [nodes]);

  const maxCol = useMemo(
    () => Math.max(0, ...nodes.map((n, i) => n.column ?? i)),
    [nodes],
  );
  const maxRow = useMemo(
    () => Math.max(0, ...nodes.map((n) => n.row ?? 0)),
    [nodes],
  );

  const svgWidth = (maxCol + 1) * NODE_W;
  const svgHeight = (maxRow + 1) * NODE_H;

  if (!nodes.length) {
    return (
      <div className={`text-gray-400 text-center py-10 ${className}`}>
        No puzzles in the roadmap yet.
      </div>
    );
  }

  return (
    <section
      aria-label="Game Progress Roadmap"
      className={`w-full overflow-x-auto ${className}`}
    >
      {/* ── Desktop grid (SVG + absolutely positioned nodes) ── */}
      <div
        className="hidden md:block relative"
        style={{ width: svgWidth, height: svgHeight }}
      >
        <DependencyPaths nodes={nodes} nodeMap={nodeMap} />

        {nodes.map((node) => {
          const pos = nodeMap.get(node.id)!;
          return (
            <div
              key={node.id}
              className="absolute flex flex-col items-center"
              style={{
                left: pos.col * NODE_W,
                top: pos.row * NODE_H,
                width: NODE_W,
              }}
            >
              <RoadmapNodeItem
                node={node}
                onRevisit={onRevisit}
                onStart={onStart}
              />
            </div>
          );
        })}
      </div>

      {/* ── Mobile list (vertical, no SVG paths) ── */}
      <ol className="flex flex-col gap-4 md:hidden px-4 py-2" aria-label="Puzzle progression list">
        {nodes.map((node, idx) => {
          const cfg = STATUS_CONFIG[node.status];
          const isClickable = node.status === "completed" || node.status === "current";

          return (
            <li key={node.id} className="flex items-center gap-4">
              {/* Step number / icon circle */}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => {
                  if (node.status === "completed") onRevisit?.(node.id);
                  else if (node.status === "current") onStart?.(node.id);
                }}
                aria-label={`${node.title} – ${cfg.label}`}
                className={[
                  "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full",
                  cfg.ring,
                  cfg.bg,
                  cfg.text,
                  cfg.glowClass,
                  isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                ].join(" ")}
              >
                {cfg.icon}
              </button>

              {/* Text */}
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-gray-100 truncate">
                  {node.title}
                </span>
                {node.description && (
                  <span className="text-xs text-gray-400 truncate">{node.description}</span>
                )}
                <DifficultyBadge difficulty={node.difficulty} />
              </div>

              {/* Connecting line to next node */}
              {idx < nodes.length - 1 && (
                <div
                  aria-hidden="true"
                  className="ml-5 absolute left-9 w-0.5 bg-gray-700"
                  style={{ top: "2.5rem", height: "1.5rem" }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
