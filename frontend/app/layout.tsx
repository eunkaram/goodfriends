import type { Metadata } from 'next';
import '../styles/tokens.css';
import './globals.css';
import { NavHistoryBoot } from '../components/NavHistoryBoot.tsx';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner.tsx';
import { appBaseUrl } from '../lib/app-url.ts';
import { SITE_NAME, SITE_TAGLINE } from '../lib/site.ts';

const siteName = SITE_NAME;
const description = SITE_TAGLINE;

export const metadata: Metadata = {
  // 🔒 metadataBase 없이 openGraph/twitter의 상대경로(images 등)를 쓰면
  // Next가 "http://localhost:3000"으로 절대화해버린다(배포 환경에서도) —
  // 페이지별 generateMetadata가 이 기본값을 깔고 시작하게 여기서 못박는다.
  metadataBase: new URL(appBaseUrl()),
  title: { default: siteName, template: `%s · ${siteName}` },
  description,
  openGraph: {
    siteName,
    description,
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <NavHistoryBoot />
        <EmailVerificationBanner />
        {children}
      </body>
    </html>
  );
}
