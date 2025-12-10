export const config = { runtime: "edge" };

// ============================
// CONFIGURATION
// ============================

const TMDB_API_KEY = "YOUR_API_KEY_HERE"; // ← PUT YOUR KEY HERE

// Acceptable release types (Hollywood category)
// 2 = theatrical, 3 = digital, 4 = physical, 5 = TV/streaming, 6 = VOD
const ALLOWED_TYPES = new Set([2, 3, 4, 5, 6]);

// Maximum pages to scan (ensures large pool)
const TMDB_PAGES = 5;

// ============================
// UTILITIES
// ============================

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    return null;
  }
}

// YYYY-MM-DD date for X days ago
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

function clean(text) {
  return text ? text.replace(/<[^>]+>/g, "").trim() : "";
}

// ============================
// MAIN DISCOVERY LOGIC
// ============================

async function discoverRecentMovies() {
  const endDate = daysAgo(0);   // today UTC
  const startDate = daysAgo(90); // last 90 days

  let movies = [];

  // Pull multiple pages to ensure we don't miss anything
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
// RELEASE TYPE FILTER
// ============================

async function filterByReleaseType(movie) {
  if (!movie?.id) return null;

  const data = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movie.id}/release_dates?api_key=${TMDB_API_KEY}`
  );

  if (!data?.results) return null;

  const now = new Date();
  const cutoff = new Date(daysAgo(90));

  for (const entry of data.results) {
    const country = entry.iso_3166_1;
    if (!["US", "CA", "GB"].includes(country)) continue;

    for (const rel of entry.release_dates) {
      if (!ALLOWED_TYPES.has(rel.type)) continue;

      const d = rel.release_date ? new Date(rel.release_date) : null;
      if (!d) continue;

      if (d >= cutoff && d <= now) {
        return {
          ...movie,
          finalDate: rel.release_date.slice(0, 10),
        };
      }
    }
  }

  return null;
}

// Concurrency control to avoid TMDB throttling
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
// BUILD FINAL MOVIE LIST
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
    poster:
      m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
    background:
      m.backdrop_path
        ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
        : null,
    release: m.finalDate,
  }));
}

// ============================
// STREMIO HANDLER
// ============================

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Manifest
  if (path === "/manifest.json") {
    return Response.json({
      id: "recent_movies",
      version: "1.0.0",
      name: "Recent Movie Releases",
      description: "Movies released in theaters, VOD, digital, or streaming in last 90 days (English only)",
      catalogs: [
        { type: "movie", id: "recent_movies", name: "Recent Movie Releases" }
      ],
      resources: ["catalog", "meta"],
      types: ["movie"],
      idPrefixes: ["tmdb"]
    });
  }

  // Catalog
  if (path.startsWith("/catalog/movie/recent_movies.json")) {
    const movies = await buildMovies();
    return Response.json({ metas: movies });
  }

  // Meta
  if (path.startsWith("/meta/movie/")) {
    const id = path.split("/").pop().replace(".json", "").replace("tmdb:", "");
    const m = await fetchJSON(
      `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`
    );

    if (!m)
      return Response.json({ meta: { id, type: "movie", name: "Unknown" } });

    return Response.json({
      meta: {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: clean(m.overview),
        poster:
          m.poster_path
            ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
            : null,
        background:
          m.backdrop_path
            ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
            : null,
      },
    });
  }

  return new Response("Not Found", { status: 404 });
}
