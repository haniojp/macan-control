const {test,expect}=require('@playwright/test');
const URL='https://bridge.example';
const KEY='test-bridge-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const response=()=>({schemaVersion:1,fetchedAt:'2026-10-24T00:01:00Z',vehicleTimestamp:'2026-10-24T00:00:00Z',snapshot:{timestamp:'2026-10-24T00:00:00Z',soc:64,rangeKm:280,odometerKm:9000,chargingStatus:'充電中',source:'api'}});
async function connect(page){await page.locator('#apiUrl').fill(URL);await page.locator('#apiKey').fill(KEY);await page.locator('#apiConnect').click();}
async function mock(page,handler){await page.route(URL+'/api/**',async route=>{
 const result=await handler(route.request());await route.fulfill({status:result.status||200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:8000'},body:JSON.stringify(result.body)});
});}
test.beforeEach(async({page})=>{await page.goto('./');});
test('API displays vehicle data, polls, and keeps secrets out of backups and storage',async({page})=>{
 let calls=0;await page.clock.install();
 await mock(page,async request=>{expect(request.headers().authorization).toBe('Bearer '+KEY);calls++;return {body:response()};});
 await page.locator('#sample').click();await connect(page);
 await expect(page.locator('#soc')).toHaveText('64%');await expect(page.locator('#charging')).toHaveText('充電中');await expect(page.locator('#updated')).toContainText('車両データ日時');await expect(page.locator('#connectionStatus')).toHaveText('API接続中');
 await expect(page.locator('#apiKey')).toHaveValue('');expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(KEY);
 await page.clock.fastForward(300001);await expect.poll(()=>calls).toBe(2);await expect(page.locator('#history tr')).toHaveCount(2);
 const downloadEvent=page.waitForEvent('download');await page.locator('#vehicleBackup').click();const download=await downloadEvent;const json=await require('node:fs/promises').readFile(await download.path(),'utf8');expect(json).not.toContain(KEY);expect(JSON.parse(json).some(row=>row.source==='api')).toBe(true);
 await page.locator('#apiDisconnect').click();await expect(page.locator('#connectionStatus')).toHaveText('API未接続');await page.reload();await expect(page.locator('#apiUrl')).toHaveValue(URL);await expect(page.locator('#apiKey')).toHaveValue('');await expect(page.locator('#connectionStatus')).toHaveText('API未接続');
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
