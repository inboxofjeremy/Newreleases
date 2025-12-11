export const config = { runtime: "edge" };

export default async function handler() {
  const manifest = {
    id: "recent_movies",
    version: "1.0.0",
    name: "Recent Movie Releases",
    description: "Hollywood movies released in the last 90 days",
    catalogs: [
      {
        type: "movie",
        id: "recent_movies",
        name: "Recent Releases"
      }
    ],
    resources: ["catalog", "meta"],
    types: ["movie"]
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    }
  });
}
