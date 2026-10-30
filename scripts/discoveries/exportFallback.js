const fs=require('node:fs');
const path=require('node:path');
const {publicDiscovery,validateContent}=require('../../utils/discoveries');
async function main() {
 const base=process.env.DISCOVERY_PUBLIC_URL;
 const ids=process.argv.slice(2).filter(value=>!value.startsWith('--'));
 if (!base || !ids.length) throw new Error('Set DISCOVERY_PUBLIC_URL and pass released discovery IDs. This reads only the public API.');
 const url=new URL(base);
 if (url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Use HTTPS or loopback.');
 const items=[];
 for(const id of ids.slice(0,3)) {
  const response=await fetch(`${base}/api/v1/discoveries/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Discovery ${id} is not publicly released (${response.status}). No fallback was written.`);
  const {discovery:item}=await response.json();
  validateContent(item);
  if (item.id!==id || !item.publicationDate) throw new Error('A released, reviewed discovery is required.');
  items.push({...publicDiscovery({discovery_id:item.id,revision:item.revision,content:item},item.publicationDate),correctionNotice:item.correctionNotice || null});
 }
 const bundle={schemaVersion:1,enabled:true,items:[],evergreen:items,withdrawnIds:[],bundleRevision:`bundled-reviewed-${items.map(item=>`${item.id}-${item.revision}`).join('-')}`,serverTime:new Date().toISOString()};
 if (!process.argv.includes('--apply')) {console.log(`Verified ${items.length} publicly released items; no file written. Add --apply to export the mobile fallback.`);return;}
 fs.writeFileSync(path.join(__dirname,'../../../sanctuary-mobile/assets/discoveries/approved-fallback.json'),JSON.stringify(bundle,null,2)+'\n');
 console.log(`Exported ${items.length} already-published discoveries as an offline fallback. Re-export after corrections/withdrawals.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
