export const config = { runtime: "edge" };

/* ============================================
   CONFIG
============================================ */
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc"; 
const REGIONS = ["US", "CA", "GB"];
const PAGES_PER_REGION = 5;
const CONCURRENCY = 4;
const WINDOW_DAYS = 90;
const RELEASE_TYPES = "2|3|4|6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
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

async function pMap(list, fn, limit) {
  const results = [];
  let index = 0;

  const workers = Array(limit)
    .fill(0)
    .map(async () => {
      while (index < list.length) {
        const i = index++;
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

function isEnglishMovie(m) {
  return m?.original_language?.toLowerCase() === "en";
}

function dedupeMovies(list) {
  const map = new Map();
  for (const m of list) {
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return [...map.values()];
}

function extractReleaseDate(details) {
  if (!details?.release_dates?.results) return null;

  let best = null;

  for (const r of details.release_dates.results) {
    for (const entry of r.release_dates) {
      if (![2,3,4,6].includes(entry.type)) continue;
      const d = entry.release_date?.slice(0,10);
      if (!d) continue;
      if (!best || d > best) best = d;
    }
  }
  return best;
}

/* ============================================
   TMDB DISCOVER
============================================ */
async function discoverAll() {
  const tasks = [];

  for (const region of REGIONS) {
    for (let p=1; p<=PAGES_PER_REGION; p++) {
      tasks.push(
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
        `&language=en-US&region=${region}` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${DATE_FROM}` +
        `&primary_release_date.lte=${DATE_TO}` +
        `&with_release_type=${RELEASE_TYPES}` +
        `&page=${p}`
      );
    }
  }

  const result = await pMap(
    tasks,
    async (url) => (await fetchJSON(url))?.results || [],
    CONCURRENCY
  );

  return result.flat();
}

/* ============================================
   TMDB DETAILS
============================================ */
async function fetchMovieDetails(m) {
  const url =
    `https://api.themoviedb.org/3/movie/${m.id}?api_key=${TMDB_KEY}` +
    `&append_to_response=release_dates`;

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
  const discovered = await discoverAll();
  const english = discovered.filter(isEnglishMovie);
  const unique = dedupeMovies(english);

  const detailed = await pMap(
    unique,
    async (m) => {
      const det = await fetchMovieDetails(m);
      if (!det) return null;

      if (det._finalRelease < DATE_FROM) return null;
      if (det._finalRelease > DATE_TO) return null;

      return det;
    },
    CONCURRENCY
  );

  const final = detailed.filter(Boolean);

  return final
    .map((m) => ({
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title,
      description: m.overview || "",
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      background: m.backdrop_path
        ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
        : null,
      releaseInfo: m._finalRelease
    }))
    .sort((a, b) => (b.releaseInfo > a.releaseInfo ? 1 : -1));
}

/* ============================================
   HTTP HANDLER
============================================ */
export default async function handler(req) {
  const url = new URL(req.url);

  // FIX: allow /manifest.json and /api/manifest.json
  if (url.pathname.endsWith("/manifest.json")) {
    return new Response(
      JSON.stringify(
        {
          id: "recent_movies",
          version: "1.0.0",
          name: "Recent Movies (US/CA/GB)",
          description:
            "Movies released in the last 90 days (Theatrical, Digital, VOD, Streaming).",
          catalogs: [
            { type: "movie", id: "recent_movies", name: "Recent Movie Releases" }
          ],
          resources: ["catalog"],
          types: ["movie"],
          idPrefixes: ["tmdb"]
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  if (url.pathname.startsWith("/catalog/movie/recent_movies")) {
    const metas = await buildMovies();
    return new Response(JSON.stringify({ metas }, null, 2), {
      headers: CORS
    });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
