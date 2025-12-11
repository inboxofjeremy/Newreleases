export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const MAX_PAGES = 10; // Fetch up to 10 pages (~200 movies) per request

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

function cors(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// Fetch JSON helper
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Fetch TMDb movies for the last 180 days
async function fetchMovies() {
  let allMovies = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const data = await fetchJSON(url);
    if (!data?.results?.length) break;

    allMovies.push(...data.results);

    if (page >= data.total_pages) break;
  }

  // Fetch IMDb IDs in parallel
  const moviesWithIMDB = await Promise.all(
    allMovies.map(async (m) => {
      const ext = await fetchJSON(
        `https://api.themoviedb.org/3/movie/${m.id}/external_ids?api_key=${TMDB_KEY}`
      );
      const imdb_id = ext?.imdb_id || null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: m.overview || "",
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        releaseInfo: m.release_date || null,
        imdb_id
      };
    })
  );

  return moviesWithIMDB.filter(Boolean);
}

// Edge handler
export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const movies = await fetchMovies();
      return cors({ metas: movies });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Movie Releases",
      description: "All movies released in the US (theatres, digital, streaming) in the last 180 days",
      catalogs: [
        {
          id: "recent_movies",
          type: "movie",
          name: "Recent US Releases"
        }
      ],
      types: ["movie"]
    });
  }

  return cors({ ok: true });
}