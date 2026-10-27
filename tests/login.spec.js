const {test,expect}=require('@playwright/test');
const URL='https://127.0.0.1:8444';
const PASSWORD='test-app-password-12345';
test.use({ignoreHTTPSErrors:true});
async function login(page){await page.goto(URL+'/');await expect(page).toHaveURL(URL+'/login');await page.locator('#loginPassword').fill(PASSWORD);await page.locator('#loginSubmit').click();await expect(page).toHaveURL(URL+'/');await expect(page.locator('#soc')).toHaveText('64%');}

test('private app requires login, keeps remembered login and uses no stored API key',async({page,context})=>{
 await login(page);
 await expect(page.locator('#apiForm')).toBeHidden();await expect(page.locator('#appLogout')).toBeVisible();
 expect(await page.evaluate(()=>document.cookie)).not.toContain('macan-session');
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(PASSWORD);
 expect(await page.evaluate(()=>localStorage.getItem('macan-control-api-connection-v1'))).toBeNull();
 const cookie=(await context.cookies()).find(c=>c.name==='__Host-macan-session');expect(cookie.httpOnly).toBe(true);expect(cookie.secure).toBe(true);expect(cookie.sameSite).toBe('Strict');expect(cookie.expires).toBeGreaterThan(Date.now()/1000+29*86400);
 await page.reload();await expect(page.locator('#soc')).toHaveText('64%');await expect(page).toHaveURL(URL+'/');
 const next=await context.newPage();await next.goto(URL+'/');await expect(next.locator('#soc')).toHaveText('64%');await next.close();
 await expect.poll(()=>page.evaluate(async()=>((await navigator.serviceWorker.getRegistrations()).length))).toBe(0);
});

test('logout and API session expiry return to login without showing private records',async({page,context})=>{
 await login(page);await page.locator('#appLogout').click();await expect(page).toHaveURL(URL+'/login');await page.goto(URL+'/');await expect(page).toHaveURL(URL+'/login');
 await page.locator('#loginPassword').fill(PASSWORD);await page.locator('#loginSubmit').click();await expect(page.locator('#soc')).toHaveText('64%');
 await context.clearCookies();await page.locator('#apiRefresh').click();await expect(page).toHaveURL(URL+'/login');await expect(page.locator('#soc')).toHaveCount(0);
});

test('wrong passwords are explained, and remember can be disabled',async({page,context})=>{
 await page.goto(URL+'/login');await page.locator('#loginPassword').fill('incorrect-test-password');await page.locator('#loginSubmit').click();await expect(page.locator('#loginMessage')).toContainText('パスワードを確認');await expect(page.locator('#loginPassword')).toHaveValue('');
 await page.locator('#loginRemember').uncheck();await page.locator('#loginPassword').fill(PASSWORD);await page.locator('#loginSubmit').click();await expect(page.locator('#soc')).toHaveText('64%');
 const cookie=(await context.cookies()).find(c=>c.name==='__Host-macan-session');expect(cookie.expires).toBe(-1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('real server gives old Pages app a login link through CORS preflight without granting API access',async({page})=>{
 await page.goto('./');await page.locator('#apiUrl').fill(URL);await page.locator('#apiKey').fill('test-bridge-key-'+('x'.repeat(40)));await page.locator('#apiConnect').click();await expect(page.locator('#appLoginLink')).toBeVisible();await expect(page.locator('#appLoginLink')).toHaveAttribute('href',URL+'/');await expect(page.locator('#soc')).toHaveText('—');
});

test('logged-in app opens maintenance without losing session or saved records',async({page})=>{
 await login(page);await expect(page.locator('#maintenanceForm')).toBeHidden();await page.locator('#openMaintenance').click();await expect(page.locator('#maintenanceForm')).toBeVisible();await expect(page.locator('#apiConnection')).toBeHidden();
 await page.locator('#maintenanceForm [name=date]').fill('2026-10-26');await page.locator('#maintenanceForm [name=part]').fill('交換済みワイパー');await page.locator('#maintenanceSubmit').click();await expect(page.locator('.maintenance-card')).toContainText('交換済みワイパー');
 await page.reload();await expect(page.locator('.maintenance-card')).toContainText('交換済みワイパー');await page.locator('#backToVehicle').click();await expect(page.locator('#soc')).toHaveText('64%');await expect(page.locator('#appLogout')).toBeVisible();
});

test('logged-in app adds vehicle data on its own screen and preserves the session',async({page})=>{
 await login(page);await expect(page.locator('#manual')).toBeHidden();await page.locator('#openDataEntry').click();await expect(page.locator('#manual')).toBeVisible();await expect(page.locator('#apiConnection')).toBeHidden();
 await page.locator('#manual [name=soc]').fill('75');await page.locator('#manual [name=chargingStatus]').fill('手入力で確認');await page.locator('#manual button').click();await expect(page.locator('#message')).toContainText('記録を保存しました');
 await page.locator('#backFromData').click();await expect(page.locator('#appLogout')).toBeVisible();const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('macan-control-records-v1')));expect(records.some(r=>r.source==='manual'&&r.soc===75)).toBe(true);
 await page.reload();await expect(page.locator('#appLogout')).toBeVisible();await expect(page.locator('#openDataEntry')).toBeVisible();
});
