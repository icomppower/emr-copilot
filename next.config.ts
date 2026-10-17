import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers read the playbook and the latest Version N+1 summary from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./playbooks/**", "./runs/evolution-latest.json", "./eval/split.json"],
  },
};

export default nextConfig;
