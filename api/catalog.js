export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;
const MAX_PAGES = 10;     // Fetch 200 movies

const VALID_US_TYPES = [2, 3, 4, 6];   // Theatrical, Digital, Streaming

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

// ------------------------------
// Fetch TMDB discover pages
// ------------------------------
async function fetchPage(page) {
  const url =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}` +
    `&language=en-US` +
    `&include_adult=false` +
    `&sort_by=popularity.desc` +   // <-- IMPORTANT: Do NOT use date filters
    `&page=${page}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    return j.results || [];
  } catch {
    return [];
  }
}

// ------------------------------
// Get accurate U.S. release date
// ------------------------------
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

    const rel = us.release_dates
      .filter(r => VALID_US_TYPES.includes(r.type))
      .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    if (!rel.length) return null;

    return rel[0].release_date.split("T")[0];
  } catch {
    return null;
  }
}

// ------------------------------
// MAIN MOVIE BUILDER
// ------------------------------
async function buildMovies() {
  // 1. Load 10 discover pages = ~200 movies
  const pagePromises = [];
  for (let i = 1; i <= MAX_PAGES; i++) {
    pagePromises.push(fetchPage(i));
  }

  const allPages = await Promise.all(pagePromises);
  const bigList = allPages.flat();

  // 2. Resolve real U.S. release dates
  const mapped = await Promise.all(
    bigList.map(async m => {
      const usDate = await fetchUSRelease(m.id);
      if (!usDate) return null;

      // Must be in the last 90 days
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

  return mapped.filter(Boolean);
}

// ------------------------------
// HANDLER
// ------------------------------
export default async function handler(req) {
  const u = new URL(req.url);
  const p = u.pathname;

  if (p === "/catalog/movie/recent_movies.json") {
    try {
      const movies = await buildMovies();
      return cors({ metas: movies });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ ok: true });
}
