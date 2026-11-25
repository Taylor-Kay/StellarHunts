/**
 * Types for the Game Progress Roadmap component (Issue #910).
 *
 * Modelled after the existing roadmap data shape in
 * frontend/components/puzzles/roadmap/puzzleRoadmapData.ts
 * and frontend/hooks/useRoadmap.js.
 */

export type NodeStatus = 'completed' | 'current' | 'locked';

export interface RoadmapNode {
  /** Unique puzzle identifier */
  id: string;
  /** Display title */
  title: string;
  /** Short description shown in the tooltip / card */
  description?: string;
  /** Completion / accessibility status */
  status: NodeStatus;
  /** IDs of nodes that this node depends on (must be completed first) */
  dependsOn?: string[];
  /** Category or chapter this node belongs to */
  category?: string;
  /** Difficulty label shown below the node */
  difficulty?: 'easy' | 'medium' | 'hard' | 'master';
  /** URL to the puzzle page */
  href?: string;
  /** Column position in the visual grid (0-based) */
  column?: number;
  /** Row position in the visual grid (0-based) */
  row?: number;
}

export interface GameProgressRoadmapProps {
  /** All roadmap nodes to render */
  nodes: RoadmapNode[];
  /**
   * Called when the user clicks a completed node.
   * The node id is passed as argument.
   */
  onRevisit?: (nodeId: string) => void;
  /**
   * Called when the user clicks the current (active) node.
   * The node id is passed as argument.
   */
  onStart?: (nodeId: string) => void;
  /** Extra className applied to the root container */
  className?: string;
}
