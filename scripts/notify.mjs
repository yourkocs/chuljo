// 출조마당 푸시 알림 발송 (GitHub Actions에서 주기 실행)
// 필요한 Secret: FIREBASE_SERVICE_ACCOUNT (Firebase 서비스 계정 키 JSON 전체)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { planNotifications } from './notify-rules.mjs';

const DRY_RUN = process.env.DRY_RUN === '1';
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
// Secret 등록 전에는 실패 메일이 쌓이지 않도록 경고만 남기고 정상 종료
if (!raw) { console.warn('::warning::FIREBASE_SERVICE_ACCOUNT secret이 아직 설정되지 않아 알림 발송을 건너뜁니다'); process.exit(0); }

initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const messaging = getMessaging();
const now = Date.now();

// 첫 실행: 기존 출조에 대해서는 알림을 보내지 않고 '보냄'으로만 기록
const metaRef = db.doc('meta/notify');
const bootstrap = !(await metaRef.get()).exists;

const [tripSnap, userSnap, tokenSnap] = await Promise.all([
  db.collection('trips').get(),
  db.collection('users').get(),
  db.collectionGroup('fcmTokens').get(),
]);
const trips = tripSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const users = userSnap.docs.map(d => ({ kakao: d.id, ...d.data() }));

// kakao → [token문서]
const tokensByUser = new Map();
for (const d of tokenSnap.docs) {
  const kakao = d.ref.parent.parent?.id;
  if (!kakao) continue;
  if (!tokensByUser.has(kakao)) tokensByUser.set(kakao, []);
  tokensByUser.get(kakao).push(d);
}

// 수동 실행 시 테스트 모드: 운영자 기기에만 테스트 알림 발송
const TEST = process.env.TEST_NOTIFY === 'true';
const plans = TEST
  ? [{ tripId: null, flag: 'test', url: '/chuljo/', silent: false,
       recipients: users.filter(u => u.isAdmin).map(u => u.kakao),
       title: '🔔 출조마당 테스트 알림', body: '이 알림이 보이면 푸시 설정이 정상입니다!' }]
  : planNotifications(trips, users, now, { bootstrap });
console.log(`출조 ${trips.length} · 회원 ${users.length} · 토큰 ${tokenSnap.size} · 처리 ${plans.length}건${bootstrap ? ' (첫 실행: 기록만)' : ''}`);

const INVALID = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

for (const p of plans) {
  const tokenDocs = p.recipients.flatMap(k => tokensByUser.get(k) || []);
  console.log(`- [${p.flag}] ${p.tripId} "${p.title}" → 회원 ${p.recipients.length}명 / 기기 ${tokenDocs.length}대${p.silent ? ' (발송 생략)' : ''}`);

  if (!p.silent && tokenDocs.length && !DRY_RUN) {
    for (let i = 0; i < tokenDocs.length; i += 500) {
      const chunk = tokenDocs.slice(i, i + 500);
      // data 전용 메시지: 서비스워커(firebase-messaging-sw.js)가 직접 알림을 표시 (중복 표시 방지)
      const res = await messaging.sendEachForMulticast({
        tokens: chunk.map(d => d.id),
        data: { title: p.title, body: p.body, url: p.url, tag: `${p.tripId}-${p.flag}` },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
      });
      console.log(`  성공 ${res.successCount} / 실패 ${res.failureCount}`);
      // 만료된 토큰 정리
      await Promise.all(res.responses.map((r, j) =>
        !r.success && INVALID.has(r.error?.code) ? chunk[j].ref.delete() : null));
    }
  }
  if (!DRY_RUN && p.tripId) await db.doc(`trips/${p.tripId}`).update({ [`notified.${p.flag}`]: FieldValue.serverTimestamp() });
}

if (bootstrap && !DRY_RUN && !TEST) await metaRef.set({ initializedAt: FieldValue.serverTimestamp() });
