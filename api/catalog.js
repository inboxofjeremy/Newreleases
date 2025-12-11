export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const MIN_VOTE_COUNT = 20; // remove very tiny indies
const REGIONS = ["US"];
const VALID_TYPES = [2, 3, 4, 5, 6, 7]; // all release types

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

async function fetchUSRelease(id) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (!json.results) return null;

    for (const region of REGIONS) {
      const entry = json.results.find(r => r.iso_3166_1 === region);
      if (!entry) continue;

      const valid = entry.release_dates.filter(r =>
        VALID_TYPES.includes(r.type)
      );

      if (valid.length > 0) return valid[0].release_date.split("T")[0];
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchMovies() {
  const allMovies = [];

  for (let page = 1; page <= 10; page++) { // fetch up to ~400 movies
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&with_origin_country=US` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();
    if (!json.results || json.results.length === 0) break;

    allMovies.push(...json.results);
    if (page >= json.total_pages) break;
  }

  const results = await Promise.all(
    allMovies.map(async m => {
      if (m.vote_count < MIN_VOTE_COUNT) return null;

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
        releaseInfo: usDate,
        popularity: m.popularity,
        voteCount: m.vote_count
      };
    })
  );

  return results.filter(Boolean);
}

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