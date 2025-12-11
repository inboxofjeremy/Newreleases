export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;

// CORS helper
function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// Date helpers
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// Fetch JSON
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Scrape IMDb US release calendar
async function fetchIMDbReleases() {
  const url = `https://www.imdb.com/calendar/?region=US`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const html = await res.text();

    // Parse simple regex for <a href="/title/tt1234567/">Movie Name</a>
    const matches = [...html.matchAll(/<a href="\/title\/(tt\d+)\/">([^<]+)<\/a>/g)];

    const movies = matches.map(m => ({
      imdb_id: m[1],
      name: m[2]
    }));

    return movies;
  } catch {
    return [];
  }
}

// Enrich IMDb IDs with TMDb metadata
async function fetchTMDbData(imdbId) {
  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`;
    const json = await fetchJSON(url);
    if (!json || !json.movie_results || !json.movie_results.length) return null;

    const m = json.movie_results[0];
    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title,
      description: m.overview || "",
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      releaseInfo: m.release_date || null
    };
  } catch {
    return null;
  }
}

// Main fetch function
async function fetchMovies() {
  const imdbMovies = await fetchIMDbReleases();
  if (!imdbMovies.length) return [];

  // Limit to first 200 movies to avoid timeouts
  const trimmed = imdbMovies.slice(0, 200);

  const movies = await Promise.all(
    trimmed.map(async (m) => {
      const data = await fetchTMDbData(m.imdb_id);
      return data;
    })
  );

  return movies.filter(Boolean);
}

// Edge function handler
export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const list = await fetchMovies();
      return cors({ metas: list });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "US Recent Movie Releases",
      description: "Movies released in the US (theaters, streaming, VOD) in the last 180 days",
      types: ["movie"],
      catalogs: [
        { id: "recent_movies", type: "movie", name: "Recent US Releases" }
      ]
    });
  }

  return cors({ ok: true });
}