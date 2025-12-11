export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

// ---------------------------------------------------
// Helpers
// ---------------------------------------------------
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO   = daysAgo(0);

function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// ---------------------------------------------------
// Fetch US theatrical/digital/streaming release date
// ---------------------------------------------------
async function fetchUSRelease(id) {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!j.results) return null;

    const us = j.results.find(x => x.iso_3166_1 === "US");
    if (!us) return null;

    // Hollywood-valid release types:
    const TYPES = [2, 3, 4, 6];
    const valid = us.release_dates
      .filter(r => TYPES.includes(r.type))
      .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    if (!valid.length) return null;

    return valid[0].release_date.split("T")[0];
  } catch {
    return null;
  }
}

// ---------------------------------------------------
// Discover movies (Correct TMDB search)
// ---------------------------------------------------
async function fetchDiscoverPage(page) {
  const URL =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}` +
    `&region=US` +                             // ← critical for Hollywood results
    `&sort_by=release_date.desc` +             // ← REAL workable field
    `&release_date.gte=${DATE_FROM}` +
    `&release_date.lte=${DATE_TO}` +
    `&include_adult=false` +
    `&page=${page}`;

  const r = await fetch(URL, { cache: "no-store" });
  const j = await r.json();
  return j.results || [];
}

// ---------------------------------------------------
// Main fetch logic
// ---------------------------------------------------
async function fetchMovies() {
  // Pull first 4 pages (~80 movies)
  const pages = await Promise.all([
    fetchDiscoverPage(1),
    fetchDiscoverPage(2),
    fetchDiscoverPage(3),
    fetchDiscoverPage(4)
  ]);

  const flat = pages.flat();

  const movies = await Promise.all(
    flat.map(async m => {
      const usDate = await fetchUSRelease(m.id);
      if (!usDate) return null;
      if (usDate < DATE_FROM || usDate > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: m.overview || "",
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
        releaseInfo: usDate
      };
    })
  );

  return movies.filter(Boolean);
}

// ---------------------------------------------------
// Handler
// ---------------------------------------------------
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

  return cors({ ok: true });
}
