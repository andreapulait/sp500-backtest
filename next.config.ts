import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le serie storiche sono lette da disco a runtime, non importate come modulo:
  // vanno incluse esplicitamente nel bundle delle funzioni su Vercel.
  outputFileTracingIncludes: {
    "/**": ["./src/data/**"],
  },
};

export default nextConfig;
