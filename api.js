'use strict';
// The bridge key and Porsche tokens are never written to browser storage.
(() => {
 const URL_KEY='macan-control-api-url-v1';
 const messages={
  BRIDGE_AUTH_REQUIRED:'接続キーが一致しません。サーバーのBRIDGE_ACCESS_KEYを確認してください。',
  AUTH_REQUIRED:'Porscheの認証が完了しませんでした。サーバーのPorsche ID設定を確認してください。追加認証や非対応の認証方式が原因の場合もあります。',
  CAPTCHA_REQUIRED:'Porscheの追加認証が必要です。画像の文字を入力してください。',
  CAPTCHA_EXPIRED:'認証画像の有効期限が切れました。「今すぐ取得」で新しい認証を開始してください。',
  SELECT_VEHICLE:'複数の車両があります。サーバーのPORSCHE_VINに対象車両のVINを設定してください。',
  NO_VEHICLE:'対象車両が見つかりません。Porsche Connectの契約とアカウントを確認してください。',
  NO_VEHICLE_DATA:'車両データが取得できませんでした。車両の通信状態とプライバシー設定を確認してください。',
  INVALID_VEHICLE_DATA:'車両データの形式が未対応です。',
  INVALID_VIN:'サーバーに設定したVINを確認してください。',
  RETRY_LATER:'しばらく待ってから取得してください。',
  UPSTREAM_RATE_LIMIT:'Porsche側の取得回数制限です。5分以上待って再試行してください。',
  PORSCHE_UNAVAILABLE:'Porscheとの通信に失敗しました。最後に取得した値を表示しています。',
  PORSCHE_TIMEOUT:'Porscheからの応答がありません。最後に取得した値を表示しています。'
 };
 let endpoint='', key='', timer=null, controller=null, generation=0, busy=false, lastSignature='', tripStatistics=null, tripStale=false;
 try { $('apiUrl').value=localStorage.getItem(URL_KEY)||''; } catch {}
 const status=text=>$('apiMessage').textContent=text;
 function schedule(){clearTimeout(timer);if(key)timer=setTimeout(()=>{if(!document.hidden)refresh();else schedule();},300000);}
 function controls(){ $('apiConnect').disabled=busy;$('apiRefresh').disabled=busy||!key;$('apiDisconnect').disabled=!key; }
 function renderTrips(){
  const selected=$('tripPeriod').value;
  const row=tripStatistics?.periods?.[selected];
  const safe=(value,minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isFinite(value)&&value>=minimum&&value<=maximum?value:null;
  const consumption=safe(row?.averageConsumptionKwhPer100Km,-1000,1000);
  const distance=safe(row?.distanceKm),minutes=safe(row?.drivingTimeMinutes),speed=safe(row?.averageSpeedKmh);
  const format=(value,unit)=>value===null?'未取得':value.toLocaleString('ja-JP',{maximumFractionDigits:1})+unit;
  $('tripConsumption').textContent=format(consumption,' kWh/100km');
  $('tripEfficiency').textContent=consumption!==null&&consumption>0&&Number.isFinite(100/consumption)?'換算：'+(100/consumption).toLocaleString('ja-JP',{maximumFractionDigits:2})+' km/kWh':'';
  $('tripDistance').textContent=format(distance,' km');
  $('tripDuration').textContent=minutes===null?'未取得':minutes.toLocaleString('ja-JP',{maximumFractionDigits:1})+' 分';
  $('tripSpeed').textContent=format(speed,' km/h');
  const hasValues=[consumption,distance,minutes,speed].some(value=>value!==null);
  $('tripMessage').textContent=!key?'Porsche Connectに接続すると走行統計を取得します。':!tripStatistics?'走行統計は未取得です。サーバーを更新済みか確認してください。':tripStale?'更新できていません。走行統計は前回取得した値です。':tripStatistics.status==='error'?'走行統計を取得できませんでした。車両情報の取得は継続しています。':!hasValues?'選択した集計の走行統計は、この車両のAPIから取得できませんでした。':'車両から取得した走行統計です。取得できない項目は「未取得」と表示します。';
  const end=typeof row?.tripEndTime==='string'&&Number.isFinite(Date.parse(row.tripEndTime))?dt(row.tripEndTime):'不明';
  $('tripTimestamp').textContent=tripStatistics?'取得日時：'+(typeof tripStatistics.fetchedAt==='string'&&Number.isFinite(Date.parse(tripStatistics.fetchedAt))?dt(tripStatistics.fetchedAt):'不明')+' / 集計データの終了日時：'+end:'';
 }
 $('tripPeriod').addEventListener('change',renderTrips);
 function disconnect(){generation++;controller?.abort();controller=null;clearTimeout(timer);key='';endpoint='';busy=false;liveSnapshot=null;tripStatistics=null;tripStale=false;renderTrips();$('apiKey').value='';$('captchaCode').value='';$('captchaForm').hidden=true;$('captchaImage').removeAttribute('src');$('connectionStatus').textContent='API未接続';controls();render();status('接続を解除しました。保存済みの記録は端末に残ります。');}
 function apply(data){
  if(data.schemaVersion!==1||!data.snapshot||!Number.isFinite(Date.parse(data.fetchedAt))||!(data.vehicleTimestamp===null||typeof data.vehicleTimestamp==='string'&&Number.isFinite(Date.parse(data.vehicleTimestamp))))throw Error('応答の形式が未対応です。');
  for(const field of ['soc','rangeKm','odometerKm'])if(data.snapshot[field]!==null&&typeof data.snapshot[field]!=='number')throw Error('応答の数値が不正です。');
  const entry=validate({...data.snapshot,source:'api'});
  liveSnapshot={...entry,fetchedAt:data.fetchedAt,vehicleTimestamp:data.vehicleTimestamp};
  const signature=JSON.stringify([data.vehicleTimestamp,entry.soc,entry.rangeKm,entry.odometerKm,entry.chargingStatus]);
  let warning='';
  if(signature!==lastSignature){
   try{const rows=getRecords();const previous=rows.filter(r=>r.source==='api').pop();
    if(!previous||previous.timestamp!==entry.timestamp||previous.soc!==entry.soc||previous.rangeKm!==entry.rangeKm||previous.odometerKm!==entry.odometerKm||previous.chargingStatus!==entry.chargingStatus){rows.push(entry);rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));saveRecords(rows);}
    lastSignature=signature;
   }catch(err){warning='\n取得できましたが、履歴の保存に失敗しました：'+err.message;}
  }
  tripStale=false;tripStatistics=data.tripStatistics&&typeof data.tripStatistics==='object'&&!Array.isArray(data.tripStatistics)?data.tripStatistics:null;renderTrips();
  render();$('connectionStatus').textContent='API接続中';
  const old=data.vehicleTimestamp&&Date.now()-Date.parse(data.vehicleTimestamp)>30*60*1000;
  status('取得しました。画面を開いている間、5分ごとに更新します。'+(old?'\n車両データは30分以上前の値です。':!data.vehicleTimestamp?'\n車両の測定時刻は不明です。現在値とは限りません。':'')+warning);
  $('captchaForm').hidden=true;$('captchaImage').removeAttribute('src');$('captchaCode').value='';
 }
 async function refresh(captcha){
  if(!key||busy)return;
  if(!navigator.onLine){status('オフラインです。保存済みの記録を表示しています。');$('connectionStatus').textContent='API通信待ち';if(tripStatistics){tripStale=true;renderTrips();}schedule();return;}
  const current=generation;busy=true;controls();clearTimeout(timer);status('車両情報を取得しています。初回のサーバー起動には時間がかかる場合があります。');
  controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),90000);let retry=true;
  try {
   const response=await fetch(endpoint+(captcha?'/api/auth/captcha':'/api/snapshot'),{method:captcha?'POST':'GET',headers:{Authorization:'Bearer '+key,...(captcha?{'Content-Type':'application/json'}:{})},...(captcha?{body:JSON.stringify({code:captcha})}:{}),mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
   const data=await response.json();if(current!==generation)return;
   if(!response.ok){
    const code=data.code||data.detail?.code;
    if(code==='CAPTCHA_REQUIRED'&&typeof data.captchaImage==='string'&&data.captchaImage.length<=512000&&/^data:image\/(png;base64,|jpeg;base64,|svg\+xml)/.test(data.captchaImage)){$('captchaImage').src=data.captchaImage;$('captchaForm').hidden=false;}
    retry=!['CAPTCHA_REQUIRED','AUTH_REQUIRED','BRIDGE_AUTH_REQUIRED','SELECT_VEHICLE','INVALID_VIN'].includes(code);
    $('connectionStatus').textContent='API取得停止';throw Error(messages[code]||'サーバーの応答を確認できません。接続先の設定を確認してください。');
   }
   apply(data);
  } catch(err){if(current===generation){$('connectionStatus').textContent='API通信待ち';if(tripStatistics){tripStale=true;renderTrips();}status(err.name==='AbortError'?'接続がタイムアウトしました。少し待って「今すぐ取得」を押してください。':err instanceof TypeError?'接続できません。接続先URL・サーバーの起動状態・ALLOWED_ORIGIN設定を確認してください。':err.message);}}
  finally{clearTimeout(timeout);if(current===generation){busy=false;controller=null;controls();if(retry)schedule();}}
 }
 $('apiForm').addEventListener('submit',event=>{
  event.preventDefault();
  try{
   const url=new URL($('apiUrl').value.trim());
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!==''))throw Error('接続先はhttps://で始まるサーバーURLを入力してください。パスやクエリは不要です。');
   const nextKey=$('apiKey').value.trim();if(nextKey.length<32)throw Error('接続キーはサーバーに表示された32文字以上の値を入力してください。');
   disconnect();endpoint=url.origin;key=nextKey;lastSignature='';$('apiKey').value='';
   try{localStorage.setItem(URL_KEY,endpoint);}catch{}
   controls();refresh();
  }catch(err){status(err.message);}
 });
 $('apiRefresh').addEventListener('click',()=>refresh());
 $('apiDisconnect').addEventListener('click',disconnect);
 $('captchaForm').addEventListener('submit',event=>{event.preventDefault();refresh($('captchaCode').value.trim());});
 window.addEventListener('macan:clear',disconnect);
 document.addEventListener('visibilitychange',()=>{if(key&&!document.hidden&&!busy&&$('captchaForm').hidden)refresh();});
})();
