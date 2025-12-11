// api/catalog.js
export const config = { runtime: "nodejs18.x" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const PAGE_LIMIT = 5; // adjust number of pages (~20 movies per page)
const US_RELEASE_TYPES = [1,2,3,4,5,6,7,8]; // all release types

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// Fetch TMDB discover pages
async function fetchMovies() {
  const allMovies = [];

  for (let page = 1; page <= PAGE_LIMIT; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&sort_by=primary_release_date.desc` +
      `&with_original_language=en` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}` +
      `&region=US`; // TMDB US region

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!data.results || data.results.length === 0) break;

    for (const m of data.results) {
      // Include only movies with valid release_date
      if (!m.release_date) continue;

      allMovies.push({
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: m.overview || "",
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        releaseInfo: m.release_date,
        popularity: m.popularity,
        voteCount: m.vote_count
      });
    }
  }

  return allMovies;
}

export default async function handler(req) {
  const url = new URL(req.url);

  if (url.pathname === "/catalog/movie/recent_movies.json") {
    try {
      const movies = await fetchMovies();
      return cors({ metas: movies });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ ok: true });
}