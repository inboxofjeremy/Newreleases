export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;
const PAGES = 10;   // Fetch 200 movies

const VALID_US_TYPES = [2, 3, 4, 6];

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

// --------------------------------------------------
// Fetch a single discover page (broad search)
// --------------------------------------------------
async function fetchDiscoverPage(page) {
  const url =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}` +
    `&language=en-US` +
    `&sort_by=release_date.desc` +
    `&include_adult=false` +
    `&page=${page}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    return j.results || [];
  } catch {
    return [];
  }
}

// --------------------------------------------------
// Fetch reliable U.S. release date (the REAL one)
// --------------------------------------------------
async function fetchUSReleaseDate(id) {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!j.results) return null;

    const us = j.results.find(x => x.iso_3166_1 === "US");
    if (!us) return null;

    const valid = us.release_dates
      .filter(r => VALID_US_TYPES.includes(r.type))
      .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    if (!valid.length) return null;

    return valid[0].release_date.split("T")[0];
  } catch {
    return null;
  }
}

// --------------------------------------------------
// Main Movie Fetcher
// --------------------------------------------------
async function fetchMovies() {
  // Fetch 10 pages (200 movies)
  const pagePromises = [];
  for (let page = 1; page <= PAGES; page++) {
    pagePromises.push(fetchDiscoverPage(page));
  }

  const pages = await Promise.all(pagePromises);
  const allMovies = pages.flat();

  // Now check U.S. release for each one
  const finalList = await Promise.all(
    allMovies.map(async m => {
      const usDate = await fetchUSReleaseDate(m.id);
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

  return finalList.filter(Boolean);
}

// --------------------------------------------------
// Handler
// --------------------------------------------------
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

  return cors({ ok: true });
}
