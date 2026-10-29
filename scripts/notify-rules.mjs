// 알림 판단 로직 (Firebase와 무관한 순수 함수 — 테스트 용이)
// 날짜 판단은 앱(index.html)의 isOpen / isFull / isPastDeadline / isPast 와 동일한 기준을 사용

const DAY = 86400000;
const KST = 9 * 3600000;

const kstDate = ms => new Date(ms + KST).toISOString().slice(0, 10); // 'YYYY-MM-DD' (한국 날짜)
const kstHour = ms => new Date(ms + KST).getUTCHours();

export const isOpen = (t, now) => !t.openAt || now >= t.openAt;
export const isFull = t => (t.applicants || []).length >= (t.capacity || 0);
// 마감일 당일 23:59:59(한국 시간)까지 모집 — 앱과 같은 기준
export const isPastDeadline = (t, now) => !!t.deadline && Date.parse(`${t.deadline}T23:59:59+09:00`) < now;
export const isPast = (t, now) => !!t.date && t.date < kstDate(now);
const isCancelled = t => typeof t.status === 'string' && t.status.startsWith('cancelled');
const createdMs = t => t.createdAt?.toMillis?.() ?? (typeof t.createdAt === 'number' ? t.createdAt : null);

const fmtDate = ds => { const p = (ds || '').split('-'); return p.length === 3 ? `${+p[1]}월 ${+p[2]}일` : ''; };

/**
 * @param trips  [{id, ...tripData}]
 * @param users  [{kakao, notifPrefs}]
 * @param now    ms
 * @returns [{ tripId, flag, recipients: [kakao], title, body, silent }]
 *   flag: trips/{id}.notified.<flag> 에 기록할 키 (중복 발송 방지)
 *   silent: true면 발송하지 않고 기록만 (오래된 출조 / 첫 실행)
 */
export function planNotifications(trips, users, now, { bootstrap = false } = {}) {
  const out = [];
  const prefOn = (u, key) => u.notifPrefs?.[key] !== false; // 기본값: 수신
  const tomorrow = kstDate(now + DAY);

  for (const t of trips) {
    const sent = t.notified || {};
    const applicants = new Set((t.applicants || []).map(a => a.kakao));

    // ⑤ 후기 설문 (출조일이 지난 뒤에도 발송) → 링크 누르면 바로 설문 화면
    const rv = t.review;
    if (rv && !isCancelled(t)) {
      const rvUrl = `/chuljo/?review=${t.id}`;
      const reviewed = k => !!t.reviews?.[k]?.ship;
      const reviewOpen = rv.status === 'open' && now < (rv.closeAt || 0);
      if (reviewOpen && !sent.review) {
        out.push({
          tripId: t.id, flag: 'review', url: rvUrl, silent: bootstrap,
          recipients: users.filter(u => applicants.has(u.kakao) && !reviewed(u.kakao) && prefOn(u, 'confirm')).map(u => u.kakao),
          title: '📝 출조 후기를 남겨주세요',
          body: `${t.title} 어떠셨나요? 선박·조과·운영 후기 2분이면 끝나요!`,
        });
      }
      // 하루 지나도 안 쓴 사람에게 한 번 더
      if (reviewOpen && sent.review && !sent.review2 && now - (rv.openedAt || 0) >= DAY) {
        out.push({
          tripId: t.id, flag: 'review2', url: rvUrl, silent: bootstrap,
          recipients: users.filter(u => applicants.has(u.kakao) && !reviewed(u.kakao) && prefOn(u, 'confirm')).map(u => u.kakao),
          title: '📝 후기 마감 전 참여 부탁드려요',
          body: `${t.title} 후기가 데이터로 쌓여 다음 출조 선박 선정에 쓰입니다. 2분만 내주세요!`,
        });
      }
      // 조과 순위 확정 → 상위자에게 장비 설문 요청
      if (rv.top?.length && !sent.tackle) {
        out.push({
          tripId: t.id, flag: 'tackle', url: rvUrl, silent: bootstrap,
          recipients: rv.top.map(x => x.kakao).filter(k => !t.reviews?.[k]?.tackle && users.some(u => u.kakao === k)),
          title: '🏆 조과 상위 축하드려요!',
          body: `${t.title} 조과 상위에 선정되셨어요. 로드·릴·합사·에기·액션 장비 설문을 부탁드려요!`,
        });
      }
    }

    if (isPast(t, now) || isCancelled(t)) continue;
    const url = `/chuljo/?trip=${t.id}`;

    // ① 새 출조 공개 → 전체 회원 (등록자 제외)
    if (!sent.open && isOpen(t, now)) {
      const openedAt = t.openAt || createdMs(t) || 0;
      out.push({
        tripId: t.id, flag: 'open', url,
        silent: bootstrap || now - openedAt > DAY, // 하루 넘게 지난 공개는 알리지 않음
        recipients: users.filter(u => u.kakao !== t.createdBy && prefOn(u, 'newtrip')).map(u => u.kakao),
        title: '🎣 새 출조가 열렸어요',
        body: `${t.title} · ${fmtDate(t.date)} ${t.location || ''} (${(t.applicants || []).length}/${t.capacity}명) 선착순 신청하세요!`,
      });
    }

    // ② 모집 마감 → 신청자에게 채팅방 안내
    if (!sent.closed && isOpen(t, now) && (t.closed || isFull(t) || isPastDeadline(t, now))) {
      out.push({
        tripId: t.id, flag: 'closed', url, silent: bootstrap,
        recipients: users.filter(u => applicants.has(u.kakao) && prefOn(u, 'confirm')).map(u => u.kakao),
        title: '✅ 모집 마감 · 채팅방 오픈',
        body: `${t.title} 모집이 마감되었습니다. ${t.kakaoLink ? '오픈채팅방에 입장해주세요!' : '출조 정보를 확인해주세요.'}`,
      });
    }

    // ③ 마감 임박 (마감 전날 오전 8시 이후) → 아직 신청 안 한 회원
    if (!sent.deadline && t.deadline === tomorrow && kstHour(now) >= 8 && isOpen(t, now)
        && !t.closed && !isFull(t) && !isPastDeadline(t, now)) {
      out.push({
        tripId: t.id, flag: 'deadline', url, silent: bootstrap,
        recipients: users.filter(u => !applicants.has(u.kakao) && u.kakao !== t.createdBy && prefOn(u, 'deadline')).map(u => u.kakao),
        title: '⏰ 내일 신청 마감',
        body: `${t.title} · 남은 자리 ${Math.max(0, (t.capacity || 0) - applicants.size)}석. 마감 전에 신청하세요!`,
      });
    }

    // ④ 자리배치: 선수 지원 시작 / 추첨 완료 → 신청자
    const seatTo = users.filter(u => applicants.has(u.kakao) && prefOn(u, 'confirm')).map(u => u.kakao);
    if (!sent.bowOpen && t.seating?.status === 'recruiting') {
      out.push({
        tripId: t.id, flag: 'bowOpen', url, silent: bootstrap, recipients: seatTo,
        title: '🪑 선수 자리 지원 시작',
        body: `${t.title} 자리배치가 시작되었습니다. 선수 자리를 원하시면 추첨 전에 지원하세요! (선수 ${t.seating.bow || 0}석)`,
      });
    }
    if (!sent.seat && t.seating?.status === 'drawn') {
      out.push({
        tripId: t.id, flag: 'seat', url, silent: bootstrap, recipients: seatTo,
        title: '🎲 자리 추첨 완료',
        body: `${t.title} 자리 추첨이 끝났습니다. 내 자리 번호를 확인하세요!`,
      });
    }
  }
  return out;
}
