'use strict';
const KEY='macan-control-records-v1';
const $=id=>document.getElementById(id);
const getRecords=()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}};
const saveRecords=rows=>localStorage.setItem(KEY,JSON.stringify(rows));
const num=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null);
function validate(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('JSONオブジェクトが必要です');const date=raw.timestamp||new Date().toISOString();if(Number.isNaN(Date.parse(date)))throw Error('timestampが不正です');const obj={timestamp:new Date(date).toISOString(),soc:num(raw.soc,0,100),rangeKm:num(raw.rangeKm),odometerKm:num(raw.odometerKm),chargingStatus:typeof raw.chargingStatus==='string'?raw.chargingStatus.slice(0,80):null,source:raw.source==='manual'?'manual':raw.source==='sample'?'sample':'import'};if(obj.soc===null&&obj.rangeKm===null&&obj.odometerKm===null&&!obj.chargingStatus)throw Error('有効な車両データがありません');for(const key of ['soc','rangeKm','odometerKm'])if(raw[key]!==undefined&&raw[key]!==null&&raw[key]!==''&&obj[key]===null)throw Error(key+' の数値が不正です');return obj}
function add(raw){const entry=validate(raw);const rows=getRecords();rows.push(entry);rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));saveRecords(rows);render();$('message').textContent='記録を保存しました。'}
const showNum=(n,unit)=>n===null||n===undefined?'—':n.toLocaleString('ja-JP',{maximumFractionDigits:1})+unit;
const dt=s=>new Date(s).toLocaleString('ja-JP');
function render(){const rows=getRecords(),latest=rows.at(-1);$('updated').textContent=latest?'記録日時：'+dt(latest.timestamp)+' / '+({manual:'手入力',sample:'サンプル',import:'JSON取込'}[latest.source]||'記録'):'記録はありません';$('soc').textContent=showNum(latest?.soc,'%');$('range').textContent=showNum(latest?.rangeKm,' km');$('odo').textContent=showNum(latest?.odometerKm,' km');$('charging').textContent=latest?.chargingStatus||'—';const body=$('history');body.replaceChildren();for(const r of [...rows].reverse().slice(0,50)){const tr=document.createElement('tr');for(const val of [dt(r.timestamp),showNum(r.soc,'%'),showNum(r.rangeKm,' km'),showNum(r.odometerKm,' km'),r.source]){const td=document.createElement('td');td.textContent=val;tr.append(td)}body.append(tr)}draw(rows.filter(x=>x.soc!==null).slice(-30))}
function draw(rows){const canvas=$('trend'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);$('trendEmpty').hidden=rows.length>0;if(!rows.length)return;const left=30,right=w-12,top=18,bottom=h-28;ctx.strokeStyle='#334a63';ctx.fillStyle='#aebed0';ctx.font='14px sans-serif';for(let y=0;y<=100;y+=25){const py=bottom-(bottom-top)*y/100;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();ctx.fillText(String(y),2,py+4)}ctx.strokeStyle='#8bcaee';ctx.lineWidth=3;ctx.beginPath();rows.forEach((r,i)=>{const x=left+(right-left)*(rows.length===1?.5:i/(rows.length-1));const y=bottom-(bottom-top)*r.soc/100;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
$('import').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw Error('ファイルは1MB以下にしてください');const raw=JSON.parse(await file.text());if(Array.isArray(raw)){if(raw.length>1000)throw Error('1回の取込上限は1000件です');const valid=raw.map(validate);const rows=getRecords();rows.push(...valid);rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));saveRecords(rows);render();$('message').textContent=valid.length+'件取り込みました'}else add(raw)}catch(err){$('message').textContent='取込失敗：'+err.message}e.target.value='' });
$('manual').addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());try{add({...data,source:'manual'});e.target.reset()}catch(err){$('message').textContent=err.message}});
$('sample').addEventListener('click',()=>add({timestamp:new Date().toISOString(),soc:78,rangeKm:312,odometerKm:8420,chargingStatus:'サンプル：停止中',source:'sample'}));
$('export').addEventListener('click',()=>{const cols=['timestamp','soc','rangeKm','odometerKm','chargingStatus','source'];const csv=[cols.join(','),...getRecords().map(r=>cols.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='macan-control-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('clear').addEventListener('click',()=>{if(confirm('車両データとメンテナンス履歴をすべて削除します。元には戻せません。実行しますか？')){localStorage.removeItem(KEY);localStorage.removeItem(MAINTENANCE_KEY);$('message').textContent='全記録を削除しました';render();renderMaintenance()}});
if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();


// 整備履歴は車両スナップショットとは別のキーに保存する。
const MAINTENANCE_KEY='macan-control-maintenance-v1';
let editingMaintenanceId=null;
const maintenanceRows=()=>{try{const v=JSON.parse(localStorage.getItem(MAINTENANCE_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}};
const saveMaintenance=rows=>localStorage.setItem(MAINTENANCE_KEY,JSON.stringify(rows));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function maintenanceValidate(r){
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('整備記録の形式が不正です');
 if(!validDate(r.date))throw Error('作業日を正しく入力してください');
 const categories=['ワイパー交換','タイヤ','充電設備','定期点検','修理','清掃・コーティング','その他'];
 if(!categories.includes(r.category))throw Error('作業分類が不正です');
 if(r.nextDate&&!validDate(r.nextDate))throw Error('次回予定日が不正です');
 const odometerKm=num(r.odometerKm),costYen=num(r.costYen);
 if(r.odometerKm!==''&&r.odometerKm!=null&&odometerKm===null)throw Error('走行距離が不正です');
 if(r.costYen!==''&&r.costYen!=null&&(costYen===null||!Number.isInteger(costYen)))throw Error('費用は0以上の整数で入力してください');
 const str=(v,n)=>typeof v==='string'?v.slice(0,n):'';
 return {id:typeof r.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(r.id)?r.id:crypto.randomUUID(),date:r.date,category:r.category,odometerKm,costYen,part:str(r.part,160),provider:str(r.provider,100),nextDate:r.nextDate||'',notes:str(r.notes,1500)};
}
function renderMaintenance(){
 const list=$('maintenanceList');list.replaceChildren();
 const rows=maintenanceRows().sort((a,b)=>b.date.localeCompare(a.date));
 if(!rows.length){const p=document.createElement('p');p.textContent='整備記録はありません。作業日と分類を選んで登録してください。';list.append(p);return}
 for(const r of rows){const card=document.createElement('article');card.className='maintenance-card';
 const head=document.createElement('div');head.className='between';const h=document.createElement('h4');h.textContent=r.date+' · '+r.category;head.append(h);card.append(head);
 const bits=[r.odometerKm===null?null:'走行 '+showNum(r.odometerKm,' km'),r.costYen===null?null:'費用 '+showNum(r.costYen,' 円'),r.provider?'作業：'+r.provider:null,r.nextDate?'次回予定：'+r.nextDate:null].filter(Boolean);
 if(r.part){const p=document.createElement('p');p.textContent='部品：'+r.part;card.append(p)}
 if(bits.length){const p=document.createElement('p');p.className='muted';p.textContent=bits.join(' / ');card.append(p)}
 if(r.notes){const p=document.createElement('p');p.textContent=r.notes;card.append(p)}
 const actions=document.createElement('div');actions.className='maintenance-actions';
 for(const [label,action] of [['編集','edit'],['削除','delete']]){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.addEventListener('click',()=>{
 if(action==='edit'){editingMaintenanceId=r.id;const form=$('maintenanceForm');for(const k of ['date','category','odometerKm','costYen','part','provider','nextDate','notes'])form.elements[k].value=r[k]??'';$('maintenanceSubmit').textContent='変更を保存';$('maintenanceCancel').hidden=false;form.scrollIntoView({behavior:'smooth',block:'start'})}
 else if(confirm(r.date+' '+r.category+' の整備記録を削除しますか？')){saveMaintenance(maintenanceRows().filter(x=>x.id!==r.id));if(editingMaintenanceId===r.id)resetMaintenanceForm();renderMaintenance()}
 });actions.append(b)}card.append(actions);list.append(card)}
}
function resetMaintenanceForm(){editingMaintenanceId=null;$('maintenanceForm').reset();$('maintenanceForm').elements.date.value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);$('maintenanceSubmit').textContent='メンテナンスを保存';$('maintenanceCancel').hidden=true}
$('maintenanceForm').addEventListener('submit',e=>{e.preventDefault();try{
 const raw=Object.fromEntries(new FormData(e.target).entries());if(editingMaintenanceId)raw.id=editingMaintenanceId;
 const item=maintenanceValidate(raw);const rows=maintenanceRows();const index=rows.findIndex(x=>x.id===item.id);if(index>=0)rows[index]=item;else rows.push(item);saveMaintenance(rows);resetMaintenanceForm();renderMaintenance();$('maintenanceMessage').textContent='整備記録を保存しました。';
 }catch(err){$('maintenanceMessage').textContent='保存失敗：'+err.message}});
$('maintenanceCancel').addEventListener('click',resetMaintenanceForm);
function downloadFile(name,mime,body){const url=URL.createObjectURL(new Blob([body],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
$('maintenanceExport').addEventListener('click',()=>{const cols=['date','category','odometerKm','costYen','part','provider','nextDate','notes'];const rows=maintenanceRows().sort((a,b)=>a.date.localeCompare(b.date));const csv=[cols.join(','),...rows.map(r=>cols.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');downloadFile('macan-maintenance.csv','text/csv;charset=utf-8','\ufeff'+csv)});
$('maintenanceBackup').addEventListener('click',()=>downloadFile('macan-maintenance.json','application/json;charset=utf-8',JSON.stringify(maintenanceRows(),null,2)));
$('maintenanceImport').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw Error('1MB以下のJSONを指定してください');const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed)||parsed.length>1000)throw Error('1000件以下のJSON配列を指定してください');const incoming=parsed.map(maintenanceValidate),map=new Map(maintenanceRows().map(x=>[x.id,x]));incoming.forEach(x=>map.set(x.id,x));saveMaintenance([...map.values()]);renderMaintenance();$('maintenanceMessage').textContent=incoming.length+'件の整備記録を取り込みました（同じIDは更新）。'}catch(err){$('maintenanceMessage').textContent='取込失敗：'+err.message}e.target.value=''});
resetMaintenanceForm();renderMaintenance();
