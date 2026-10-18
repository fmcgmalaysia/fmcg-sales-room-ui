const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function load(name,cache={}) {
 if(cache[name])return cache[name];
 let source=fs.readFileSync(path.join(__dirname,'../backend',name),'utf8'),bindings={};
 source=source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{
  const exports=target.startsWith('backend/')?load(target.slice(8),cache):require(target);
  for(const part of names.split(',')){const [original,alias]=part.trim().split(/\s+as\s+/);bindings[alias||original]=exports[original];}return '';
 });
 const names=[...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(match=>match[1]);
 source=source.replace(/^export /gm,'');
 const result=vm.runInNewContext('(function(){'+source+'\nreturn {'+names.join(',')+'};})()', {...bindings,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math});
 cache[name]=result;return result;
};
