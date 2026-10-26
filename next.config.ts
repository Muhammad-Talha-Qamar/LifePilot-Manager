import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Next.js / Node indicator off the left sidebar profile
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
