/**
 * Service for interacting with the puzzle-categories API.
 * Mirrors the pattern used in existing service files under frontend/services/.
 */

const BASE_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  'http://localhost:3000';

const puzzleCategoryService = {
  /**
   * Fetch all categories with puzzle counts and difficulty distributions.
   * @returns {Promise<{ success: boolean, data: object[], message?: string }>}
   */
  async getCategories() {
    const response = await fetch(
      `${BASE_URL}/puzzle-categories/categories`,
      { credentials: 'include' },
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, message: json.message || 'Failed to fetch categories' };
    }
    return { success: true, data: json };
  },

  /**
   * Fetch a single category by ID, including its puzzles.
   * @param {string} id
   */
  async getCategoryById(id) {
    const response = await fetch(
      `${BASE_URL}/puzzle-categories/categories/${id}`,
      { credentials: 'include' },
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, message: json.message || 'Failed to fetch category' };
    }
    return { success: true, data: json };
  },
};

export default puzzleCategoryService;
