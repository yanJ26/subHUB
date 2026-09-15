const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim().replace(/\/$/, "") || "";

const nextConfig = { basePath: configuredBasePath };

export default nextConfig;
