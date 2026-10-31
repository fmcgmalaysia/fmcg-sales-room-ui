import difflib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[3]
folder=pathlib.Path('C:/FMCG-WIX-LOCAL/handoff/purchase-read-efficiency-20261101')
files=['purchaseMarginRefresh.js','purchaseOrderWorkflow.js','purchaseOrders.web.js','purchaseWorkspace.web.js','purchase-room-page.js']
plans=[]
for name in files:
    relative=('integration/wix/' if name=='purchase-room-page.js' else 'integration/backend/')+name
    old=(folder/(name.replace('.js','.live.js'))).read_text(encoding='utf-8')
    baseline=subprocess.check_output(['git','show','aa357a8:'+relative],cwd=root).decode().replace('\r\n','\n')
    assert old==baseline,name
    new=(root/relative).read_text(encoding='utf-8')
    before,after=old.splitlines(True),new.splitlines(True)
    patches=[]
    for group in difflib.SequenceMatcher(None,before,after,autojunk=False).get_grouped_opcodes(1):
        first,last=group[0],group[-1]
        a=''.join(before[first[1]:last[2]]).rstrip('\n')
        b=''.join(after[first[3]:last[4]]).rstrip('\n')
        assert a and old.count(a)==1,(name,a)
        patches.append({'before':a,'after':b})
    replay=old
    for p in patches:replay=replay.replace(p['before'],p['after'])
    assert replay==new,name
    plans.append({'name':name,'relative':relative,'before':old,'after':new,'patches':patches})
(folder/'wix-patches.json').write_text(json.dumps(plans,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'file':p['name'],'patches':len(p['patches'])} for p in plans]))
