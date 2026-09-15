# 버스정보시스템

대구·구미 실시간 버스 위치 및 도착정보 웹 서비스

## 배포 주소

https://wv1788771640985873.zaemit.ai/

## 주요 기능

- 대구(cityCode 22)·구미(cityCode 37050) 동시 정류소/노선 검색
- 실시간 버스 도착정보 (5초 간격 갱신)
- 카카오맵 기반 실시간 버스 위치 표시
  - 대구: TAGO API GPS 좌표 직접 사용
  - 구미: TAGO API가 GPS 대신 최근 통과 정류소(nodeid)만 제공하므로, 노선 정류소 목록과 매칭해 좌표로 환산
  - requestAnimationFrame + easeInOutQuad로 60fps 부드러운 이동 애니메이션
  - 진행 방향에 따라 버스 아이콘 회전 (bearing 계산)
  - 노선 타입(일반/좌석/급행/마을버스)에 따른 색상 구분
- 노선도 모달: 노선 전체 정류소 목록 + 현재 버스 위치 표시
- ODsay API 기반 대중교통 길찾기 (실제 도로 경로 그래픽)
- 즐겨찾기 (도시+노선번호 쌍으로 저장, localStorage)
- 모바일 반응형 레이아웃 (하단 탭바 + FAB)

## 기술 스택

- Vanilla JavaScript (프레임워크 없음)
- Kakao Maps SDK
- TAGO 대중교통정보 공공데이터 API
- ODsay 길찾기 API

## 파일 구성

- `index.html` — 마크업
- `style.css` — 스타일
- `script.js` — 전체 애플리케이션 로직

## API 키 안내

`script.js`에 포함된 TAGO/ODsay/Kakao API 키는 개발용 키입니다. 실제 운영 시 본인 키로 교체하세요.
