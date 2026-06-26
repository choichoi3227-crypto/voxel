# VOXEL STRIKE — FPS Game
> voxel.io 스타일 브라우저 FPS | Cloudflare 배포 완전 가이드

## 🎮 게임 특징
- **완전한 FPS**: 레이캐스터 3D 렌더링, 실사 조명/안개 효과
- **다중 무기**: AK-47, M4A1, AWP 저격총, MP5, SPAS-12 샷건, Desert Eagle
- **팀 데스매치**: 레드 vs 블루, 5분 라운드
- **9봇 AI**: 패트롤, 추적, 사격, 리스폰
- **20인 멀티플레이**: Cloudflare WebSocket (Durable Objects 없이)
- **6개 서버**: 한국/일본/싱가포르/독일/미국(서부/동부)
- **실시간 기능**: 킬피드, 미니맵, 스코어보드(TAB), 채팅(T)

---

## 🚀 Cloudflare 배포 방법

### 1단계: Wrangler 설치
```bash
npm install -g wrangler
wrangler login
```

### 2단계: KV 네임스페이스 생성 (선택—리더보드용)
```bash
wrangler kv:namespace create "LEADERBOARD"
wrangler kv:namespace create "LEADERBOARD" --preview
```
생성된 ID를 `wrangler.toml`의 `id`와 `preview_id`에 붙여넣기

### 3단계: 배포
```bash
cd voxel-strike
wrangler deploy
```

### 4단계 (선택): 커스텀 도메인
`wrangler.toml`의 routes 주석 해제 후 도메인 입력

---

## 📁 파일 구조
```
voxel-strike/
├── worker.js          # Cloudflare Worker (매칭 + WebSocket 릴레이)
├── wrangler.toml      # 배포 설정
├── public/
│   └── index.html     # 완전한 게임 (렌더러 + 물리 + HUD + 멀티플레이)
└── network.js         # 네트워크 클라이언트 (index.html에 인젝션됨)
```

---

## 🎯 조작법
| 키 | 동작 |
|---|---|
| WASD | 이동 |
| 마우스 | 조준 |
| 좌클릭 | 사격 |
| Shift | 달리기 |
| C | 웅크리기 |
| Space | 점프 |
| R | 재장전 |
| 1-6 | 무기 교체 |
| T | 채팅 |
| TAB | 점수판 |
| ESC | 일시정지/메뉴 |

---

## 🔫 무기 스펙
| 무기 | 데미지 | 연사 | 탄창 | 특징 |
|---|---|---|---|---|
| AK-47 | 28 | 600rpm | 30 | 기본 돌격소총 |
| M4A1 | 24 | 700rpm | 30 | 고속 돌격소총 |
| AWP | 120 | 50rpm | 5 | 원샷 저격총 |
| MP5 | 18 | 900rpm | 30 | 초고속 SMG |
| SPAS-12 | 15×9 | 70rpm | 8 | 산탄총 |
| Desert Eagle | 55 | 200rpm | 7 | 강력 권총 |

---

## 🌐 서버 아키텍처 (Durable Objects 없이)
```
클라이언트 → Cloudflare Worker (WebSocket)
                    ↓
              in-memory rooms Map
              (isolate당 상태, 자동 샤딩)
                    ↓
              WebSocket 브로드캐스트 (p2p-like relay)
```

### 왜 이 방식이 빠른가
- Durable Objects 없이 Worker isolate 메모리 직접 사용
- 레이턴시 없는 같은 프로세스 내 브로드캐스트
- 클라이언트 사이드 예측 + 서버 사이드 검증으로 lag compensation
- 이동 패킷 10Hz 전송, 총알은 클라이언트에서 즉시 처리

### 주의사항
- Workers는 재시작 시 메모리 초기화됨 (정상—방이 자동 재생성)
- 장기 영구 데이터(리더보드)는 KV에 저장
- 지역별 라우팅으로 핑 최소화

---

## 🏆 리텐션 향상 시스템
- **매치 종료 후 자동 리스폰**: 끊김 없는 플레이
- **킬 피드 + 알림**: 즉각적인 피드백
- **K/D 스탯 추적**: 경쟁 동기
- **팀 밸런싱**: 자동 팀 배정
- **다양한 무기**: 전략적 선택지
- **봇 AI**: 혼자서도 재미있게

---

## ⚡ 성능 최적화
- 소프트웨어 레이캐스터 (GPU 없이도 60fps)
- 컬럼 단위 렌더링 (DDA 알고리즘)
- 파티클 pool 재활용
- 이동 패킷 100ms 인터벌 (10fps 위치 동기화)
- requestAnimationFrame 기반 게임 루프
