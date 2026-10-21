const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../..'),css=fs.readFileSync(path.join(root,'support-room/draft.css'),'utf8'),compact=fs.readFileSync(path.join(root,'support-room/draft-compact.css'),'utf8'),html=fs.readFileSync(path.join(root,'support-room/draft.html'),'utf8');
test('accepted Support font face, fallback stack and inherited controls remain untouched',()=>{
 assert.match(css,/@font-face\{font-family:'Support Inter';font-style:normal;font-weight:100 900/);
 assert.match(css,/font-family:'Support Inter','Segoe UI','Microsoft YaHei',Arial,sans-serif;font-size:11px;line-height:1\.35/);
 assert.match(css,/button,input,select,textarea\{font:inherit/);assert.doesNotMatch(compact,/font-family|@font-face/);
 assert.ok(html.indexOf('href="draft.css?')<html.indexOf('href="draft-compact.css?'));
});
test('published Support preview is visibly synthetic and has no business persistence or live auth claim',()=>{
 const app=fs.readFileSync(path.join(root,'support-room/draft-app.js'),'utf8');
 assert.match(html,/not live orders or POINTBASE data/);assert.match(html,/Preview 页面预览/);assert.doesNotMatch(html,/LAW · Demo/);
 assert.doesNotMatch(app,/\bfetch\s*\(|\.postMessage\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bsessionStorage\b/);
 assert.doesNotMatch(html,/id="saveInvoice"|src="app\.js/);
 assert.match(html,/2026-10-21-support-preview-v1/);
});
test('compact invoice remains a labelled non-production draft and stock belongs outside Support navigation',()=>{
 assert.match(compact,/#invoice\{width:680px\}/);assert.match(html,/DESIGN DRAFT/);assert.match(html,/cannot save or issue a real invoice/);
 assert.doesNotMatch(html.match(/<nav>.*?<\/nav>/)[0],/Stock Control/);assert.match(html,/id="preview-invoice"/);
});
