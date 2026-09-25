"use client";

import { Play, Trash2 } from "lucide-react";
import type { Recipe } from "@/lib/recipes";

export default function Recipes({ recipes, onRun, onDelete }: { recipes: Recipe[]; onRun: (r: Recipe) => void; onDelete: (r: Recipe) => void }) {
  return (
    <div id="recipes" popover="auto" className="pop">
      <h2>Saved recipes</h2>
      <p className="sub">A recipe remembers the page, the list, your columns, and how much to take. Running one scans the page fresh.</p>
      {recipes.length === 0 ? (
        <p className="note">Nothing saved yet. Set up an export, then choose <b>Save recipe</b>.</p>
      ) : (
        recipes.map((r) => (
          <div className="recipe" key={r.id}>
            <div style={{ minWidth: 0 }}>
              <b>{r.name}</b>
              <span className="num">{new URL(r.url).host} · {r.columns.filter((c) => c.on).length} columns · {r.format.toUpperCase()}</span>
            </div>
            <div className="actions">
              <button className="btn btn-quiet btn-sm" onClick={() => onRun(r)}><Play size={13} aria-hidden="true" />Run</button>
              <button className="iconbtn" onClick={() => onDelete(r)} aria-label={`Delete ${r.name}`}><Trash2 size={15} /></button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
