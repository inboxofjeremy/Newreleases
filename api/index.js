export default async function handler(req, res) {
  // CORS for Stremio
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";

  const url = req.url || "";

  // ─────────────────────────────────────────────
  // MANIFEST
  // ─────────────────────────────────────────────
  if (url.includes("/manifest.json")) {
    return res.status(200).json({
      id: "recent_movies",
      version: "1.0.0",
      name: "Recent Movie Releases",
      description: "Movies released in the last 90 days (US/CA/GB, English, theatrical + streaming).",
      types: ["movie"],
      catalogs: [
        {
          type: "movie",
          id: "recent_movies",
          name: "Recent Movie Releases",
          extra: []
        }
      ]
    });
  }

  // ─────────────────────────────────────────────
  // CATALOG
  // ─────────────────────────────────────────────
  if (url.includes("/catalog")) {
    try {
      const today = new Date();
      const past90 = new Date(today);
      past90.setDate(today.getDate() - 90);

      // YYYY-MM-DD
      const format = d => d.toISOString().split("T")[0];

      const startDate = format(past90);
      const endDate = format(today);

      // TMDB discover URL
      const tmdbUrl =
        `https://api.themoviedb.org/3/discover/movie` +
        `?api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&region=US,CA,GB` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${startDate}` +
        `&primary_release_date.lte=${endDate}` +
        `&with_release_type=2|3|4|6` +
        `&page=1`;

      const tmdbResp = await fetch(tmdbUrl);
      const tmdbData = await tmdbResp.json();

      if (!tmdbData.results || !Array.isArray(tmdbData.results)) {
        return res.status(200).json({ metas: [] });
      }

      // Convert TMDB → Stremio metas
      const metas = tmdbData.results.map(movie => {
        const id = movie.id ? `tmdb:${movie.id}` : null;

        // Fix wrong dates: use earliest of:
        // release_date, first_air_date, or fallback null
        const releaseDate =
          movie.release_date ||
          movie.first_air_date ||
          null;

        return {
          id,
          type: "movie",
          name: movie.title || movie.original_title || "Unknown Title",
          poster: movie.poster_path
            ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
            : null,
          background: movie.backdrop_path
            ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
            : null,
          description: movie.overview || "",
          releaseInfo: releaseDate || ""
        };
      }).filter(m => m.id);

      return res.status(200).json({ metas });
    } catch (e) {
      console.error("Catalog Error:", e);
      return res.status(200).json({ metas: [] });
    }
  }

  // ─────────────────────────────────────────────
  // META / STREAMS (not used but required to avoid 404)
  // ─────────────────────────────────────────────
  if (url.includes("/meta/")) {
    return res.status(200).json({ meta: {} });
  }

  if (url.includes("/stream/")) {
    return res.status(200).json({ streams: [] });
  }

  // Fallback route
  return res.status(200).json({ status: "ok", message: "Movie addon online" });
}
