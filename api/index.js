export const config = { runtime: "edge" };

// ============================
// CONFIGURATION
// ============================

// Read TMDB API Key from Environment variable
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Release types to include
// 2 = Theatrical
// 3 = Digital
// 4 = Physical
// 5 = Streaming / TV premiere
// 6 = VOD
const ALLOWED_TYPES = new Set([2, 3, 4, 5, 6]);

// How many discover pages to scan
const TMDB_PAGES = 5;

// ============================
// UTILITIES
// ============================

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

function clean(text) {
  return text ? text.replace(/<[^>]+>/g, "").trim() : "";
}

// ============================
// DISCOVER MOVIES
// ============================

async function discoverRecentMovies() {
  const endDate = daysAgo(0);
  const startDate = daysAgo(90);

  let movies = [];

  for (let page = 1; page <= TMDB_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}` +
      `&language=en-US&with_original_language=en` +
      `&region=US|CA|GB` +
      `&sort_by=release_date.desc` +
      `&primary_release_date.gte=${startDate}` +
      `&primary_release_date.lte=${endDate}` +
      `&page=${page}`;

    const json = await fetchJSON(url);
    if (!json?.results?.length) break;

    movies.push(...json.results);
  }

  return movies;
}

// ============================
// RELEASE FILTERING
// ============================

async function filterByReleaseType(movie) {
  if (!movie?.id) return null;

  const rel = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movie.id}/release_dates?api_key=${TMDB_API_KEY}`
  );

  if (!rel?.results) return null;

  const cutoff = new Date(daysAgo(90));
  const now = new Date();

  for (const entry of rel.results) {
    if (!["US", "CA", "GB"].includes(entry.iso_3166_1)) continue;

    for (const r of entry.release_dates) {
      if (!ALLOWED_TYPES.has(r.type)) continue;

      const d = r.release_date ? new Date(r.release_date) : null;
      if (!d) continue;

      if (d >= cutoff && d <= now) {
        return {
          ...movie,
          finalDate: r.release_date.slice(0, 10)
        };
      }
    }
  }

  return null;
}

async function pMap(list, fn, c = 5) {
  let i = 0;
  const results = [];
  const workers = new Array(c).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      results[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ============================
// BUILD MOVIE LIST
// ============================

async function buildMovies() {
  const discovered = await discoverRecentMovies();
  if (!discovered.length) return [];

  const filtered = (await pMap(discovered, filterByReleaseType, 5))
    .filter(Boolean)
    .sort((a, b) => new Date(b.finalDate) - new Date(a.finalDate));

  return filtered.map((m) => ({
    id: `tmdb:${m.id}`,
    type: "movie",
    name: m.title,
    description: clean(m.overview),
    poster: m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : null,
    background: m.backdrop_path
      ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
      : null,
    release: m.finalDate
  }));
}

// ============================
// STREMIO HANDLER
// ============================

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // ----- MANIFEST -----
  if (path === "/manifest.json") {
    return new Response(
      JSON.stringify({
        id: "recent_movies",
        version: "1.0.0",
        name: "Recent Movie Releases",
        description: "Hollywood releases in theaters, streaming, and VOD (last 90 days)",
        catalogs: [
          { type: "movie", id: "recent_movies", name: "Recent Movie Releases" }
        ],
        resources: ["catalog", "meta"],
        types: ["movie"],
        idPrefixes: ["tmdb"]
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "identity"
        }
      }
    );
  }

  // ----- CATALOG -----
  if (path.startsWith("/catalog/movie/recent_movies.json")) {
    const movies = await buildMovies();
    return new Response(JSON.stringify({ metas: movies }), {
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "identity"
      }
    });
  }

  // ----- META -----
  if (path.startsWith("/meta/movie/")) {
    const id = path.split("/").pop().replace(".json", "").replace("tmdb:", "");
    const m = await fetchJSON(
      `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`
    );

    if (!m)
      return Response.json({ meta: { id, type: "movie", name: "Unknown" } });

    return new Response(
      JSON.stringify({
        meta: {
          id: `tmdb:${m.id}`,
          type: "movie",
          name: m.title,
          description: clean(m.overview),
          poster: m.poster_path
            ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
            : null,
          background: m.backdrop_path
            ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
            : null
        }
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "identity"
        }
      }
    );
  }

  return new Response("Not Found", { status: 404 });
}
