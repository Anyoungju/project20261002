<template>
  <footer class="footer no-print">
    <div class="container inner">
      <nav class="links" aria-label="도움말">
        <RouterLink to="/manual">사용자 매뉴얼</RouterLink>
        <RouterLink to="/guidelines">이용 가이드라인</RouterLink>
        <RouterLink to="/guidelines#privacy">개인정보·공유 원칙</RouterLink>
        <RouterLink to="/guidelines#billing">이용권·결제</RouterLink>
      </nav>
      <p class="caption">© 2026 Buildcare AI · AI 분석 결과는 이미지 기반 1차 참고용 정보이며 법적·구조적 안전 판정을 대체하지 않습니다.</p>
      <p class="caption">개인정보는 마스킹되어 표시됩니다 · 하자 사진은 권한 확인 후 5분 동안만 열립니다</p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  background: var(--surface-soft);
  border-top: 1px solid var(--hairline);
  margin-top: var(--s-section);
}
.inner {
  padding-top: var(--s-lg);
  padding-bottom: var(--s-lg);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs) var(--s-lg);
  margin-bottom: var(--s-xs);
}
.links a {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  font: var(--t-body-sm);
  font-weight: 700;
  color: var(--ink);
}
</style>
