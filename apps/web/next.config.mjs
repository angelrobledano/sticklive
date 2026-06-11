/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL:   process.env.NEXT_PUBLIC_API_URL   ?? 'http://localhost:3000',
    NEXT_PUBLIC_SEASON_ID: process.env.NEXT_PUBLIC_SEASON_ID ?? 'e6ab9d19-cc4b-4095-a9ce-4407a4000737',
  },
  images: {
    remotePatterns: [
      // sidgad.cloud -- CDN real de logos de clubes y competiciones FEP
      { protocol: 'https', hostname: 'sidgad.cloud', pathname: '/**' },
      // server2.sidgad.es -- servidor PHP de sidgad (fallback)
      { protocol: 'https', hostname: 'www.server2.sidgad.es', pathname: '/**' },
      // hockeypatines.fep.es -- web oficial de la FEP
      { protocol: 'https', hostname: 'www.hockeypatines.fep.es', pathname: '/**' },
      { protocol: 'https', hostname: 'hockeypatines.fep.es', pathname: '/**' },
    ],
  },
};

export default nextConfig;
