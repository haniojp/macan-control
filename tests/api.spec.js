const {test:base,expect}=require('@playwright/test');
const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const servers=new WeakMap();
const KEY='test-bridge-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const response=()=>({schemaVersion:1,fetchedAt:'2026-10-24T00:01:00Z',vehicleTimestamp:'2026-10-24T00:00:00Z',snapshot:{timestamp:'2026-10-24T00:00:00Z',soc:64,rangeKm:280,odometerKm:9000,chargingStatus:'充電中',source:'api'}});
// Real HTTPS + preflight exercises Safari's network stack, not route interception.
// The self-signed key is generated into ignored test output and has no other use.
const test=base.extend({
 bridge: [async({page},use,testInfo)=>{
  const dir=testInfo.outputPath('tls');fs.mkdirSync(dir,{recursive:true});
  const keyPath=path.join(dir,'key.pem'),certPath=path.join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  const state={handler:async()=>({body:response()}),url:''};
  const server=https.createServer({key:fs.readFileSync(keyPath),cert:fs.readFileSync(certPath)},async(req,res)=>{
   const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:8000','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Cache-Control':'no-store'};
   if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
   try{const result=await state.handler({headers:()=>req.headers,method:()=>req.method});res.writeHead(result.status||200,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(result.body));}
   catch{res.writeHead(500,headers);res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));state.url='https://127.0.0.1:'+server.address().port;servers.set(page,state);
  await use(state);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 },{auto:true}]
});
test.use({ignoreHTTPSErrors:true});
async function connect(page){await page.locator('#apiUrl').fill(servers.get(page).url);await page.locator('#apiKey').fill(KEY);await page.locator('#apiConnect').click();}
async function mock(page,handler){servers.get(page).handler=handler;}
test.beforeEach(async({page})=>{await page.goto('./');});
test('API displays vehicle data, polls, and keeps secrets out of backups and storage',async({page})=>{
 let calls=0;await page.clock.install();
 await mock(page,async request=>{expect(request.headers().authorization).toBe('Bearer '+KEY);calls++;return {body:response()};});
 await page.locator('#openDataEntry').click();await page.locator('#sample').click();await page.locator('#backFromData').click();await connect(page);
 await expect(page.locator('#soc')).toHaveText('64%');await expect(page.locator('#charging')).toHaveText('充電中');await expect(page.locator('#updated')).toContainText('車両データ日時');await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 await expect(page.locator('#apiKey')).toHaveValue('');expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(KEY);
 await page.clock.fastForward(300001);await expect.poll(()=>calls).toBe(2);await expect(page.locator('#history tr')).toHaveCount(2);
 const downloadEvent=page.waitForEvent('download');await page.locator('#vehicleBackup').click();const download=await downloadEvent;const json=await require('node:fs/promises').readFile(await download.path(),'utf8');expect(json).not.toContain(KEY);expect(JSON.parse(json).some(row=>row.source==='api')).toBe(true);
 await page.locator('#apiDisconnect').click();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');await page.reload();await expect(page.locator('#apiUrl')).toHaveValue(servers.get(page).url);await expect(page.locator('#apiKey')).toHaveValue('');await expect(page.locator('#connectionStatus')).toHaveText('API未接続');
});
test('captcha is displayed and resumed without exposing auth state',async({page})=>{
 await mock(page,async request=>request.method()==='POST'?{body:response()}:{status:409,body:{code:'CAPTCHA_REQUIRED',captchaImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XsAAAAASUVORK5CYII='}});
 await connect(page);await expect(page.locator('#captchaForm')).toBeVisible();await page.locator('#captchaCode').fill('ABCD');await page.locator('#captchaForm button').click();await expect(page.locator('#soc')).toHaveText('64%');await expect(page.locator('#captchaForm')).toBeHidden();
});
test('failed authentication is explained and missing metrics stay unknown',async({page})=>{
 let fail=true;await mock(page,async()=>fail?{status:401,body:{detail:{code:'BRIDGE_AUTH_REQUIRED'}}}:{body:{...response(),vehicleTimestamp:null,snapshot:{...response().snapshot,soc:null,chargingStatus:null}}});
 await connect(page);await expect(page.locator('#apiMessage')).toContainText('接続キーが一致しません');await expect(page.locator('#soc')).toHaveText('—');
 fail=false;await page.locator('#apiRefresh').click();await expect(page.locator('#range')).toHaveText('280 km');await expect(page.locator('#soc')).toHaveText('—');await expect(page.locator('#charging')).toHaveText('—');await expect(page.locator('#updated')).toContainText('不明');
});
test('disconnect cancels in-flight requests and insecure server URLs are rejected',async({page})=>{
 let release;const pending=new Promise(resolve=>release=resolve);let started=false;
 await mock(page,async()=>{started=true;await pending;return {body:response()};});
 await page.locator('#apiUrl').fill('http://bridge.example');await page.locator('#apiKey').fill(KEY);await page.locator('#apiConnect').click();await expect(page.locator('#apiMessage')).toContainText('https://');expect(started).toBe(false);
 await connect(page);await expect.poll(()=>started).toBe(true);await page.locator('#apiDisconnect').click();release();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');await expect(page.locator('#soc')).toHaveText('—');expect(await page.evaluate(()=>localStorage.getItem('macan-control-records-v1'))).toBeNull();
});

test('trip summaries show four metrics, units and distinct periods',async({page})=>{
 const short={distanceKm:62.4,averageConsumptionKwhPer100Km:20,drivingTimeMinutes:90,averageSpeedKmh:41.6,tripEndTime:'2026-10-25T01:00:00Z'};
 await mock(page,async()=>({body:{...response(),tripStatistics:{status:'available',fetchedAt:'2026-10-25T01:01:00Z',periods:{shortTerm:short,longTerm:{...short,distanceKm:1000,averageConsumptionKwhPer100Km:25},sinceCharge:{...short,distanceKm:120}}}}}));
 await connect(page);await expect(page.locator('#tripConsumption')).toHaveText('20 kWh/100km');await expect(page.locator('#tripEfficiency')).toHaveText('換算：5 km/kWh');await expect(page.locator('#tripDistance')).toHaveText('62.4 km');await expect(page.locator('#tripDuration')).toHaveText('90 分');await expect(page.locator('#tripSpeed')).toHaveText('41.6 km/h');await expect(page.locator('#tripTimestamp')).toContainText('集計データの終了日時');
 await page.locator('#tripPeriod').selectOption('longTerm');await expect(page.locator('#tripDistance')).toHaveText('1,000 km');await expect(page.locator('#tripEfficiency')).toHaveText('換算：4 km/kWh');
 await page.locator('#tripPeriod').selectOption('sinceCharge');await expect(page.locator('#tripDistance')).toHaveText('120 km');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await mock(page,async()=>({status:502,body:{code:'PORSCHE_UNAVAILABLE'}}));await page.locator('#apiRefresh').click();await expect(page.locator('#tripMessage')).toContainText('前回取得した値');await page.locator('#tripPeriod').selectOption('shortTerm');await expect(page.locator('#tripMessage')).toContainText('前回取得した値');
 await page.locator('#apiDisconnect').click();await expect(page.locator('#tripDistance')).toHaveText('未取得');await expect(page.locator('#tripEfficiency')).toHaveText('');
});

test('missing and zero trip metrics are distinct; optional errors preserve battery',async({page})=>{
 let body={...response(),tripStatistics:{status:'available',fetchedAt:response().fetchedAt,periods:{shortTerm:{distanceKm:0,averageConsumptionKwhPer100Km:0,drivingTimeMinutes:null,averageSpeedKmh:null,tripEndTime:null}}}};
 await mock(page,async()=>({body}));await connect(page);
 await expect(page.locator('#tripDistance')).toHaveText('0 km');await expect(page.locator('#tripConsumption')).toHaveText('0 kWh/100km');await expect(page.locator('#tripEfficiency')).toHaveText('');await expect(page.locator('#tripDuration')).toHaveText('未取得');
 await page.locator('#tripPeriod').selectOption('longTerm');await expect(page.locator('#tripMessage')).toContainText('取得できませんでした');await expect(page.locator('#tripDistance')).toHaveText('未取得');
 body={...response(),tripStatistics:{status:'error',fetchedAt:response().fetchedAt,periods:{}}};await page.locator('#apiRefresh').click();await expect(page.locator('#tripMessage')).toContainText('走行統計を取得できませんでした');await expect(page.locator('#soc')).toHaveText('64%');
 body=response();await page.locator('#apiRefresh').click();await expect(page.locator('#tripMessage')).toContainText('サーバーを更新');await expect(page.locator('#soc')).toHaveText('64%');
});

test('remembered connection reconnects after reload and can be removed without backing up the key',async({page})=>{
 let calls=0;await mock(page,async request=>{calls++;expect(request.headers().authorization).toBe('Bearer '+KEY);return {body:response()};});
 await page.locator('#apiRemember').check();await connect(page);await expect(page.locator('#apiRememberMessage')).toContainText('保存しました');
 await expect(page.locator('#apiKey')).toHaveValue('');
 await page.reload();await expect(page.locator('#connectionStatus')).toHaveText('API接続中');await expect.poll(()=>calls).toBe(2);await expect(page.locator('#apiRemember')).toBeChecked();
 const downloadEvent=page.waitForEvent('download');await page.locator('#vehicleBackup').click();const download=await downloadEvent;const json=await require('node:fs/promises').readFile(await download.path(),'utf8');expect(json).not.toContain(KEY);
 await page.locator('#apiForget').click();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');expect(await page.evaluate(()=>localStorage.getItem('macan-control-api-connection-v1'))).toBeNull();
 await page.reload();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');await expect(page.locator('#apiRemember')).not.toBeChecked();expect(calls).toBe(2);
});

test('turning off remember and disconnecting prevent automatic reconnection',async({page})=>{
 await mock(page,async()=>({body:response()}));await page.locator('#apiRemember').check();await connect(page);await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 await page.locator('#apiRemember').uncheck();expect(await page.evaluate(()=>localStorage.getItem('macan-control-api-connection-v1'))).toBeNull();await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 await page.locator('#apiRemember').check();await expect(page.locator('#apiRememberMessage')).toContainText('保存しました');await page.locator('#apiDisconnect').click();await page.reload();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');
});

test('restored keys stay bound to their stored server and invalid keys are forgotten',async({page})=>{
 let invalid=false;await mock(page,async request=>{expect(request.headers().authorization).toBe('Bearer '+KEY);return invalid?{status:401,body:{detail:{code:'BRIDGE_AUTH_REQUIRED'}}}:{body:response()};});
 await page.locator('#apiRemember').check();await connect(page);await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 await page.evaluate(()=>localStorage.setItem('macan-control-api-url-v1','https://wrong.example'));
 await page.reload();await expect(page.locator('#apiUrl')).toHaveValue(servers.get(page).url);await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 invalid=true;await page.locator('#apiRefresh').click();await expect(page.locator('#apiMessage')).toContainText('接続キーが一致しません');expect(await page.evaluate(()=>localStorage.getItem('macan-control-api-connection-v1'))).toBeNull();await page.reload();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');
});

test('storage failures are visible and clearing all data also removes remembered credentials',async({page})=>{
 await mock(page,async()=>({body:response()}));await page.locator('#apiRemember').check();await connect(page);await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 await page.locator('#openMaintenance').click();page.once('dialog',d=>d.accept());await page.locator('#clear').click();await page.locator('#backToVehicle').click();expect(await page.evaluate(()=>localStorage.getItem('macan-control-api-connection-v1'))).toBeNull();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name==='macan-control-api-connection-v1')throw new DOMException('full','QuotaExceededError');return original.call(this,name,value);};});
 await page.locator('#apiRemember').check();await connect(page);await expect(page.locator('#connectionStatus')).toHaveText('API接続中');await expect(page.locator('#apiRememberMessage')).toContainText('保存できませんでした');
});

test('legacy Pages mode explains login migration instead of retrying a saved API key',async({page})=>{
 await mock(page,async()=>({status:401,body:{code:'APP_LOGIN_REQUIRED'}}));
 await connect(page);await expect(page.locator('#apiMessage')).toContainText('ログイン方式に切り替わりました');await expect(page.locator('#appLoginLink')).toBeVisible();await expect(page.locator('#appLoginLink')).toHaveAttribute('href',servers.get(page).url+'/');
});
