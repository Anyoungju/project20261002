import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { setUnauthorizedHandler } from './api/client';
import { useSession } from './stores/session';
import './styles/tokens.css';
import './styles/base.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// 세션 만료(401) — 현재 경로를 보존한 채 로그인으로. 입력값은 각 화면이 drafts 에 이미 저장(FR-102)
setUnauthorizedHandler(() => {
  const s = useSession(pinia);
  const cur = router.currentRoute.value;
  if (cur.name === 'login') return;
  const wasLoggedIn = s.loggedIn;
  s.me = null;
  s.loaded = false;
  if (wasLoggedIn || cur.meta.permission)
    router.push({ name: 'login', query: { returnTo: cur.fullPath, expired: wasLoggedIn ? '1' : undefined } });
});

app.mount('#app');
