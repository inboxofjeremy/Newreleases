// /api/catalog.js
export const config = { runtime: "edge" };

/*
  Paginated TMDb → US release catalog for Stremio
  - 40 movies per Stremio page
  - Checks TMDb /movie/{id}/release_dates for US release
  - Stops as soon as it collected enough movies for requested page
  - Concurrency-limited release-date lookups to avoid timeouts
*/

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const PER_PAGE = 40;                // Stremio page size
const TMDB_DISCOVER_PAGE_SIZE = 20; // TMDb per-page
const MAX_DISCOVER_PAGES = 50;      // Safety cap to avoid infinite loops
const RELEASE_CONCURRENCY = 8;      // concurrent fetches for release_dates

// Dates in YYYY-MM-DD
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// CORS helper
function cors(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

// small helper for safe fetch & parse
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Fetch one TMDb discover page (no language/origin filters here so we maximize coverage)
async function fetchDiscoverPage(page = 1) {
  const url =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}` +
    `&sort_by=primary_release_date.desc` +
    `&primary_release_date.gte=${DATE_FROM}` +
    `&primary_release_date.lte=${DATE_TO}` +
    `&page=${page}`;
  return await fetchJSON(url);
}

// Return earliest US release date (YYYY-MM-DD) or null
async function fetchUSReleaseDate(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/release_dates?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  if (!json?.results) return null;

  const usEntry = json.results.find(r => r.iso_3166_1 === "US");
  if (!usEntry?.release_dates?.length) return null;

  // pick earliest date available in the US entry
  const earliest = usEntry.release_dates
    .map(x => x.release_date?.slice(0, 10))
    .filter(Boolean)
    .sort()[0];

  return earliest || null;
}

// Concurrency-limited mapper
async function pMap(list, mapper, concurrency = 6) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array(concurrency).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= list.length) break;
      try {
        out[idx] = await mapper(list[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Build enough valid movies to serve requested stremio page
// stremioPage: 1-based
async function buildPaginatedMovies(stremioPage = 1) {
  const needed = stremioPage * PER_PAGE; // we need this many valid items to know the requested page
  const seenIds = new Set();
  const validMovies = [];

  // iterate discover pages until we collected 'needed' valid movies or exhausted max pages
  for (let discoverPage = 1; discoverPage <= MAX_DISCOVER_PAGES; discoverPage++) {
    const pageJson = await fetchDiscoverPage(discoverPage);
    if (!pageJson?.results?.length) break;

    // dedupe and collect tmdb items
    const items = pageJson.results.filter(Boolean);

    // For the page results, produce release checks in batches
    // But we will only perform release checks for IDs we haven't seen and until we've satisfied 'needed'
    // Map returns objects or null
    const toProcess = [];
    for (const m of items) {
      if (!m?.id) continue;
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      toProcess.push(m);
    }

    if (!toProcess.length) {
      // continue to next discover page
      if (validMovies.length >= needed) break;
      continue;
    }

    // Run concurrent release date lookups for the batch (LIMIT concurrency)
    const processed = await pMap(
      toProcess,
      async (movie) => {
        const usDate = await fetchUSReleaseDate(movie.id);
        if (!usDate) return null;
        if (usDate < DATE_FROM || usDate > DATE_TO) return null;

        return {
          id: `tmdb:${movie.id}`,
          type: "movie",
          name: movie.title || movie.original_title || `Movie ${movie.id}`,
          description: movie.overview || "",
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
          releaseInfo: usDate
        };
      },
      RELEASE_CONCURRENCY
    );

    for (const m of processed) {
      if (m) validMovies.push(m);
    }

    // stop early if we have enough
    if (validMovies.length >= needed) break;
    // otherwise continue to next discover page
  }

  // return the slice for requested page
  const start = (stremioPage - 1) * PER_PAGE;
  return validMovies.slice(start, start + PER_PAGE);
}

// Edge handler
export default async function handler(req) {
  const u = new URL(req.url);
  const path = u.pathname;
  const params = u.searchParams;

  if (req.method === "OPTIONS") return cors({ ok: true });

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Movie Releases",
      description: `All movies released in the US in the last ${DAYS_BACK} days (paginated).`,
      resources: ["catalog", "meta"],
      types: ["movie"],
      catalogs: [
        {
          type: "movie",
          id: "recent_movies",
          name: "Recent US Releases",
          extra: [
            { name: "page", isRequired: false } // Stremio will pass page
          ]
        }
      ],
      idPrefixes: ["tmdb"]
    });
  }

  if (path === "/catalog/movie/recent_movies.json") {
    const page = Math.max(1, parseInt(params.get("page") || "1"));
    try {
      const metas = await buildPaginatedMovies(page);
      return cors({ metas });
    } catch (err) {
      return cors({ metas: [], error: err?.message || String(err) });
    }
  }

  // Simple meta endpoint: /meta/movie/tmdb:12345.json
  if (path.startsWith("/meta/movie/") && path.endsWith(".json")) {
    try {
      const idRaw = path.split("/").pop().replace(".json", "");
      const tmdbId = idRaw.startsWith("tmdb:") ? idRaw.split(":")[1] : idRaw;
      if (!tmdbId) return cors({ meta: null });

      const movie = await fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`);
      if (!movie) return cors({ meta: null });

      return cors({
        meta: {
          id: `tmdb:${movie.id}`,
          type: "movie",
          name: movie.title,
          description: movie.overview || "",
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
          background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
          released: movie.release_date || null,
          imdb: movie.imdb_id || null
        }
      });
    } catch (err) {
      return cors({ meta: null });
    }
  }

  return cors({ status: "ok" });
}