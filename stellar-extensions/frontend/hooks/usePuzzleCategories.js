/**
 * Issue #924 – usePuzzleCategories
 *
 * Fetches all puzzle categories with counts and difficulty distributions,
 * caching results for fast navigation (5-minute TTL).
 *
 * Follows the patterns in:
 *   - frontend/hooks/usePuzzleReviews.js
 *   - frontend/hooks/useReferral.js
 *   - backend/src/puzzle-category/
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import puzzleCategoryService from '../services/puzzleCategoryService';

// ---------------------------------------------------------------------------
// TypeScript-style JSDoc types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DifficultyDistribution
 * @property {number} BEGINNER
 * @property {number} INTERMEDIATE
 * @property {number} ADVANCED
 * @property {number} EXPERT
 */

/**
 * @typedef {Object} PuzzleSummary
 * @property {string}  id
 * @property {string}  title
 * @property {string}  description
 * @property {string}  difficulty
 * @property {number}  points
 * @property {boolean} isActive
 * @property {number}  estimatedTime
 */

/**
 * @typedef {Object} PuzzleCategory
 * @property {string}                id
 * @property {string}                name
 * @property {string}                description
 * @property {string}                slug
 * @property {string}                icon
 * @property {string}                color
 * @property {number}                sortOrder
 * @property {PuzzleSummary[]}       puzzles
 * @property {number}                puzzleCount
 * @property {DifficultyDistribution} difficultyDistribution
 */

// ---------------------------------------------------------------------------
// Cache (module-level so it persists across re-renders / component remounts)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** @type {{ data: PuzzleCategory[] | null, fetchedAt: number }} */
const _cache = { data: null, fetchedAt: 0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the difficulty distribution for a list of puzzles.
 * @param {PuzzleSummary[]} puzzles
 * @returns {DifficultyDistribution}
 */
function computeDifficultyDistribution(puzzles) {
  const dist = { BEGINNER: 0, INTERMEDIATE: 0, ADVANCED: 0, EXPERT: 0 };
  for (const p of puzzles) {
    const key = p.difficulty?.toUpperCase();
    if (key in dist) dist[key] += 1;
  }
  return dist;
}

/**
 * Enrich raw API category objects with computed fields.
 * @param {object[]} raw
 * @returns {PuzzleCategory[]}
 */
function enrichCategories(raw) {
  return raw.map((cat) => {
    const puzzles = Array.isArray(cat.puzzles) ? cat.puzzles : [];
    return {
      ...cat,
      puzzles,
      puzzleCount: cat.puzzleCount ?? puzzles.length,
      difficultyDistribution: computeDifficultyDistribution(puzzles),
    };
  });
}

function isCacheValid() {
  return _cache.data !== null && Date.now() - _cache.fetchedAt < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches and caches puzzle categories with counts and difficulty distributions.
 *
 * @returns {{
 *   categories: PuzzleCategory[],
 *   loading: boolean,
 *   error: string | null,
 *   refresh: () => Promise<void>,
 *   getCategoryById: (id: string) => PuzzleCategory | undefined,
 *   getCategoryBySlug: (slug: string) => PuzzleCategory | undefined,
 * }}
 */
export const usePuzzleCategories = () => {
  const [categories, setCategories] = useState(
    () => enrichCategories(_cache.data ?? []),
  );
  const [loading, setLoading] = useState(!isCacheValid());
  const [error, setError] = useState(null);

  // Track whether the component is still mounted to avoid state updates after
  // unmount (mirrors the pattern in usePuzzleReviews.js).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchCategories = useCallback(async ({ force = false } = {}) => {
    if (!force && isCacheValid()) {
      setCategories(enrichCategories(_cache.data));
      setLoading(false);
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await puzzleCategoryService.getCategories();

      if (!mountedRef.current) return;

      if (response.success) {
        const enriched = enrichCategories(response.data);
        _cache.data = response.data;
        _cache.fetchedAt = Date.now();
        setCategories(enriched);
      } else {
        setError(response.message || 'Failed to fetch categories');
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || 'An error occurred while fetching categories');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch on mount (honours cache).
  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  /**
   * Force a fresh fetch, bypassing the cache.
   */
  const refresh = useCallback(() => fetchCategories({ force: true }), [fetchCategories]);

  /**
   * Look up a category from the already-loaded list by ID (no extra request).
   * @param {string} id
   * @returns {PuzzleCategory | undefined}
   */
  const getCategoryById = useCallback(
    (id) => categories.find((c) => c.id === id),
    [categories],
  );

  /**
   * Look up a category from the already-loaded list by slug (no extra request).
   * @param {string} slug
   * @returns {PuzzleCategory | undefined}
   */
  const getCategoryBySlug = useCallback(
    (slug) => categories.find((c) => c.slug === slug),
    [categories],
  );

  return {
    categories,
    loading,
    error,
    refresh,
    getCategoryById,
    getCategoryBySlug,
  };
};
