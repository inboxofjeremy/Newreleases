{
  "id": "recent_us_movies",
  "version": "1.0.0",
  "name": "Recent US Movie Releases",
  "description": "US movies released in the last 180 days (TMDB)",
  "resources": ["catalog", "meta"],
  "types": ["movie"],
  "catalogs": [
    {
      "id": "recent_movies",
      "type": "movie",
      "name": "Recent Movies"
    }
  ],
  "idPrefixes": ["tmdb"]
}
