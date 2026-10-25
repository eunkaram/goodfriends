/**
 * 이메일 발송 — 외부 SaaS(Resend 등) 대신 사용자의 Zoho Mail 계정을 SMTP
 * 릴레이로 쓴다(사용자 명시적 선택 — 이미 있는 계정 재사용, 새 서드파티
 * 가입 안 함). SMTP는 REST API가 아니라 상태를 갖는 프로토콜(TLS 핸드셰이크
 * ·AUTH·MIME 포맷팅)이라 `fetch()`로 손수 구현하면 위험만 늘어난다 —
 * `nodemailer`(Node 이메일 발송의 사실상 표준 라이브러리)를 새 의존성으로
 * 추가했다. 이 프로젝트의 "꼭 필요할 때만 의존성 추가" 원칙의 예외는 이거
 * 하나뿐이다(oauth.ts의 raw fetch 패턴과는 다름 — SMTP는 애초에 HTTP가 아니다).
 *
 * ⚠️ `ZOHO_EMAIL_USER`/`ZOHO_EMAIL_PASSWORD`가 `.env`에 없으면 발송하지 않고
 * 콘솔에 로그만 남긴다(§17.3 "자체 호스팅이 만든 숙제" 그 항목 — 로컬 개발이
 * 깨지지 않게 하는 의도적 폴백, 이전 스텁과 같은 안전장치). 실제로 메일을
 * 보내려면:
 *   1. Zoho Mail 계정에서 2단계 인증을 켜고 "앱 비밀번호"를 발급받는다
 *      (일반 로그인 비밀번호가 아니다 — Claude가 대신 할 수 없다)
 *   2. `.env`에 `ZOHO_EMAIL_USER`(전체 이메일 주소)와
 *      `ZOHO_EMAIL_PASSWORD`(그 앱 비밀번호)를 채운다
 *   3. goodfriends.co 도메인을 Zoho에 연결해뒀다면 `EMAIL_FROM`을
 *      `goodfriends <no-reply@goodfriends.co>`처럼 커스텀 도메인 주소로 바꿀 수 있다
 *      (연결 안 했으면 ZOHO_EMAIL_USER 그대로 발신 주소로 쓴다)
 *
 * 호출부(auth.ts)는 이 함수의 성패와 무관하게 동작해야 한다 — 이메일 발송
 * 실패가 회원가입 자체를 막아선 안 된다.
 */
import { createTransport } from 'nodemailer';

// 🔒 web/lib/site.ts와 같은 값 — backend·web이 별도 배포 단위(서로 import
// 불가)라 이 리터럴 하나만 따로 둔다. web 쪽을 고치면 여기도 같이 고쳐야
// 한다(사용자 발견, 2026-10 — "인증 이메일도 UI설정에 맞게 수정해줘": 2026년
// 10월 goodfriends 리브랜딩 때 이 파일만 "AI Community"·크림슨 배색으로
// 남아있었다).
const SITE_NAME = 'goodfriends';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function zohoCredentials(): { user: string; pass: string } | null {
  const user = process.env.ZOHO_EMAIL_USER;
  const pass = process.env.ZOHO_EMAIL_PASSWORD;
  if (!user || !pass) return null;
  return { user, pass };
}

function emailFrom(zohoUser: string): string {
  // 🔒 `??`가 아니라 `||`다 — `.env`에 `EMAIL_FROM=`(빈 문자열)로 남겨두는 게
  // 기본 안내(.env.example)라, `??`는 빈 문자열을 "설정됨"으로 보고 폴백을
  // 안 타서 발신 주소가 빈 값이 될 뻔했다.
  return process.env.EMAIL_FROM || `${SITE_NAME} <${zohoUser}>`;
}

// 🔒 요청마다 새로 만들지 않는다 — SMTP 커넥션 풀을 nodemailer가 내부에서
// 재사용하게 한다(매 발송마다 TLS 핸드셰이크를 새로 하면 느리고, Zoho가
// 짧은 시간에 반복되는 새 연결을 비정상 패턴으로 볼 수도 있다).
let transporter: ReturnType<typeof createTransport> | null = null;

function zohoTransporter(user: string, pass: string) {
  if (!transporter) {
    transporter = createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const creds = zohoCredentials();
  if (!creds) {
    console.log(`[email:stub — ZOHO_EMAIL_USER/PASSWORD 없음, 콘솔로만 남김] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }

  try {
    await zohoTransporter(creds.user, creds.pass).sendMail({
      from: emailFrom(creds.user),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (err) {
    // 🔒 실패해도 던지지 않는다 — 위 파일 헤더 주석대로 호출부(회원가입 등)를 막으면 안 된다.
    console.error(`[email] Zoho SMTP 발송 실패:`, err);
  }
}

// 🔒 이메일 속 링크(인증·비밀번호 재설정 등)는 전부 Next.js 프론트(web)의
// 라우트다(/verify-email, /reset-password, ...) — 백엔드(3010)가 아니라
// web 기본 포트(3011)가 맞는 폴백이다. .env의 APP_BASE_URL(보통 web 주소)이
// 항상 우선하므로 이 폴백은 그 값이 비어있을 때만 쓰인다.
function appBaseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3011';
}

/**
 * 공용 레이아웃 — web/styles/tokens.css 실제 값을 이메일 클라이언트 호환을
 * 위해 인라인 스타일로 그대로 박아 넣는다(외부 CSS·flexbox/grid는 Outlook
 * 등에서 깨진다 — 테이블 기반 레이아웃 + 인라인 스타일만 쓴다).
 *
 * 🔒 사용자 발견(2026-10, "인증 이메일도 UI설정에 맞게 수정해줘") — 2026년
 * 10월 goodfriends 리브랜딩(인디고 #3F4C86, tokens.css 주석 참고) 때 사이트
 * 전체가 크림슨에서 인디고로 바뀌었는데, 이 템플릿만 옛 크림슨 배색
 * (#950026 로고 / #be1437 CTA / #e3bdbe 보더)으로 남아 있었다 — 아래로
 * 교체: --logo(#313e84) 브랜드명, --accent(#3f4c86) CTA, --border(#e0e8fb)
 * 보더, --text-primary/--text-secondary/--text-tertiary 본문 톤.
 */
function emailLayout(opts: { preheader: string; heading: string; body: string; ctaLabel: string; ctaUrl: string; footnote: string }): string {
  // 🔒 메일 클라이언트 중 일부(구버전 Outlook 등)는 nodemailer가 붙이는
  // MIME charset 헤더를 무시하고 <meta charset>만 본다 — 없으면 한글이
  // 깨질 수 있다(로컬 미리보기로 직접 확인, python http.server가 MIME
  // 헤더 없이 서빙했을 때 재현됨).
  return `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:#f5f5fa;font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5fa;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e0e8fb;border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 0;">
                <span style="font-size:24px;font-weight:700;color:#313e84;">${SITE_NAME}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <span style="font-size:20px;font-weight:600;color:#111c2d;">${opts.heading}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <p style="margin:0;font-size:16px;line-height:1.7;color:#475569;">${opts.body}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <a href="${opts.ctaUrl}" style="display:inline-block;background:#3f4c86;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:10px;">${opts.ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px;border-top:1px solid #e0e8fb;">
                <p style="margin:0;padding-top:16px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">${opts.footnote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${appBaseUrl()}/verify-email?token=${token}`;
  await sendEmail({
    to,
    subject: `${SITE_NAME} 이메일 인증`,
    text: `가입해주셔서 감사해요. 아래 링크를 눌러 이메일 인증을 완료해주세요 (24시간 유효):\n${link}`,
    html: emailLayout({
      preheader: `이메일 인증을 완료하고 ${SITE_NAME}를 시작하세요.`,
      heading: '이메일 인증',
      body: '가입해주셔서 감사해요. 아래 버튼을 눌러 이메일 인증을 완료해주세요.',
      ctaLabel: '이메일 인증하기',
      ctaUrl: link,
      footnote: `이 링크는 24시간 동안만 유효해요. 본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.<br><br>버튼이 눌리지 않으면 아래 링크를 복사해 브라우저 주소창에 붙여넣어주세요:<br>${link}`,
    }),
  });
}

/**
 * 🔒 보안 점검 발견(2026-08-22) — 이메일 변경(updateEmail, auth.ts)이 예전
 * 주소로는 아무 알림도 안 보냈다. 세션을 탈취한 공격자가 이메일을 자기
 * 주소로 바꾼 뒤 비밀번호 재설정까지 받아가는 시나리오에서, 원래 주인이
 * 유일하게 알아챌 수 있는 신호가 이 메일이다 — 바꾸기 전 주소로 보낸다.
 */
export async function sendEmailChangedNotice(to: string, newEmail: string): Promise<void> {
  const link = `${appBaseUrl()}/forgot-password`;
  await sendEmail({
    to,
    subject: `${SITE_NAME} 계정 이메일이 변경됐어요`,
    text: `이 계정(${to})의 로그인 이메일이 ${newEmail}(으)로 변경됐어요. 본인이 한 게 맞다면 무시하셔도 됩니다. 본인이 아니라면 지금 바로 비밀번호를 재설정해주세요:\n${link}`,
    html: emailLayout({
      preheader: '계정 이메일이 변경됐어요 — 본인이 아니라면 확인해주세요.',
      heading: '이메일이 변경됐어요',
      body: `이 계정의 로그인 이메일이 <strong>${newEmail}</strong>(으)로 변경됐어요. 본인이 한 게 맞다면 별도로 하실 일은 없어요.`,
      ctaLabel: '본인이 아니라면 — 비밀번호 재설정',
      ctaUrl: link,
      footnote: `버튼이 눌리지 않으면 아래 링크를 복사해 브라우저 주소창에 붙여넣어주세요:<br>${link}`,
    }),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${appBaseUrl()}/reset-password?token=${token}`;
  await sendEmail({
    to,
    subject: `${SITE_NAME} 비밀번호 재설정`,
    text: `아래 링크에서 새 비밀번호를 설정해주세요 (1시간 유효):\n${link}`,
    html: emailLayout({
      preheader: '비밀번호를 재설정하세요.',
      heading: '비밀번호 재설정',
      body: '아래 버튼을 눌러 새 비밀번호를 설정해주세요.',
      ctaLabel: '비밀번호 재설정하기',
      ctaUrl: link,
      footnote: `이 링크는 1시간 동안만 유효해요. 본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다 — 비밀번호는 바뀌지 않아요.<br><br>버튼이 눌리지 않으면 아래 링크를 복사해 브라우저 주소창에 붙여넣어주세요:<br>${link}`,
    }),
  });
}
