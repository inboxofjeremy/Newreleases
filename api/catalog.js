export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180; // <-- extended from 90 to 180
const MAX_PAGES = 10;  // fetch 10 pages (~200 movies)

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

// Fetch US release date for Hollywood types
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

    const valid = us.release_dates.filter(r =>
      [2, 3, 4, 6].includes(r.type)
    );

    if (!valid.length) return null;

    return valid[0].release_date.split("T")[0];
  } catch {
    return null;
  }
}

// Fetch multiple TMDB pages
async function fetchMovies() {
  let movies = [];

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

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!data.results || !data.results.length) break;

    movies.push(...data.results);
  }

  // Limit to first 200 just in case
  const trimmed = movies.slice(0, 200);

  // Fetch US release dates in parallel
  const results = await Promise.all(
    trimmed.map(async m => {
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

  return results.filter(Boolean);
}

// Edge handler
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
