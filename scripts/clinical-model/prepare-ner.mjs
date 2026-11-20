// Build-time public dependency only. The browser worker remains strictly offline/same-origin.
import {createHash} from 'node:crypto'
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
if(process.argv.length!==2)throw Error('NO_ARGUMENTS_ALLOWED')
const root=resolve(import.meta.dirname,'../..'),revision='8e1988247e872ba0137062653b1e5033a31e14fc'
const files={
 'config.json':{size:941,git:'13dd34b6d8ad5559f6e315c3c313d5a03760c79e'},
 'special_tokens_map.json':{size:241,git:'ee99658bfc3a8ae8296264ccfb8fd482ef7394d9'},
 'tokenizer.json':{size:2421091,git:'08441c67492a51f6fea26376c6754f1dadd802ff'},
 'tokenizer_config.json':{size:516,git:'398811a15dea0441f44c64ad89e1a1cd04e84b84'},
 'onnx/model_quantized.onnx':{size:111284131,sha256:'43507a27e7e5500b5e197c8c7de803bc94bcc29ce156fcbb19bda18ed322960d'},
}
const valid=(bytes,expected)=>bytes.length===expected.size&&(expected.sha256
 ?createHash('sha256').update(bytes).digest('hex')===expected.sha256
 :createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')===expected.git)
for(const [name,expected]of Object.entries(files)){
 const dest=resolve(root,'public/clinical-model/Xenova/camembert-ner',name)
 const present=await readFile(dest).catch(()=>null);if(present&&valid(present,expected))continue
 const response=await fetch('https://huggingface.co/Xenova/camembert-ner/resolve/'+revision+'/'+name,{signal:AbortSignal.timeout(180000)})
 if(!response.ok)throw Error('PUBLIC_MODEL_HTTP_'+response.status)
 const bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes,expected))throw Error('PUBLIC_MODEL_HASH_MISMATCH')
 await mkdir(dirname(dest),{recursive:true});const temp=dest+'.download-'+process.pid
 try{await writeFile(temp,bytes,{flag:'wx'});await rename(temp,dest)}finally{await rm(temp,{force:true})}
}
console.log(JSON.stringify({publicModel:'Xenova/camembert-ner',revision,verifiedFiles:Object.keys(files).length,clinicalDataRead:false}))
