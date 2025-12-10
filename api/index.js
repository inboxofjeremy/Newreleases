// api/index.js
export const config = { runtime: "edge" };

// ========================================
// CONFIG
// ========================================
const TMDB_KEY = process.env.TMDB_KEY;

const PRIORITY_REGIONS = ["US", "CA", "GB"];
const MAX_CHANGED_PAGES = 3; // checks ~3000 changed movies (enough)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

// ========================================
// UTILITIES
// ========================================
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function cleanHTML(str) {
  return str ? str.replace(/<[^>]+>/g, "").trim() : "";
}

function isForeign(m) {
  return (m.original_language || "").toLowerCase() !== "en";
}

function isValidMovie(m) {
  if (!m) return false;
  if (!m.title) return false;
  if (m.adult) return false;
  return true;
}

// Last 30 days window
function getDateRange() {
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - 30);

  return {
    start: start.toISOString().slice(0, 10),
    end: today.toISOString().slice(0, 10),
  };
}

// ========================================
// TMDB CHANGES → MOVIES UPDATED IN LAST 30 DAYS
// ========================================
async function fetchRecentlyChangedMovies() {
  const { start, end } = getDateRange();
  let all = [];

  for (let page = 1; page <= MAX_CHANGED_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/movie/changes?api_key=${TMDB_KEY}` +
      `&start_date=${start}&end_date=${end}&page=${page}`;

    const json = await fetchJSON(url);
    if (!json?.results) break;

    all.push(...json.results);
  }

  // returns array of movie IDs: [{id: 123}, …]
  return all.map((x) => x.id);
}

// ========================================
// GET REAL HOLLYWOOD RELEASE DATE
// ========================================
async function extractRegionRelease(movieId) {
  const url = `https://api.themoviedb.org/3/movie/${movieId}/release_dates?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  if (!json?.results) return null;

  for (const region of PRIORITY_REGIONS) {
    const entry = json.results.find((x) => x.iso_3166_1 === region);
    if (!entry || !entry.release_dates) continue;

    // Filter release types:
    // 1 = Premiere
    // 2 = Theatrical (limited)
    // 3 = Theatrical
    // 4 = Digital
    // 5 = Physical
    // 6 = TV
    const rd = entry.release_dates.find((r) =>
      [1, 2, 3, 4, 6].includes(r.type)
    );

    if (rd?.release_date) {
      return rd.release_date.slice(0, 10); // YYYY-MM-DD
    }
  }

  return null;
}

// ========================================
// TMDB → IMDb FALLBACK
// ========================================
async function tmdbToImdb(id) {
  const url = `https://api.themoviedb.org/3/movie/${id}/external_ids?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  return json?.imdb_id || null;
}

// ========================================
// MAIN BUILDER
// ========================================
async function buildMovies() {
  const ids = await fetchRecentlyChangedMovies();
  const { start, end } = getDateRange();

  const list = [];

  for (const movieId of ids) {
    // Fetch movie details
    const m = await fetchJSON(
      `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_KEY}&language=en-US`
    );
    if (!isValidMovie(m)) continue;
    if (isForeign(m)) continue;

    // Real US/CA/GB release date
    const release = await extractRegionRelease(movieId);
    if (!release) continue;

    // Ensure release is within last 30 days
    if (release < start || release > end) continue;

    const imdb = await tmdbToImdb(movieId);

    list.push({
      id: `tmdb:${movieId}`,
      type: "movie",
      name: m.title,
      description: cleanHTML(m.overview),
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      background: m.backdrop_path
        ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
        : null,
      release: release,
      imdb: imdb,
    });
  }

  // Sort newest → oldest
  list.sort((a, b) => new Date(b.release) - new Date(a.release));

  return list;
}

// ========================================
// ROUTER
// ========================================
export default async function handler(req) {
  const url = new URL(req.url);
  const p = url.pathname;

  // Manifest
  if (p === "/manifest.json") {
    return new Response(
      JSON.stringify(
        {
          id: "recent_movies",
          version: "1.0.0",
          name: "Hollywood Recent Movie Releases",
          description:
            "Hollywood theatrical/digital/streaming releases from the last 30 days (US/CA/GB). Uses TMDB + IMDb fallback.",
          catalogs: [
            {
              type: "movie",
              id: "recent_movies",
              name: "Recent Movies",
            },
          ],
          resources: ["catalog", "meta"],
          types: ["movie"],
          idPrefixes: ["tmdb"],
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  // Catalog
  if (p.startsWith("/catalog/movie/recent_movies")) {
    const movies = await buildMovies();
    return new Response(JSON.stringify({ metas: movies }, null, 2), {
      headers: CORS,
    });
  }

  // Meta
  if (p.startsWith("/meta/movie/")) {
    const id = p.split("/").pop().replace(".json", "");
    const tmdbId = id.replace("tmdb:", "");

    const m = await fetchJSON(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
    );

    if (!m) {
      return new Response(
        JSON.stringify({
          meta: { id, type: "movie", name: "Unknown", videos: [] },
        }),
        { headers: CORS }
      );
    }

    return new Response(
      JSON.stringify(
        {
          meta: {
            id,
            type: "movie",
            name: m.title,
            description: cleanHTML(m.overview),
            poster: m.poster_path
              ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
              : null,
            background: m.backdrop_path
              ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
              : null,
            videos: [],
          },
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
