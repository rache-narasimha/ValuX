/** Authorized browser checks: isolated context, synthetic Practice PDF, no task edits. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const base = process.env.VALUX_SECURITY_BASE_URL || 'http://127.0.0.1:4180';
const origin = new URL(base).origin;
const output = process.env.VALUX_SECURITY_OUTPUT;
assert.ok(output, 'Set a private result directory');
await fs.mkdir(output,{recursive:true,mode:0o700});
const browser = await chromium.launch({headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],executablePath:process.env.VALUX_SECURITY_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const findings={base,anonymous:{},authenticated:{},normalExternalRequests:[],pageErrors:[],policyViolations:[]};
const recordPage = (page, label) => {
  page.on('pageerror',e=>findings.pageErrors.push({page:label,error:e.message}));
  page.on('request',r=>{const u=new URL(r.url());if(/^https?:$/.test(u.protocol)&&u.origin!==origin)findings.normalExternalRequests.push({page:label,origin:u.origin,path:u.pathname});});
};
function samplePdf(){
 const stream='BT /F1 16 Tf 20 140 Td (ValuX authorized security test) Tj ET\n';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let text='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(text);
}
let auth, upload, csrf;
try{
 const anonymous=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await anonymous.newPage();recordPage(page,'anonymous');
 const response=await page.goto(base+'/auth?next='+encodeURIComponent('https://example.invalid/'),{waitUntil:'networkidle'});
 assert.equal(response.status(),200);assert.ok(response.headers()['content-security-policy']);
 await page.locator('#login-form').waitFor();
 assert.equal(await page.locator('#password').getAttribute('autocomplete'),'current-password');
 assert.ok((await page.locator('body').innerText()).includes('SLN Consultancy'));
 findings.anonymous={status:response.status(),loginRendered:true,operatorVisible:true};
 for(const privatePath of ['/api/tasks','/api/institutions','/api/employees','/api/schema','/api/auth/me','/downloads/missing.xlsx','/previews/missing.pdf']){
  const response=await anonymous.request.get(base+privatePath);assert.equal(response.status(),401,privatePath);
 }
 findings.anonymous.privateEndpointsProtected=true;
 const rejected=await anonymous.request.post(base+'/api/auth/login',{headers:{Origin:'https://example.invalid'},data:{identifier:'valux-security-probe',password:'not-a-real-account-password'}});
 assert.equal(rejected.status(),403);findings.anonymous.crossSitePostRejected=true;
 await page.screenshot({path:path.join(output,'login-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.locator('#login-form').isVisible());
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(output,'login-mobile.png'),fullPage:true});
 await page.evaluate(()=>{window.__valuxPolicyEvents=[];document.addEventListener('securitypolicyviolation',e=>window.__valuxPolicyEvents.push(e.effectiveDirective));const script=document.createElement('script');script.textContent='document.documentElement.dataset.valuxUnsafeScript="executed"';document.body.append(script);const image=document.createElement('img');image.setAttribute('onerror','document.documentElement.dataset.valuxUnsafeHandler="executed"');image.src='data:image/png,invalid';document.body.append(image);});
 await page.waitForFunction(()=>window.__valuxPolicyEvents.length>=2);
 assert.deepEqual(await page.evaluate(()=>[document.documentElement.dataset.valuxUnsafeScript||null,document.documentElement.dataset.valuxUnsafeHandler||null]),[null,null]);
 findings.anonymous.inlineScriptBlocked=true;findings.anonymous.inlineHandlerBlocked=true;
 findings.policyViolations=await page.evaluate(()=>window.__valuxPolicyEvents);
 await anonymous.close();
 if(process.env.VALUX_SECURITY_SESSION){
  auth=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await auth.addCookies([{name:'valux_session',value:process.env.VALUX_SECURITY_SESSION,domain:new URL(base).hostname,path:'/',httpOnly:true,secure:base.startsWith('https:'),sameSite:'Lax'}]);
  const page=await auth.newPage();recordPage(page,'authenticated');const paths=['/','/tasks','/tasks/new','/practice','/valuation/general?practice=1','/valuation/agricultural?practice=1','/estimation?practice=1','/progress-completion?practice=1','/account'];
  findings.authenticated.pages=[];
  for(let i=0;i<paths.length;i++){
   const response=await page.goto(base+paths[i],{waitUntil:'networkidle'});assert.equal(response.status(),200,paths[i]);assert.ok(!new URL(page.url()).pathname.startsWith('/auth'),paths[i]);
   // Some controllers use a page-specific container rather than the form ID.
   assert.ok((await page.locator('main').innerText()).trim().length>20,paths[i]);
   const nonces=await page.locator('script:not([src])').evaluateAll(s=>s.filter(e=>e.textContent.trim()).map(e=>e.nonce));assert.ok(nonces.length>=2&&nonces.every(Boolean),paths[i]);
   findings.authenticated.pages.push({path:paths[i],status:response.status(),bootstrapScripts:nonces.length});
  }
  await page.goto(base+'/auth?next='+encodeURIComponent('https://example.invalid/'),{waitUntil:'networkidle'});
  await page.waitForURL(u=>u.origin===origin&&u.pathname==='/');findings.authenticated.externalRedirectRejected=true;
  const contextResponse=await auth.request.get(base+'/api/auth/context');const state=await contextResponse.json();csrf=state.csrf;assert.ok(state.authenticated);
  const pdf=samplePdf();const response=await auth.request.post(base+'/api/valuation/karnataka/upload',{headers:{'Content-Type':'application/pdf','X-File-Name':'ValuX security test.pdf','X-CSRF-Token':csrf,'X-Practice-Mode':'1'},data:pdf});assert.equal(response.status(),201);upload=await response.json();
  const download=await auth.request.get(base+upload.download);assert.equal(download.status(),200);assert.equal(download.headers()['content-type'],'application/pdf');assert.deepEqual(await download.body(),pdf);
  if(process.env.VALUX_SECURITY_SECOND_SESSION){
   const other=await browser.newContext();await other.addCookies([{name:'valux_session',value:process.env.VALUX_SECURITY_SECOND_SESSION,domain:new URL(base).hostname,path:'/',httpOnly:true,secure:base.startsWith('https:'),sameSite:'Lax'}]);
   const state=await (await other.request.get(base+'/api/auth/context')).json();assert.ok(state.authenticated);
   for(const url of [upload.download,upload.download.replace('/downloads/','/previews/')])assert.equal((await other.request.get(base+url)).status(),404);
   assert.equal((await other.request.head(base+upload.download)).status(),404);
   const denied=await other.request.delete(base+'/api/valuation/karnataka/upload',{headers:{'X-CSRF-Token':state.csrf,'X-Practice-Mode':'1','X-Stored-Name':upload.savedName}});assert.equal(denied.status(),404);
   await other.close();findings.authenticated.otherUserBlocked=true;
  }
  await page.goto(base+'/practice',{waitUntil:'networkidle'});
  await page.evaluate(url=>{const frame=document.createElement('iframe');frame.id='valux-security-preview';frame.title='Synthetic PDF security check';frame.style.cssText='width:95%;height:600px';frame.src=url;document.querySelector('main').prepend(frame);},base+upload.download.replace('/downloads/','/previews/'));
  await page.locator('#valux-security-preview').waitFor();await page.waitForLoadState('networkidle');
  assert.equal((await auth.request.get(base+upload.download.replace('/downloads/','/previews/'))).status(),200);
  await page.screenshot({path:path.join(output,'pdf-preview.png'),fullPage:true});findings.authenticated.pdfBytesUnchanged=true;findings.authenticated.pdfPreviewAccessible=true;
  const downloadEvent=page.waitForEvent('download');await page.evaluate(url=>{const link=document.createElement('a');link.href=url;link.download='ValuX security test.pdf';document.body.append(link);link.click();},base+upload.download);
  const file=await downloadEvent;assert.ok(file.suggestedFilename().endsWith('.pdf'));await file.saveAs(path.join(output,'synthetic-security-check.pdf'));findings.authenticated.downloadCompleted=true;
  const removed=await auth.request.delete(base+'/api/valuation/karnataka/upload',{headers:{'X-CSRF-Token':csrf,'X-Practice-Mode':'1','X-Stored-Name':upload.savedName}});
  assert.ok(removed.ok());findings.syntheticAttachmentRemoved=true;upload=null;
  const loggedOut=await auth.request.post(base+'/api/auth/logout',{headers:{'X-CSRF-Token':csrf,'Content-Type':'application/json'},data:{}});
  assert.ok(loggedOut.ok());
  await page.goto(base+'/tasks',{waitUntil:'networkidle'});await page.locator('#login-form').waitFor();
  await page.goBack({waitUntil:'networkidle'});await page.locator('#login-form').waitFor();
  findings.authenticated.logoutAndHistoryProtected=true;
 }
 assert.equal(findings.pageErrors.length,0,JSON.stringify(findings.pageErrors));
 assert.equal(findings.normalExternalRequests.length,0,JSON.stringify(findings.normalExternalRequests));
 findings.passed=true;
}finally{
 if(auth&&upload){const r=await auth.request.delete(base+'/api/valuation/karnataka/upload',{headers:{'X-CSRF-Token':csrf,'X-Practice-Mode':'1','X-Stored-Name':upload.savedName}});findings.syntheticAttachmentRemoved=r.ok();}
 await browser.close();await fs.writeFile(path.join(output,'browser-checks.json'),JSON.stringify(findings,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify({passed:findings.passed,anonymous:findings.anonymous,authenticatedPages:findings.authenticated.pages?.length,downloadCompleted:findings.authenticated.downloadCompleted,syntheticAttachmentRemoved:findings.syntheticAttachmentRemoved},null,2));
