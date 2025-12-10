export const config = {
  runtime: "edge",
};

// INSERT YOUR TMDB KEY HERE:
const TMDB_KEY = "YOUR_TMDB_API_KEY";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMDB_FALLBACK = "https://p.media-imdb.com/static-content.json"; // lightweight fallback

// 90-day window
function getDateRanges() {
  const today = new Date();
  const end = today.toISOString().split("T")[0];

  const past = new Date();
  past.setDate(past.getDate() - 90);
  const start = past.toISOString().split("T")[0];

  return { start, end };
}

// Build TMDB discover URL (Hollywood-weighted)
function tmdbDiscoverURL() {
  const { start, end } = getDateRanges();

  const regions = ["US", "CA", "GB"].join(",");

  const params = new URLSearchParams({
    api_key: TMDB_KEY,
    language: "en-US",
    region: "US",
    sort_by: "release_date.desc",
    "release_date.gte": start,
    "release_date.lte": end,
    with_release_type: "2|3|4|6", // Hollywood-weighted
    with_original_language: "en",  // prioritize English language films
  });

  return `${TMDB_BASE}/discover/movie?${params.toString()}`;
}

// Convert TMDB movie → Stremio meta object
function tmdbToMeta(m) {
  return {
    id: `tmdb:${m.id}`,
    type: "movie",
    name: m.title,
    poster: m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : null,
    background: m.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}`
      : null,
    releaseInfo: m.release_date,
    description: m.overview,
  };
}

// IMDb fallback (VERY lightweight, last resort)
async function imdbFallbackList() {
  try {
    const url = `${IMDB_FALLBACK}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    if (!json || !json.data) return [];

    // Convert IMDb fallback data
    return json.data.slice(0, 40).map((m) => ({
      id: `imdb:${m.id}`,
      type: "movie",
      name: m.title,
      poster: m.image,
      background: m.image,
      releaseInfo: m.releaseDate,
      description: "",
    }));
  } catch {
    return [];
  }
}

// Main catalog handler
async function handleCatalog() {
  let metas = [];

  try {
    // Try TMDB first
    const url = tmdbDiscoverURL();
    const res = await fetch(url);

    if (res.ok) {
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        metas = data.results.map(tmdbToMeta);
      }
    }
  } catch (err) {
    console.error("TMDB error:", err);
  }

  // If TMDB failed, fallback to IMDb
  if (metas.length === 0) {
    metas = await imdbFallbackList();
  }

  return new Response(JSON.stringify({ metas }), {
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Manifest
  if (pathname === "/manifest.json") {
    return new Response(
      JSON.stringify({
        id: "recent_movies",
        version: "1.0.0",
        name: "Recent Movie Releases",
        description: "Movies released in the last 90 days.",
        catalog: [
          {
            type: "movie",
            id: "recent_movies",
            name: "Recent Movie Releases",
          },
        ],
        resources: ["catalog"],
        types: ["movie"],
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Catalog
  if (pathname.startsWith("/catalog/movie/recent_movies")) {
    return handleCatalog();
  }

  // Default empty
  return new Response(JSON.stringify({ metas: [] }), {
    headers: { "Content-Type": "application/json" },
  });
}
