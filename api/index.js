export const config = { runtime: "edge" };

/* ============================================
   CONFIG
============================================ */
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";   // your key
const REGIONS = ["US", "CA", "GB"];
const PAGES_PER_REGION = 5;         // 15 total discover pages
const CONCURRENCY = 4;              // Ultra-stable mode
const WINDOW_DAYS = 90;             // last 90 days
const RELEASE_TYPES = "2|3|4|6";    // theatrical, digital, physical, streaming

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

/* ============================================
   HELPERS
============================================ */
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function daysAgo(num) {
  const d = new Date();
  d.setDate(d.getDate() - num);
  return d.toISOString().slice(0, 10);
}

const DATE_TO = daysAgo(0);
const DATE_FROM = daysAgo(WINDOW_DAYS);

/* concurrency controller */
async function pMap(list, fn, limit) {
  const results = [];
  let idx = 0;

  const workers = Array(limit)
    .fill(0)
    .map(async () => {
      while (idx < list.length) {
        const i = idx++;
        try {
          results[i] = await fn(list[i], i);
        } catch {
          results[i] = null;
        }
      }
    });

  await Promise.all(workers);
  return results;
}

/* English-only movies */
function isEnglishMovie(m) {
  if (!m?.original_language) return false;
  return m.original_language.toLowerCase() === "en";
}

/* Dedup logic */
function dedupeMovies(list) {
  const map = new Map();
  for (const m of list) {
    if (!m) continue;
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return [...map.values()];
}

/* Extract best release date */
function extractReleaseDate(details) {
  if (!details?.release_dates?.results) return null;

  let best = null;

  for (const r of details.release_dates.results) {
    for (const entry of r.release_dates) {
      if (!entry.type) continue;
      if (![2, 3, 4, 6].includes(entry.type)) continue;

      const d = entry.release_date?.slice(0, 10);
      if (!d) continue;

      if (!best || d > best) best = d;
    }
  }
  return best;
}

/* ============================================
   TMDB – Step 1: Discover Movies
============================================ */
async function discoverAll() {
  const tasks = [];

  for (const region of REGIONS) {
    for (let page = 1; page <= PAGES_PER_REGION; page++) {
      const url =
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
        `&language=en-US&sort_by=primary_release_date.desc` +
        `&region=${region}` +
        `&with_release_type=${RELEASE_TYPES}` +
        `&primary_release_date.gte=${DATE_FROM}` +
        `&primary_release_date.lte=${DATE_TO}` +
        `&page=${page}`;

      tasks.push(url);
    }
  }

  const results = await pMap(
    tasks,
    async (url) => {
      const json = await fetchJSON(url);
      return json?.results || [];
    },
    CONCURRENCY
  );

  return results.flat().filter(i => i?.id);
}

/* ============================================
   TMDB – Step 2: Full Details (accurate release dates)
============================================ */
async function fetchMovieDetails(movie) {
  const url = `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_KEY}&append_to_response=release_dates`;
  const json = await fetchJSON(url);
  if (!json) return null;

  const rd = extractReleaseDate(json);
  if (!rd) return null;

  json._finalRelease = rd;
  return json;
}

/* ============================================
   BUILD MOVIES
============================================ */
async function buildMovies() {
  // Step 1 — pull discover lists
  const raw = await discoverAll();
  const englishOnly = raw.filter(isEnglishMovie);

  // Step 2 — dedupe BEFORE details (saves API calls)
  const unique = dedupeMovies(englishOnly);

  // Step 3 — lookup full details with concurrency limit
  const detailed = await pMap(
    unique,
    async (m) => {
      const det = await fetchMovieDetails(m);
      if (!det) return null;

      // Only keep movies released in last 90 days
      if (det._finalRelease < DATE_FROM) return null;
      if (det._finalRelease > DATE_TO) return null;

      return det;
    },
    CONCURRENCY
  );

  const final = detailed.filter(Boolean);

  // Step 4 — build Stremio metas
  const metas = final.map((m) => ({
    id: `tmdb:${m.id}`,
    type: "movie",
    name: m.title || m.original_title,
    poster: m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : null,
    background: m.backdrop_path
      ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
      : null,
    description: m.overview || "",
    releaseInfo: m._finalRelease,
  }));

  metas.sort((a, b) => (b.releaseInfo > a.releaseInfo ? 1 : -1));

  return metas;
}

/* ============================================
   HTTP HANDLER
============================================ */
export default async function handler(req) {
  const url = new URL(req.url);

  if (url.pathname === "/manifest.json") {
    return new Response(
      JSON.stringify(
        {
          id: "recent_movies",
          version: "1.0.0",
          name: "Recent Movies (US/CA/GB)",
          description:
            "Movies released in the last 90 days (Theatrical, VOD, Digital, Streaming). English only — High Accuracy Mode.",
          catalogs: [
            { type: "movie", id: "recent_movies", name: "Recent Movie Releases" },
          ],
          resources: ["catalog"],
          types: ["movie"],
          idPrefixes: ["tmdb"],
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  if (url.pathname.startsWith("/catalog/movie/recent_movies.json")) {
    const metas = await buildMovies();
    return new Response(JSON.stringify({ metas }, null, 2), {
      headers: CORS,
    });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
