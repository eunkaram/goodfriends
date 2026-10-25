import type { UserLogProfile } from '../lib/user-log.ts';
import type { GnbCategoryGroup } from './Gnb.tsx';
import { interestEligibleCategories } from '../lib/category-group-colors.ts';
import styles from './ProfileRightSidebar.module.css';

/**
 * goodfriends 우측 프로필 위젯(2026-10, "프로필 페이지의... 오른쪽영역을
 * 디자인 시안대로") — 디코딩 원본 line 858-927: 프로필 화면의 우측 영역은
 * Home·카테고리 피드의 검색+인기글(RightSidebar)이 아니라 통계 카드+관심
 * 분야+스택+활동 히트맵이다(`notProfile`/`showProfile` 분기, line 861/868).
 * app/[category]/UserLogView.tsx가 이 화면에서만 RightSidebar 대신 이걸 쓴다.
 */
export function ProfileRightSidebar({ log, categoryTree }: { log: UserLogProfile; categoryTree: GnbCategoryGroup[] }) {
  const slugToCategory = new Map(interestEligibleCategories(categoryTree).map((c) => [c.slug, c]));
  const stackGroups = Object.entries(log.stack).filter(([, items]) => items.length > 0);

  return (
    <div className={styles.widget}>
      {/* 🔒 디코딩 원본 line 870-877 — 2열 카드 그리드. 원본 mock은 "작성한
          글"·"팔로워" 2개뿐이지만, 이 앱은 이미 좋아요·댓글까지 집계해 둔
          실데이터가 있어(ProfileHeader가 예전에 보여주던 4개 통계) 그대로
          옮겼다 — 2열 그리드라 자연히 2행으로 접힌다. */}
      <div className={styles.statsGrid}>
        <div className={styles.statCell}>
          <div className={styles.statValue}>{log.postCount}</div>
          <div className={styles.statLabel}>작성한 글</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statValue}>{log.followerCount}</div>
          <div className={styles.statLabel}>팔로워</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statValue}>{log.likeCount}</div>
          <div className={styles.statLabel}>좋아요</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statValue}>{log.commentCount}</div>
          <div className={styles.statLabel}>댓글</div>
        </div>
      </div>

      {log.interests.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>관심 분야</span>
          <div className={styles.interestChips}>
            {log.interests.map((slug) => {
              const category = slugToCategory.get(slug);
              if (!category) return null;
              return (
                <a key={slug} className={styles.interestChip} href={`/${category.slug}`}>
                  {category.name}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {stackGroups.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>사용 중인 스택</span>
          <div className={styles.stackGroups}>
            {stackGroups.map(([group, items]) => (
              <div key={group} className={styles.stackGroupRow}>
                <span className={styles.stackGroupLabel}>{group}</span>
                <div className={styles.stackGroupItems}>
                  {items.map((item) => (
                    <span key={item} className={styles.stackChip}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.activityHead}>
          <span className={styles.sectionLabel}>활동 기록</span>
          <span className={styles.activityTotal}>최근 20주 {log.activity.recentTotal}회</span>
        </div>
        <div className={styles.heatmap}>
          {log.activity.recentWeeks.map((week, wi) => (
            <div key={wi} className={styles.heatmapWeek}>
              {week.days.map((day) => (
                <div key={day.date} title={day.count ? `${day.count}회 활동` : '활동 없음'} className={`${styles.heatmapDay} ${styles[`level${day.level}`]}`} />
              ))}
            </div>
          ))}
        </div>
        <div className={styles.heatmapLegend}>
          적음
          {[0, 1, 2, 3, 4].map((level) => (
            <div key={level} className={`${styles.heatmapDay} ${styles[`level${level}`]}`} />
          ))}
          많음
        </div>
      </div>
    </div>
  );
}
