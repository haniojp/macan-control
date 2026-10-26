'use strict';
if(document.documentElement.hasAttribute('data-session-app')){
 const connection=document.getElementById('apiConnection');
 connection.querySelector('h2').textContent='ログイン中';
 connection.querySelector('p').textContent='この画面を開いている間、車両情報を5分ごとに取得します。';
 for(const id of ['apiForm','apiDisconnect','apiForget','apiRememberMessage'])document.getElementById(id).hidden=true;
 const logout=document.createElement('button');logout.type='button';logout.className='secondary';logout.id='appLogout';logout.textContent='ログアウト';connection.append(logout);
 logout.addEventListener('click',async()=>{
  logout.disabled=true;
  try{const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});if(!response.ok)throw Error();location.replace('/login');}
  catch{document.getElementById('apiMessage').textContent='ログアウトできませんでした。通信状態を確認してください。';logout.disabled=false;}
 });
 // Avoid showing a BFCache copy of private UI after logout/session expiry.
 window.addEventListener('pageshow',async event=>{if(event.persisted){document.querySelector('main').hidden=true;try{const response=await fetch('/auth/session',{cache:'no-store'});if(!response.ok){location.replace('/login');return;}document.querySelector('main').hidden=false;}catch{location.replace('/login');}}});
}
