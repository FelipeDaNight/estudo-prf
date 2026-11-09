const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:390,height:844}});
const j=fs.readFileSync(process.argv[2],'utf8');
await p.goto('http://localhost:8765/');await p.waitForTimeout(600);
await p.click('nav button:has-text("Questões"), [data-tab="quest"]').catch(()=>{});await p.waitForTimeout(800);
await p.click('#q_imp summary');await p.fill('#q_imp_txt',j);await p.click('#q_imp_go');await p.waitForTimeout(500);
console.log('msg:',await p.textContent('#q_imp_msg'));
await p.click('#q_imp summary');await p.fill('#q_imp_txt',j);await p.click('#q_imp_go');await p.waitForTimeout(300);
console.log('dup:',await p.textContent('#q_imp_msg'));
console.log('card:',await p.locator('.card[data-banco="meus-erros"]').count());
await p.click('.card[data-banco="meus-erros"] .q_continuar');await p.waitForTimeout(400);
await p.locator('#q_alts .alt').nth(1).click();await p.waitForTimeout(400);
console.log('fb:',(await p.textContent('#q_fb')).slice(0,160));
const cards=await p.evaluate(()=>JSON.parse(localStorage.getItem('ep_cards')||'[]').length);console.log('cartões:',cards);
await p.screenshot({path:process.argv[3]});await b.close()})()
