/**
 * Everything that changes while the user marks up a page, as one reducer.
 * Iframe messages arrive asynchronously; routing them through a reducer means
 * they always act on current state, never on a stale closure.
 */
import {
  addFeedColumn, addPageColumn, openFeedWorkspace, openWorkspace,
  type Feed, type FeedField, type PageColumn, type PageList, type Workspace,
} from "./model";
import type { RecipeColumn } from "./recipes";

export interface NextControl { selector: string; kind: "next" | "more"; label: string }

export interface State {
  feeds: Feed[];
  lists: PageList[];
  next: NextControl | null;
  ws: Record<string, Workspace>;
  active: string | null;
  fresh: string | null; // page key of the column just inked, for the swipe
}

export const initial: State = { feeds: [], lists: [], next: null, ws: {}, active: null, fresh: null };

export type Action =
  | { type: "scanned"; feeds: Feed[] }
  | { type: "ready"; lists: PageList[]; next: NextControl | null; prefer?: { itemSelector?: string; columns?: RecipeColumn[]; feedEndpoint?: string } }
  | { type: "pick"; listId: string; created?: PageList | null; column?: PageColumn; remove?: string }
  | { type: "activate"; id: string }
  | { type: "toggle"; id: string }
  | { type: "rename"; id: string; name: string }
  | { type: "move"; id: string; to: number }
  | { type: "addFeedField"; field: FeedField }
  | { type: "reset" };

function workspaceFor(s: State, id: string): Workspace | undefined {
  if (s.ws[id]) return s.ws[id];
  if (id.startsWith("feed:")) {
    const feed = s.feeds.find((f) => `feed:${f.id}` === id);
    return feed ? openFeedWorkspace(feed) : undefined;
  }
  const list = s.lists.find((l) => l.id === id);
  return list ? openWorkspace(list, s.feeds) : undefined;
}

function updateActive(s: State, fn: (ws: Workspace) => Workspace): State {
  if (!s.active || !s.ws[s.active]) return s;
  return { ...s, ws: { ...s.ws, [s.active]: fn(s.ws[s.active]) }, fresh: null };
}

/** Re-apply a saved recipe's columns onto a freshly opened workspace. */
function applyRecipe(ws: Workspace, cols: RecipeColumn[]): Workspace {
  const used = new Set<string>();
  const out = cols.map((rc) => {
    const hit = ws.columns.find((c) => !used.has(c.id) && ((rc.sel != null && c.page?.sel === rc.sel && c.page?.attr === rc.attr) || (!rc.sel && rc.feedKey && c.feedKey === rc.feedKey)));
    if (hit) {
      used.add(hit.id);
      return { ...hit, name: rc.name, on: rc.on };
    }
    return null;
  }).filter(Boolean) as Workspace["columns"];
  const rest = ws.columns.filter((c) => !used.has(c.id)).map((c) => ({ ...c, on: false }));
  return out.length ? { ...ws, columns: [...out, ...rest] } : ws;
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "reset":
      return initial;
    case "scanned":
      return { ...initial, feeds: a.feeds };
    case "ready": {
      const lists = a.lists;
      let active: string | null = null;
      const ws: Record<string, Workspace> = {};
      const pinned = a.prefer?.itemSelector ? lists.find((l) => l.itemSelector === a.prefer!.itemSelector) : undefined;
      const first = pinned ?? lists[0];
      if (first) {
        let w = openWorkspace(first, s.feeds);
        if (a.prefer?.columns?.length && pinned) w = applyRecipe(w, a.prefer.columns);
        ws[first.id] = w;
        active = first.id;
      } else {
        const feed = s.feeds.find((f) => a.prefer?.feedEndpoint && f.endpoint === a.prefer.feedEndpoint) ?? bestFeed(s.feeds);
        if (feed) {
          const id = `feed:${feed.id}`;
          let w = openFeedWorkspace(feed);
          if (a.prefer?.columns?.length) w = applyRecipe(w, a.prefer.columns);
          ws[id] = w;
          active = id;
        }
      }
      return { ...s, lists, next: a.next, ws, active, fresh: null };
    }
    case "activate": {
      const w = workspaceFor(s, a.id);
      if (!w) return s;
      return { ...s, ws: { ...s.ws, [a.id]: w }, active: a.id, fresh: null };
    }
    case "pick": {
      const lists = a.created && !s.lists.some((l) => l.id === a.created!.id) ? [...s.lists, a.created] : s.lists;
      const list = lists.find((l) => l.id === a.listId);
      if (!list) return s;
      const base = s.ws[list.id] ?? openWorkspace(list, s.feeds);
      if (a.remove) {
        const w = { ...base, columns: base.columns.map((c) => (c.page?.key === a.remove ? { ...c, on: false } : c)) };
        return { ...s, lists, ws: { ...s.ws, [list.id]: w }, active: list.id, fresh: null };
      }
      if (!a.column) return s;
      // A list the user just created by clicking starts with only what they clicked.
      const start = a.created ? { ...base, columns: [] } : base;
      const w = addPageColumn(start, list, a.column, s.feeds);
      return { ...s, lists, ws: { ...s.ws, [list.id]: w }, active: list.id, fresh: a.column.key };
    }
    case "toggle":
      return updateActive(s, (w) => ({ ...w, columns: w.columns.map((c) => (c.id === a.id ? { ...c, on: !c.on } : c)) }));
    case "rename":
      return updateActive(s, (w) => ({ ...w, columns: w.columns.map((c) => (c.id === a.id ? { ...c, name: a.name.slice(0, 80) } : c)) }));
    case "move":
      return updateActive(s, (w) => {
        const cols = [...w.columns];
        const from = cols.findIndex((c) => c.id === a.id);
        if (from < 0) return w;
        const [c] = cols.splice(from, 1);
        cols.splice(Math.max(0, Math.min(cols.length, a.to)), 0, c);
        return { ...w, columns: cols };
      });
    case "addFeedField":
      return updateActive(s, (w) => addFeedColumn(w, a.field));
  }
}

/** The feed most likely to be the page's main dataset when nothing on screen matched. */
export function bestFeed(feeds: Feed[]): Feed | undefined {
  return [...feeds]
    .filter((f) => f.fields.some((x) => !x.plumbing && x.fill > 0.3) && f.rows.length >= 3)
    .sort((a, b) => (b.total ?? b.rows.length) - (a.total ?? a.rows.length) || Number(b.paginated) - Number(a.paginated))[0];
}

/** Feeds not joined to any page list: shown as "other data behind the page". */
export function unmatchedFeeds(s: State): Feed[] {
  const matched = new Set(Object.values(s.ws).map((w) => w.feedId).filter(Boolean));
  return s.feeds.filter((f) => !matched.has(f.id) && f.rows.length >= 3 && f.fields.filter((x) => !x.plumbing && x.fill > 0.3).length >= 2);
}
