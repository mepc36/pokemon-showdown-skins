(() => {
  const params = new URLSearchParams(location.search);
  const data = {type: 'ps-oauth'};
  for (const key of ['state', 'assertion', 'token', 'user']) data[key] = params.get(key);
  history.replaceState(null, '', location.pathname);
  if (window.opener) window.opener.postMessage(data, location.origin);
  else document.getElementById('message').textContent = 'Return to the app and try Sign in again. Keep the app tab open during authorization.';
})();
