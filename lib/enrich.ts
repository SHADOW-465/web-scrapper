/**
 * Subpage / detail-page enrichment for directories where person/team-level
 * data lives on individual profile pages (e.g. Frankfurt Buchmesse).
 */

export interface TeamMember {
  name: string;
  designation: string;
}

const cache = new Map<string, TeamMember[]>();

export async function fetchTeamMembers(slugOrUrl: string): Promise<TeamMember[]> {
  const clean = slugOrUrl.trim();
  if (!clean) return [];
  if (cache.has(clean)) return cache.get(clean)!;

  const url = clean.startsWith("http")
    ? clean
    : `https://event.buchmesse.de/exhibitor/${clean}`;

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      cache.set(clean, []);
      return [];
    }
    const html = await res.text();
    // Fast regex extraction from the rendered server markup
    const nameMatches = [...html.matchAll(/data-testid=["']teamMemberName["'][^>]*title=["']([^"']+)["']/g)].map((m) => m[1]);
    const posMatches = [...html.matchAll(/data-styleid=["']team-member-position["'][^>]*title=["']([^"']+)["']/g)].map((m) => m[1]);

    const members: TeamMember[] = [];
    const count = Math.max(nameMatches.length, posMatches.length);
    for (let i = 0; i < count; i++) {
      const name = nameMatches[i] || "";
      const designation = posMatches[i] || "";
      if (name || designation) {
        members.push({ name, designation });
      }
    }
    cache.set(clean, members);
    return members;
  } catch {
    cache.set(clean, []);
    return [];
  }
}

/**
 * Concurrently enrich a batch of rows with team members if requested.
 * If an exhibitor has multiple team members, it expands to 1 row per person
 * while keeping all company details (name, country, stand, hall).
 */
export async function enrichRowsWithTeam<T extends Record<string, unknown>>(
  rows: T[],
  options: { concurrency?: number } = {},
): Promise<T[]> {
  const concurrency = options.concurrency || 10;
  const enrichedRows: T[] = [];

  // Process in chunks to respect concurrency limit
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (row) => {
        const slug = String(row["url"] || row["profile_url"] || row["slug"] || "");
        if (!slug || (!slug.includes("exhibitor") && !/^[a-z0-9-]+$/i.test(slug))) {
          return [row];
        }

        const members = await fetchTeamMembers(slug);
        if (!members.length) {
          return [{
            ...row,
            person_name: row["person_name"] || "",
            designation: row["designation"] || "",
          }];
        }

        return members.map((m) => ({
          ...row,
          person_name: m.name,
          designation: m.designation,
        }));
      }),
    );

    for (const res of chunkResults) {
      enrichedRows.push(...res);
    }
  }

  return enrichedRows;
}
