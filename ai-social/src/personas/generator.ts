import crypto from 'node:crypto';
import type { AgentPersona } from '../types.js';

/**
 * 실제 유저처럼 보이는 페르소나를 대량으로 찍어내는 제너레이터. 손으로 하나씩 쓰던 방식은
 * 100명 규모에서 안 통해서(품질 유지 불가능) 이름/닉네임/관심사/말투/바이오를 여러 풀에서
 * 조합하는 방식으로 바꿨다.
 *
 * 이메일 로컬파트(=Reafy 유저네임의 원천, registry.ts 참고)에 "ai"라는 글자가 절대 안 들어가게
 * 만드는 게 핵심 요구사항이었다 — 예전 방식(`technova.ai@reafy.local` → 유저네임 `technovaai`)은
 * AI라는 게 그대로 드러났었음. 단어 풀 자체를 "ai"가 안 들어간 것들로만 구성하고, 혹시 조합
 * 과정에서 우연히 생기더라도(예: "rain", "mountain") generateEmailLocalPart가 재시도하며 걸러낸다.
 */

const SURNAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍',
  '유', '고', '문', '양', '손', '배', '백', '허', '남', '심',
];

const GIVEN_FIRST = ['민', '서', '지', '하', '유', '시', '도', '예', '수', '준', '현', '우', '재', '윤', '태', '건', '성', '다', '은', '채'];
const GIVEN_SECOND = ['준', '원', '우', '현', '아', '율', '빈', '호', '진', '서', '인', '림', '규', '안', '솔', '겸', '나', '경', '린', '민'];

// 닉네임 재료 풀. 여러 개의 서로 다른 "모양"(패턴)을 섞어야 다채로워 보인다 — 형용사+명사
// 하나로만 100개를 뽑으면 재료가 600가지든 뭐든 전부 똑같은 틀이라 결국 비슷해 보인다는
// 피드백(2026-09-06)으로 아래 NICKNAME_PATTERNS처럼 여러 패턴을 섞는 방식으로 바꿨다.
const NICKNAME_ADJECTIVES = [
  '조용한', '느긋한', '까칠한', '엉뚱한', '다정한', '잔잔한', '씩씩한', '시크한', '몽글', '포근한',
  '짭짤한', '새콤달콤', '뚝심있는', '호기심많은', '걱정많은', '낙천적인', '예민한', '무던한', '부지런한', '느릿한',
];
const NICKNAME_NOUNS = [
  '하늘', '구름', '고양이', '강아지', '커피', '책방', '산책', '바다', '저녁', '달빛',
  '새벽', '골목', '벤치', '우체통', '자전거', '라면', '떡볶이', '텃밭', '서랍', '나무',
  '들판', '호수', '편의점', '옥상', '창가', '냉장고', '이불', '연필', '자몽', '민트',
  '보리', '메밀', '단팥', '두유', '감자', '고구마', '옥수수', '밤톨', '도토리', '솜사탕',
  '콩이', '망고', '수박', '참외', '팥죽', '식빵', '만두', '어묵', '붕어빵', '호떡',
];
// 명사에 붙여서 "역할/애정"형 닉네임을 만드는 접미사 (예: 라면덕후, 산책러, 책방지기)
const NICKNAME_ROLE_SUFFIXES = ['러', '덕후', '킹', '단', '매니아', '홀릭', '장인', '고수', '초보', '지기'];
// 의태어/의성어 단독형 — 형용사·명사 조합 없이도 그 자체로 닉네임처럼 쓰이는 것들
const NICKNAME_STANDALONE = [
  '몽실몽실', '말랑말랑', '두근두근', '반짝반짝', '아장아장', '오순도순',
  '알콩달콩', '살랑살랑', '대충대충', '느릿느릿', '조마조마', '들썩들썩',
];

// 이메일 로컬파트용 영단어 풀 — "ai"가 들어간 단어(rain, mountain, detail 등)는 애초에 제외했다.
const EMAIL_WORDS = [
  'sunny', 'moonlight', 'urbanfox', 'cloudwalk', 'citylights', 'greentea', 'oldfilm', 'nightowl',
  'paperplane', 'saltybread', 'mellow', 'driftwood', 'coldbrew', 'softbreeze', 'streetcat', 'indigo',
  'maplewood', 'tinystar', 'duskfall', 'honeybee', 'glasswave', 'pineforest', 'lazysunday', 'quietcorner',
  'bluenote', 'foglight', 'redbrick', 'yellowcup', 'greyroom', 'oldbook', 'slowmotion', 'lowtide',
  'windowseat', 'busride', 'backalley', 'campfire', 'stargazer', 'wildflower', 'shortstop', 'sidewalk',
];

// 한글 로마자 표기 풀 — 실제 한국 커뮤니티 아이디는 영어 자연물 단어보다 이쪽이 훨씬 흔하다.
// EMAIL_WORDS만 쓰면 모든 계정이 같은 40단어의 1~2개 조합으로 잔여 문자 없이 전부 분해된다
// (2026-09-14 prod 감사에서 41개 계정 41개 전부 분해됨 = 봇 판정의 결정적 근거였음).
const EMAIL_WORDS_KO = [
  'haneul', 'baram', 'dalbit', 'byeolbit', 'norang', 'parang', 'gureum', 'nunkkot',
  'bomnal', 'gareum', 'sonagi', 'mulgyeol', 'doraji', 'minari', 'jjajang', 'gamja',
  'kongbap', 'nurungji', 'sujebi', 'ttokbokki', 'seolleim', 'georium', 'jogeumssik', 'neuritneurit',
  'ttabok', 'oreumgil', 'golmokgil', 'changmun', 'ibul', 'baekgu', 'kkobuk', 'darami',
];

// 아이디 뒤에 붙는 흔한 꼬리표. 숫자 접미사는 부자연스럽다는 피드백(2026-09-06)으로 계속 제외.
const EMAIL_SUFFIXES = ['nim', 'ya', 'ee', 'ssi', 'zip', 'log', 'house', 'room', 'day', 'note'];

// 닉네임용 영단어는 EMAIL_WORDS와 절대 겹치면 안 된다(아래 NICKNAME_PATTERNS 주석 참고).
const NICKNAME_EN_WORDS = [
  'toffee', 'pebble', 'marble', 'velvet', 'clover', 'lantern', 'mango', 'biscuit',
  'sprout', 'ripple', 'mochi', 'cobalt', 'plum', 'tangerine', 'linen', 'pepper',
];

const PASSWORD_WORDS = ['Nova', 'Echo', 'Delta', 'Coral', 'Ember', 'Willow', 'Cedar', 'Lumen', 'Onyx', 'Rune'];

interface CategoryFlavor {
  role: string;
  bios: string[];
  tones: string[];
}

// DEFAULT_CATEGORIES(reafy-client.ts)의 15개 slug와 1:1로 맞춘 톤/바이오 소스.
const CATEGORY_FLAVOR: Record<string, CategoryFlavor> = {
  chat: {
    role: '일상을 담백하게 기록하는 동네 이웃',
    bios: ['별거 아닌 하루하루를 기록하는 걸 좋아해요.', '소소한 고민과 일상 이야기를 편하게 나눕니다.'],
    tones: ['담백하고 잔잔하며 일기 쓰듯 편안하게 말을 건네는 어조', '친근하고 수다스러운 동네 친구 같은 어조'],
  },
  issue: {
    role: '균형 잡힌 시각을 중요하게 여기는 시사 관찰자',
    bios: ['자극적인 프레이밍보다 맥락을 먼저 보려고 합니다.', '이슈가 생기면 여러 입장을 먼저 살피는 편이에요.'],
    tones: ['차분하고 신중하며 감정보다 사실을 먼저 짚는 어조', '팩트 위주로 담백하게 정리해서 전달하는 어조'],
  },
  humor: {
    role: '인터넷 밈과 직장인 유머를 좋아하는 개그 수집가',
    bios: ['진지충은 딱 질색이고 드립 치는 걸 좋아해요.', '웃픈 일상 이야기를 가볍게 풀어내는 편입니다.'],
    tones: ['가볍고 능청스러우며 드립과 언어유희를 즐기는 어조', '유머를 섞어서 텐션 있게 풀어내는 어조'],
  },
  health: {
    role: '꾸준한 운동과 소소한 건강 습관을 챙기는 생활러',
    bios: ['거창한 다이어트보다 꾸준한 습관을 믿는 편이에요.', '작은 컨디션 변화도 기록해두는 걸 좋아합니다.'],
    tones: ['담백하고 실용적으로 정보를 정리해주는 어조', '따뜻하게 격려하면서 팁을 나누는 어조'],
  },
  shopping: {
    role: '가성비 조합을 찾는 게 취미인 뷰티·패션러',
    bios: ['가성비 좋은 조합 찾는 게 취미예요.', '데일리룩과 신상 정보를 발 빠르게 챙기는 편입니다.'],
    tones: ['트렌디하고 발랄하며 취향을 자연스럽게 드러내는 어조', '차분하게 비교 분석해서 추천해주는 어조'],
  },
  cooking: {
    role: '퇴근 후 집밥 해먹는 게 낙인 홈쿡 애호가',
    bios: ['냉장고 파먹기 레시피 만드는 게 취미예요.', '거창하진 않아도 맛있는 한 끼를 좋아합니다.'],
    tones: ['푸근하고 실용적으로 조곤조곤 설명하는 어조', '담백하게 레시피 팁을 나누는 어조'],
  },
  pets: {
    role: '반려동물과의 일상을 소중히 여기는 집사',
    bios: ['반려동물 이야기만 나오면 텐션이 오릅니다.', '산책 코스와 훈련 정보 나누는 걸 좋아해요.'],
    tones: ['다정하고 애정 넘치는 어조', '따뜻하게 경험을 나누는 어조'],
  },
  broadcast: {
    role: '드라마·예능을 챙겨보는 본방사수러',
    bios: ['본방사수는 기본, 전개 예측하는 재미로 봅니다.', '화제의 영상과 방송 이야기를 빠르게 따라가요.'],
    tones: ['열정적이고 몰입감 있는 어조', '가볍고 신나게 감상을 풀어내는 어조'],
  },
  travel: {
    role: '저비용 여행 루트를 좋아하는 방랑러',
    bios: ['거창하지 않아도 훌쩍 떠나는 여행을 좋아해요.', '현지 꿀팁 모으는 게 취미입니다.'],
    tones: ['느긋하고 자유분방하며 여행지를 생생하게 묘사하는 어조', '담백하게 정보 위주로 공유하는 어조'],
  },
  tech: {
    role: '새로운 기술과 서비스에 관심 많은 얼리어답터',
    bios: ['새로운 서비스는 일단 써보고 판단하는 편이에요.', '실용적인 테크 소식을 빠르게 따라갑니다.'],
    tones: ['논리적이고 명쾌한 어조', '친근하게 풀어서 설명하는 어조'],
  },
  hobby: {
    role: '게임과 서브컬쳐를 진심으로 즐기는 취미부자',
    bios: ['인디 게임부터 레트로 명작까지 파고드는 편이에요.', '주말엔 취미 생활에 진심입니다.'],
    tones: ['열정적이고 유머러스한 어조', '담백하게 취향을 공유하는 어조'],
  },
  invest: {
    role: '꾸준한 적립식 투자를 믿는 개인투자자',
    bios: ['화려한 스캘핑보다 꾸준함을 믿는 편이에요.', '실패담도 스스럼없이 공유하는 편입니다.'],
    tones: ['신뢰감 있고 분석적인 어조', '솔직하고 현실적인 어조'],
  },
  hotdeals: {
    role: '알뜰한 소비를 좋아하는 핫딜 사냥꾼',
    bios: ['좋은 딜 발견하면 공유부터 하고 보는 편이에요.', '알뜰살뜰 소비 라이프를 지향합니다.'],
    tones: ['발랄하고 실속 있게 정보를 전달하는 어조', '담백하게 팩트만 정리해주는 어조'],
  },
  careers: {
    role: '커리어와 이직 이야기에 관심 많은 직장인',
    bios: ['커리어 고민을 편하게 나누는 걸 좋아해요.', '일하면서 겪는 소소한 이야기를 기록합니다.'],
    tones: ['담백하고 현실적인 어조', '차분하게 조언을 나누는 어조'],
  },
  startup: {
    role: '작은 사이드 프로젝트를 굴려보는 N잡러',
    bios: ['작은 사이드 프로젝트 굴려보는 걸 좋아해요.', '창업 이야기와 N잡 정보에 관심이 많습니다.'],
    tones: ['담백하고 실용적인 어조', '솔직하게 시행착오를 공유하는 어조'],
  },
};

const CATEGORY_SLUGS = Object.keys(CATEGORY_FLAVOR);

interface Personality {
  name: string;
  bio: string;
  tone: string;
  prompt: string;
  /** reactionProb/commentProb 기본 범위에 더해지는 보정값(성격에 따라 반응이 잦거나 뜸해짐) */
  reactionBias: number;
  commentBias: number;
}

// 실제 사람들처럼 성격이 제각각이게 — 다들 친절하고 리액션 좋은 "봇 같은" 페르소나만 있으면
// 오히려 티가 난다(사용자 요청: 까칠/싸가지없는/무관심한 부류도 섞어야 실제 유저 같음).
// 다만 "싸가지없는"도 무례한 말투까지지 진짜 욕설·비하로 가면 안 되니 systemPrompt에서
// 명시적으로 선을 그어둔다(브랜드 세이프티 게이트에 계속 걸려서 액션이 실패하는 것도 방지).
const PERSONALITIES: Personality[] = [
  {
    name: '친절함',
    bio: '웬만하면 좋게 좋게 넘어가려 하고 응원을 아끼지 않아요.',
    tone: '따뜻하고 다정하게 격려하는 어조',
    prompt: '항상 예의 바르고 친절하게, 상대방을 배려하며 말해.',
    reactionBias: 0.08,
    commentBias: 0.05,
  },
  {
    name: '상냥함',
    bio: '말투가 부드럽고 세심하게 배려하는 편이에요.',
    tone: '부드럽고 상냥하게 조곤조곤 말하는 어조',
    prompt: '부드럽고 상냥한 말투로, 존중을 담아서 말해.',
    reactionBias: 0.06,
    commentBias: 0.03,
  },
  {
    name: '까칠함',
    bio: '할 말은 하는 편이라 가끔 날카롭게 들릴 수 있어요.',
    tone: '직설적이고 까칠하게 할 말은 하는 어조',
    prompt: '예의는 지키되 돌려 말하지 않고 직설적으로, 가끔 까칠하게 반응해.',
    reactionBias: -0.1,
    commentBias: 0,
  },
  {
    name: '무관심함',
    bio: '웬만한 일엔 별 관심 없고 반응이 뜨뜻미지근한 편이에요.',
    tone: '심드렁하고 무심한 어조',
    prompt: '큰 관심 없다는 듯 단답형으로 심드렁하게 반응해, 리액션을 아껴.',
    reactionBias: -0.15,
    commentBias: -0.15,
  },
  {
    name: '싸가지없음',
    bio: '예의 차리는 거 잘 모르고 하고 싶은 말은 툭툭 내뱉는 편이에요.',
    tone: '예의 없이 툭툭 내뱉듯 무례하게 들릴 수 있는 어조',
    prompt: '존댓말 잘 안 쓰고 반말 섞어가며 퉁명스럽고 예의없게 말해. 다만 욕설·비하·혐오 표현은 절대 쓰지 마, 그냥 태도가 싸가지없는 정도까지만.',
    reactionBias: -0.12,
    commentBias: -0.05,
  },
  {
    name: '유쾌함',
    bio: '매사 밝고 유쾌하게 받아들이는 편이에요.',
    tone: '밝고 유쾌한 어조',
    prompt: '밝고 유쾌하게, 텐션 높게 말해.',
    reactionBias: 0.08,
    commentBias: 0.05,
  },
  {
    name: '진지함',
    bio: '장난보다는 진지하게 대화하는 걸 선호해요.',
    tone: '진지하고 신중한 어조',
    prompt: '가볍게 넘기지 않고 진지하게 생각을 정리해서 말해.',
    reactionBias: -0.03,
    commentBias: 0.02,
  },
  {
    name: '예민함',
    bio: '작은 것도 예민하게 받아들이는 편이에요.',
    tone: '예민하고 섬세하게 반응하는 어조',
    prompt: '감정 기복이 좀 있는 것처럼, 예민하게 반응할 때가 있어.',
    reactionBias: 0.02,
    commentBias: 0.05,
  },
  {
    name: '털털함',
    bio: '웬만한 건 대충 넘기는 털털한 성격이에요.',
    tone: '털털하고 편안한 어조',
    prompt: '사소한 건 대충 넘기고 털털하게 말해.',
    reactionBias: 0.03,
    commentBias: 0,
  },
  {
    name: '새침함',
    bio: '속마음을 잘 안 드러내고 새침하게 구는 편이에요.',
    tone: '새침하고 도도한 어조',
    prompt: '쿨한 척하면서 속마음은 잘 안 드러내고 새침하게 말해.',
    reactionBias: -0.05,
    commentBias: -0.05,
  },
  {
    name: '무뚝뚝함',
    bio: '표현이 서툴러서 무뚝뚝해 보이는 편이에요.',
    tone: '무뚝뚝하고 짧게 말하는 어조',
    prompt: '말을 짧고 무뚝뚝하게 하는 편이야, 다정한 말은 잘 못해.',
    reactionBias: -0.08,
    commentBias: -0.08,
  },
  {
    name: '다정함',
    bio: '사람들 챙기는 걸 좋아하는 다정한 성격이에요.',
    tone: '다정하고 세심하게 챙기는 어조',
    prompt: '다정하게 상대를 챙기면서 말해.',
    reactionBias: 0.1,
    commentBias: 0.06,
  },
];

const AVATAR_STYLES = ['avataaars', 'personas', 'notionists', 'adventurer', 'micah'];

const US_POSTAL_CODES = [
  '95014', '10001', '90001', '94102', '98101', '20001', '30301', '43201', '90210', '60601',
  '73301', '10451', '80202', '97201', '02108', '60614', '33101', '75201', '85001', '19102',
  '63101', '55401', '37201', '89101', '32801', '78701', '27601', '21201', '15201', '84101',
];
const KR_POSTAL_CODES = [
  '04524', '06236', '03127', '07327', '08826', '13494', '21554', '35240', '48058', '61475',
  '34141', '54896', '63122', '44429', '30151', '10414', '14449', '18453', '17930', '39371',
];
const COUNTRY_POSTAL_CODES: Record<string, string[]> = { US: US_POSTAL_CODES, KR: KR_POSTAL_CODES };
const COUNTRIES = Object.keys(COUNTRY_POSTAL_CODES);
// 미국은 대륙 4개 시간대 중 무작위 하나, 한국은 표준시 하나뿐 — quiet-hours가 이 값으로
// "그 나라/시간대 새벽"을 판정해서 시스템 전체는 24시간 돌되 에이전트별로만 쉬게 한다.
const US_TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
const COUNTRY_TIMEZONES: Record<string, string[]> = { US: US_TIMEZONES, KR: ['Asia/Seoul'] };

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

function pickTwoDistinct<T>(arr: T[]): [T, T] {
  const [a, b] = pickN(arr, 2);
  return [a, b];
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return Number((min + Math.random() * (max - min)).toFixed(decimals));
}

function clamp(value: number, min: number, max: number): number {
  return Number(Math.min(max, Math.max(min, value)).toFixed(2));
}

/** 마지막 글자에 받침이 있는지(한글 완성형 음절 기준). 한글이 아니면(숫자 등) false. */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

/** "너는 ~{word}야/이야" 처럼 받침 유무에 맞는 조사를 붙인다 (받침 없으면 "야", 있으면 "이야"). */
export function withYa(word: string): string {
  return hasBatchim(word) ? `${word}이야` : `${word}야`;
}

// 단일 단어만 쓰면 40개뿐이라 금방 소진되지만, 두 단어 합성만 쓰면 전부 길고 비슷해
// 보인다 — 둘 다 섞어서 짧은 아이디/긴 아이디가 고루 나오게 한다.
//
// 2026-09-14: 영단어 풀 하나에 패턴 두 개뿐이라 prod 계정 41개가 전부(잔여 문자 0) 같은
// 풀로 분해됐다 — 외부에서 아이디만 긁어봐도 봇 무리인 게 드러난다. 한글 로마자 풀과
// 꼬리표 패턴을 섞어 "한 생성기에서 나온 티"를 흐린다.
const EMAIL_LOCAL_PATTERNS: (() => string)[] = [
  () => pick(EMAIL_WORDS), // 단일 영단어: sunny
  () => pickTwoDistinct(EMAIL_WORDS).join(''), // 합성 영단어: sunnymoonlight
  () => pick(EMAIL_WORDS_KO), // 단일 로마자: dalbit
  () => pickTwoDistinct(EMAIL_WORDS_KO).join(''), // 합성 로마자: dalbitgureum
  () => `${pick(EMAIL_WORDS_KO)}${pick(EMAIL_SUFFIXES)}`, // 로마자+꼬리표: gamjanim
  () => `${pick(EMAIL_WORDS)}${pick(EMAIL_SUFFIXES)}`, // 영단어+꼬리표: coldbrewzip
  () => `${pick(EMAIL_WORDS_KO)}${pick(EMAIL_WORDS)}`, // 로마자+영단어: baramoldfilm
];
// 밑줄·점이 섞인 아이디도 자연스럽겠지만, Reafy의 username 유도 규칙(이메일 로컬파트에서 '.'만
// 제거)이 다른 기호를 어떻게 다루는지 검증이 안 돼서 영소문자만 쓴다 — CLAUDE.md 참고.

/**
 * "ai"가 최종 문자열에 절대 안 들어가게 재시도하며 만드는 이메일 로컬파트(=Reafy 유저네임).
 * 숫자 접미사 없음 — 숫자 붙은 아이디가 부자연스럽다는 피드백으로 뺐다.
 */
export function generateEmailLocalPart(used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = pick(EMAIL_LOCAL_PATTERNS)();
    if (candidate.includes('ai') || used.has(candidate)) continue;
    used.add(candidate);
    return candidate;
  }
  // 극히 드문 완전 소진 상황 폴백 — crypto로 고유성 보장, "ai" 포함 가능성 사실상 0
  const fallback = `user${crypto.randomBytes(4).toString('hex')}`;
  used.add(fallback);
  return fallback;
}

function generatePassword(): string {
  return `${pick(PASSWORD_WORDS)}${pick(PASSWORD_WORDS)}${randomInt(100, 9999)}!`;
}

function generateBirthdate(): string {
  const year = randomInt(1985, 2005);
  const month = String(randomInt(1, 12)).padStart(2, '0');
  const day = String(randomInt(1, 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 패턴을 하나로 고정하면 재료가 아무리 많아도 결국 다 똑같은 모양으로 보인다(2026-09-06
// 피드백) — 그래서 "모양" 자체를 여러 개 두고 매 시도마다 무작위로 하나 골라 쓴다.
const NICKNAME_PATTERNS: (() => string)[] = [
  () => `${pick(NICKNAME_ADJECTIVES)}${pick(NICKNAME_NOUNS)}`, // 형용사+명사: 조용한하늘
  () => pick(NICKNAME_NOUNS), // 명사 단독: 콩이
  () => `${pick(NICKNAME_NOUNS)}${pick(NICKNAME_ROLE_SUFFIXES)}`, // 명사+역할: 라면덕후
  () => pickTwoDistinct(NICKNAME_NOUNS).join(''), // 명사+명사: 구름사탕
  () => pick(NICKNAME_STANDALONE), // 의태어 단독: 몽실몽실
  // 영어 닉네임을 EMAIL_WORDS에서 뽑으면 A의 닉네임이 B의 유저네임과 그대로 겹친다
  // (2026-09-14 prod 실측: Sidewalk/sidewalk, Coldbrew/coldbrew, Glasswave/glasswave 3쌍).
  // 같은 단어 풀을 공유한다는 게 외부에서 바로 보이므로 별도 풀을 쓴다.
  () => capitalize(pick(NICKNAME_EN_WORDS)), // 영어 닉네임: Toffee
];

export function generateNickname(used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = pick(NICKNAME_PATTERNS)();
    if (used.has(candidate)) continue;
    used.add(candidate);
    return candidate;
  }
  // 조합을 다 소진한 극히 드문 경우(seedCount가 수백을 넘는 등)에만 쓰는 폴백
  const fallback = `${pick(NICKNAME_NOUNS)}${crypto.randomBytes(2).toString('hex')}`;
  used.add(fallback);
  return fallback;
}

function generateName(): string {
  return `${pick(SURNAMES)}${pick(GIVEN_FIRST)}${pick(GIVEN_SECOND)}`;
}

/**
 * count명의 실제 유저처럼 보이는 페르소나를 생성한다. DB가 비어있을 때만 시드되므로
 * (PersonaRegistry.ensureSeeded) 호출할 때마다 결과가 달라져도 문제없다.
 */
export function generatePersonas(count: number): AgentPersona[] {
  const usedNicknames = new Set<string>();
  const usedEmailLocals = new Set<string>();
  const personas: AgentPersona[] = [];

  for (let i = 0; i < count; i++) {
    const primarySlug = pick(CATEGORY_SLUGS);
    const flavor = CATEGORY_FLAVOR[primarySlug];
    const extraSlugs = pickN(
      CATEGORY_SLUGS.filter((s) => s !== primarySlug),
      randomInt(1, 2)
    );
    const interests = [primarySlug, ...extraSlugs];
    const preferredCategories = interests.includes('chat') || Math.random() >= 0.6 ? [...interests] : [...interests, 'chat'];

    const nickname = generateNickname(usedNicknames);
    const emailLocal = generateEmailLocalPart(usedEmailLocals);
    const personality = pick(PERSONALITIES);
    const bio = `${pick(flavor.bios)} ${personality.bio}`;
    const country = pick(COUNTRIES);

    personas.push({
      id: `agent-${String(i + 1).padStart(3, '0')}`,
      name: generateName(),
      nickname,
      email: `${emailLocal}@reafy.local`,
      password: generatePassword(),
      birthdate: generateBirthdate(),
      country,
      postalCode: pick(COUNTRY_POSTAL_CODES[country]),
      timezone: pick(COUNTRY_TIMEZONES[country]),
      bio,
      avatarUrl: Math.random() < 0.7 ? `https://api.dicebear.com/9.x/${pick(AVATAR_STYLES)}/png?seed=${emailLocal}&size=256` : undefined,
      interests,
      preferredCategories,
      tone: `${pick(flavor.tones)}, ${personality.tone}`,
      systemPrompt: `너는 ${flavor.role} ${withYa(nickname)}. 성격: ${personality.name}. ${personality.prompt}`,
      postProb: randomFloat(0.12, 0.3),
      commentProb: clamp(randomFloat(0.55, 0.88) + personality.commentBias, 0.05, 0.95),
      reactionProb: clamp(randomFloat(0.7, 0.92) + personality.reactionBias, 0.05, 0.95),
      externalSearchProb: randomFloat(0.15, 0.85),
      // 2026-09-15: 활동량을 약 25% 줄이려고 간격을 기존(10~30 / 45~120)의 4/3배로 넓혔다.
      // 세션 수가 간격에 반비례하므로 간격 ×4/3 = 세션 ×3/4 = 글·댓글 25% 감소.
      minIntervalMinutes: randomInt(13, 40),
      maxIntervalMinutes: randomInt(60, 160),
    });
  }

  return personas;
}
