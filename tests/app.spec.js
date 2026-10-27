const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
async function download(page,button){const event=page.waitForEvent('download');await button.click();const d=await event;return fs.readFile(await d.path(),'utf8');}
test.beforeEach(async({page})=>{await page.goto('./');});
test('vehicle entry, persistence, CSV and JSON round trip',async({page})=>{
 await page.locator('#openDataEntry').click();
 const form=page.locator('#manual');await form.locator('[name=soc]').fill('78');await form.locator('[name=rangeKm]').fill('312');await form.locator('[name=odometerKm]').fill('8420');await form.locator('[name=chargingStatus]').fill('停止中');await form.getByRole('button').click();await page.locator('#backFromData').click();
 await expect(page.locator('#soc')).toHaveText('78%');await page.reload();await expect(page.locator('#odo')).toHaveText('8,420 km');
 const csv=await download(page,page.locator('#export'));expect(csv).toContain('8420');
 const json=await download(page,page.locator('#vehicleBackup'));expect(JSON.parse(json)[0].soc).toBe(78);
 await page.evaluate(()=>localStorage.clear());await page.reload();await page.locator('#openDataEntry').click();await page.locator('#import').setInputFiles({name:'vehicle.json',mimeType:'application/json',buffer:Buffer.from(json)});await expect(page.locator('#soc')).toHaveText('78%');
});
test('maintenance create, edit, backup, restore and delete',async({page})=>{
 await page.locator('#openMaintenance').click();
 const form=page.locator('#maintenanceForm');await form.locator('[name=date]').fill('2026-10-24');await form.locator('[name=part]').fill('ワイパー "A", B');await form.locator('[name=costYen]').fill('5000');await form.locator('[name=notes]').fill('=1+1\n交換完了');await page.locator('#maintenanceSubmit').click();
 await expect(page.locator('.maintenance-card')).toHaveCount(1);await page.reload();
 await page.getByRole('button',{name:'編集',exact:true}).click();await form.locator('[name=costYen]').fill('6000');await page.locator('#maintenanceSubmit').click();await expect(page.locator('.maintenance-card')).toContainText('6,000 円');
 const csv=await download(page,page.locator('#maintenanceExport'));expect(csv).toContain('"ワイパー ""A"", B"');expect(csv).toContain("'=1+1");
 const json=await download(page,page.locator('#maintenanceBackup'));expect(JSON.parse(json)[0].costYen).toBe(6000);
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'削除',exact:true}).click();await expect(page.locator('.maintenance-card')).toHaveCount(0);
 await page.locator('#maintenanceImport').setInputFiles({name:'maintenance.json',mimeType:'application/json',buffer:Buffer.from(json)});await expect(page.locator('.maintenance-card')).toHaveCount(1);
 await page.locator('#maintenanceImport').setInputFiles({name:'maintenance.json',mimeType:'application/json',buffer:Buffer.from(json)});await expect(page.locator('.maintenance-card')).toHaveCount(1);
 await page.getByRole('button',{name:'編集',exact:true}).click();await page.locator('#backToVehicle').click();await page.locator('#clear').click();await expect(page.locator('.maintenance-card')).toHaveCount(0);await expect(page.locator('#maintenanceCancel')).toBeHidden();
});
test('invalid JSON is atomic and storage failures are visible',async({page})=>{
 await page.locator('#openDataEntry').click();
 await page.locator('#sample').click();
 await page.locator('#import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{soc:22},{soc:true}]))});await expect(page.locator('#message')).toContainText('取込失敗');await expect(page.locator('#history tr')).toHaveCount(1);
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('full','QuotaExceededError')}});await page.locator('#sample').click();await expect(page.locator('#message')).toContainText('端末に保存できません');await expect(page.locator('#history tr')).toHaveCount(1);
});
test('mobile layout, install assets and runtime errors',async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.reload();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('#maintenanceCancel')).toBeHidden();
 const m=await (await request.get('manifest.webmanifest')).json();expect(m.start_url).toBe('./');for(const icon of m.icons)expect((await request.get(icon.src)).ok()).toBe(true);
 await expect(page.getByRole('heading',{name:'iPhoneのホーム画面に追加'})).toBeVisible();expect(errors).toEqual([]);
});
test('offline reload under GitHub Pages subpath',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Playwright WebKit does not expose service worker control');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.locator('#openDataEntry').click();await page.locator('#sample').click();await page.locator('#backFromData').click();await context.setOffline(true);await page.reload();await expect(page.locator('#soc')).toHaveText('78%');
});
test('maintenance fallback ID, validation and cancel preserve records',async({page})=>{
 await page.locator('#openMaintenance').click();
 await page.evaluate(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));
 const form=page.locator('#maintenanceForm');await form.locator('[name=date]').fill('2026-10-24');await page.locator('#maintenanceSubmit').click();await expect(page.locator('.maintenance-card')).toHaveCount(1);
 const raw=await page.evaluate(()=>JSON.parse(localStorage.getItem('macan-control-maintenance-v1')));expect(raw[0].id).toMatch(/^[a-f0-9]{32}$/);
 await page.locator('#maintenanceImport').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{date:'2026-02-30',category:'ワイパー交換'}]))});await expect(page.locator('#maintenanceMessage')).toContainText('取込失敗');await expect(page.locator('.maintenance-card')).toHaveCount(1);
 await page.getByRole('button',{name:'編集',exact:true}).click();await form.locator('[name=part]').fill('キャンセルされる変更');await page.locator('#maintenanceCancel').click();await expect(page.locator('.maintenance-card')).not.toContainText('キャンセルされる変更');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'削除',exact:true}).click();await expect(page.locator('.maintenance-card')).toHaveCount(1);
});

test('maintenance has a dedicated view with Back, drafts and reload support',async({page})=>{
 await expect(page.locator('#maintenanceForm')).toBeHidden();await expect(page.locator('#maintenanceList')).toBeHidden();await expect(page.locator('#openMaintenance')).toBeVisible();
 await page.locator('#openMaintenance').click();await expect(page).toHaveURL(/#maintenance$/);await expect(page.locator('#maintenanceForm')).toBeVisible();await expect(page.locator('.hero')).toBeHidden();await expect(page.locator('#homeTools')).toBeHidden();
 await expect(page.locator('#maintenanceTitle')).toBeFocused();await page.locator('#maintenanceForm [name=part]').fill('下書きのワイパー');
 await page.locator('#backToVehicle').click();await expect(page.locator('.hero')).toBeVisible();await expect(page.locator('#maintenanceForm')).toBeHidden();await expect(page.locator('#openMaintenance')).toBeFocused();
 await page.locator('#openMaintenance').click();await expect(page.locator('#maintenanceForm [name=part]')).toHaveValue('下書きのワイパー');
 await page.reload();await expect(page.locator('#maintenanceForm')).toBeVisible();await expect(page).toHaveTitle('メンテナンス記録 — Macan Control');
 await page.locator('#backToVehicle').click();await page.locator('#openMaintenance').click();await page.goBack();await expect(page.locator('#maintenanceForm')).toBeHidden();await page.goForward();await expect(page.locator('#maintenanceForm')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('data entry is a dedicated screen with visible manual inputs, drafts and Back support',async({page})=>{
 await expect(page.locator('#dataEntry')).toBeHidden();await expect(page.locator('#sample')).toBeHidden();await expect(page.locator('#manual')).toBeHidden();await expect(page.locator('#openDataEntry')).toBeVisible();
 await page.locator('#openDataEntry').click();await expect(page).toHaveURL(/#data$/);await expect(page.locator('#manual')).toBeVisible();await expect(page.locator('#dataEntryTitle')).toBeFocused();await expect(page.locator('#homeView')).toBeHidden();await expect(page.locator('#maintenance')).toBeHidden();
 await page.locator('#manual [name=chargingStatus]').fill('下書き');await page.locator('#backFromData').click();await expect(page.locator('#openDataEntry')).toBeFocused();await page.locator('#openDataEntry').click();await expect(page.locator('#manual [name=chargingStatus]')).toHaveValue('下書き');
 await page.reload();await expect(page.locator('#manual')).toBeVisible();await expect(page).toHaveTitle('データ追加 — Macan Control');await page.locator('#backFromData').click();await page.locator('#openDataEntry').click();await page.goBack();await expect(page.locator('#dataEntry')).toBeHidden();await page.goForward();await expect(page.locator('#manual')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
