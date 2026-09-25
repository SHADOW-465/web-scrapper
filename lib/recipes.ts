/**
 * Saved recipes: everything needed to redo an extraction later.
 *
 * Stored in this browser for now (no accounts yet). A recipe never contains a
 * pasted cookie or a sealed feed token; it holds only how to find the data
 * again, so re-running always starts from a fresh scan.
 */
import type { Format } from "./exporters";

export interface RecipeColumn { name: string; sel?: string; attr?: string; multi?: boolean; feedKey?: string; on: boolean }

export interface Recipe {
  id: string;
  name: string;
  url: string;
  savedAt: number;
  itemSelector?: string;
  feed?: { endpoint: string; jsonPath: string };
  columns: RecipeColumn[];
  scope: "page" | "feed" | "crawl";
  crawl?: { mode: "next" | "more" | "scroll"; maxPages: number };
  format: Format;
}

const KEY = "scrape-studio.recipes.v1";

export function loadRecipes(): Recipe[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Recipe[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

export function saveRecipe(r: Recipe): Recipe[] {
  const list = loadRecipes().filter((x) => x.id !== r.id && x.name !== r.name);
  list.unshift(r);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* storage full or blocked: the recipe simply isn't kept */
  }
  return list;
}

export function deleteRecipe(id: string): Recipe[] {
  const list = loadRecipes().filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
