'use strict';
document.getElementById('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=document.getElementById('loginSubmit'),message=document.getElementById('loginMessage'),input=document.getElementById('loginPassword');button.disabled=true;message.textContent='ログインしています…';
 try{
  const response=await fetch('/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value,remember:document.getElementById('loginRemember').checked})});input.value='';
  if(!response.ok){message.textContent=response.status===429?'試行回数の上限です。5分待ってからもう一度お試しください。':'ログインできません。アプリ用パスワードを確認してください。';return;}
  location.replace('/');
 }catch{input.value='';message.textContent='サーバーに接続できません。少し待ってから再試行してください。';}
 finally{button.disabled=false;}
});
// Strict cookies may be omitted on the first navigation from another website.
// Recheck from this same-origin login document to resume a remembered session.
fetch('/auth/session',{credentials:'same-origin',cache:'no-store'}).then(response=>{if(response.ok)location.replace('/');}).catch(()=>{});
