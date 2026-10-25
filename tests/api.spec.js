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
 await page.locator('#sample').click();await connect(page);
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
