import path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(__dirname, '..', '..');

const nextConfig: NextConfig = {
  // Ortak paket TypeScript kaynağı olarak tüketilir
  transpilePackages: ['@istakip/shared'],
  turbopack: {
    root: monorepoRoot,
  },
  outputFileTracingRoot: monorepoRoot,
  // Yalnızca geliştirme sunucusu: localhost dışındaki yerel adreslerden (ikinci kullanıcı sekmesi,
  // aynı ağdaki telefon) açılan sayfaların geliştirme dosyalarına erişebilmesi için
  allowedDevOrigins: ['127.0.0.1', '192.168.*.*', '172.20.10.*', '10.*.*.*'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
