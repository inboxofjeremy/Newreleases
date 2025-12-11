export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// CORS
function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// Get proper US release date (this was the version that worked for you)
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

    // Keep ALL release types (your request now)
    const dates = us.release_dates;
    if (!dates.length) return null;

    // earliest US date
    const date = dates
      .map(d => d.release_date.split("T")[0])
      .sort()[0];

    return date;
  } catch {
    return null;
  }
}

// This was the working version — we only increased the timeframe
async function fetchMovies() {
  let allMovies = [];
  
  // Pull 10 discover pages = 200 movies
  for (let page = 1; page <= 10; page++) {
    const discURL =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const r = await fetch(discURL, { cache: "no-store" });
    const j = await r.json();
    if (!j.results?.length) break;

    allMovies.push(...j.results);
  }

  const movies = await Promise.all(
    allMovies.map(async m => {
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