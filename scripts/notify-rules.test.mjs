import test from 'node:test';
import assert from 'node:assert/strict';
import { planNotifications } from './notify-rules.mjs';

// 2026-10-11 10:00 KST
const NOW = Date.parse('2026-10-11T01:00:00Z');
const H = 3600000;
const users = [{ kakao: 'admin' }, { kakao: 'u1' }, { kakao: 'u2', notifPrefs: { newtrip: false } }, { kakao: 'u3' }];
const base = { title: '광어', date: '2026-10-20', location: '인천', capacity: 3, createdBy: 'admin', applicants: [] };
const plan = (trips, opt) => planNotifications(trips, users, NOW, opt);

test('새 출조 공개: 등록자·수신거부 제외, 한 번만', () => {
  const [p] = plan([{ ...base, id: 't', createdAt: NOW - H }]);
  assert.equal(p.flag, 'open'); assert.equal(p.silent, false);
  assert.deepEqual(p.recipients, ['u1', 'u3']);
  assert.equal(p.url, '/chuljo/?trip=t');
  assert.equal(plan([{ ...base, id: 't', createdAt: NOW - H, notified: { open: 1 } }]).length, 0);
});

test('공개 예정 출조는 공개 시각 전엔 알리지 않음', () => {
  assert.equal(plan([{ ...base, id: 't', openAt: NOW + H }]).length, 0);
  const [p] = plan([{ ...base, id: 't', openAt: NOW - 5 * 60000, createdAt: NOW - 72 * H }]);
  assert.equal(p.flag, 'open'); assert.equal(p.silent, false); // 3일 전 등록이어도 방금 공개됐으면 발송
});

test('하루 넘게 지난 공개 / 첫 실행은 기록만', () => {
  assert.equal(plan([{ ...base, id: 't', createdAt: NOW - 30 * H }])[0].silent, true);
  assert.ok(plan([{ ...base, id: 't', createdAt: NOW - H }], { bootstrap: true }).every(p => p.silent));
});

test('모집 마감: 신청자에게만', () => {
  const t = { ...base, id: 't', notified: { open: 1 }, applicants: [{ kakao: 'u1' }, { kakao: 'u2' }, { kakao: 'u3' }] };
  const [p] = plan([t]);
  assert.equal(p.flag, 'closed'); assert.deepEqual(p.recipients, ['u1', 'u2', 'u3']);
  assert.equal(plan([{ ...t, applicants: [{ kakao: 'u1' }], closed: true }])[0].recipients.join(), 'u1');
});

test('마감 임박: 전날 8시 이후, 미신청자에게', () => {
  const t = { ...base, id: 't', deadline: '2026-10-12', notified: { open: 1 }, applicants: [{ kakao: 'u1' }] };
  const [p] = plan([t]);
  assert.equal(p.flag, 'deadline'); assert.deepEqual(p.recipients, ['u2', 'u3']);
  // 07:00 KST엔 아직
  assert.equal(planNotifications([t], users, Date.parse('2026-10-10T22:00:00Z')).length, 0);
});

test('지난 출조·취소 출조는 무시', () => {
  assert.equal(plan([{ ...base, id: 't', date: '2026-10-10', createdAt: NOW }]).length, 0);
  assert.equal(plan([{ ...base, id: 't', status: 'cancelled', createdAt: NOW, closed: true }]).length, 0);
});
