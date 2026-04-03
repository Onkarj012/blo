import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Field Voter Finder",
    short_name: "Voter Finder",
    description: "Nearby voter discovery and field status tracking for house visits.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f1e3",
    theme_color: "#1f8f63",
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
  };
}

