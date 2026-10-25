import type { MetadataRoute } from 'next';
import { appBaseUrl } from '../lib/app-url.ts';

export default function robots(): MetadataRoute.Robots {
  const base = appBaseUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/messages', '/reset-password', '/verify-email'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
