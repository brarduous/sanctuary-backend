// Import is intentionally distinct from human approval and scheduling.
const fs=require('node:fs');
const path=require('node:path');
const {validateContent}=require('../../utils/discoveries');
const {copyIssues}=require('../../utils/discoveryCopy');
async function main() {
  const filename=process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const file=filename || path.join(__dirname,'../../content/discoveries/biblical-candidates.json');
  const entries=JSON.parse(fs.readFileSync(file,'utf8')).map(({id,slug,content}) => ({id,slug,content:validateContent(content)}));
  for(const item of entries) {
    const issues=copyIssues(item.content);
    if(issues.length)throw new Error(`${item.slug}: ${issues.join(', ')}`);
  }
  if (!process.argv.includes('--apply')) {console.log(`Validated ${entries.length} drafts. No writes. Use --apply with DISCOVERY_ADMIN_URL and DISCOVERY_ADMIN_TOKEN to import for review.`);return;}
  const base=process.env.DISCOVERY_ADMIN_URL;
  const token=process.env.DISCOVERY_ADMIN_TOKEN;
  if (!base || !token) throw new Error('DISCOVERY_ADMIN_URL and DISCOVERY_ADMIN_TOKEN are required. No token is logged.');
  const url=new URL(base);
  if (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS or a loopback development server.');
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const current=await fetch(`${base}/admin/discoveries`,{headers});
  if (!current.ok) throw new Error(`Admin inventory failed (${current.status}).`);
  const inventory=await current.json();
  let imported=0,unchanged=0;
  for (const item of entries) {
    const latest=inventory.revisions.find(row => row.discovery_id===item.id);
    if (latest && JSON.stringify(validateContent(latest.content))===JSON.stringify(item.content)) {unchanged++;continue;}
    const response=await fetch(`${base}/admin/discoveries/import`,{method:'POST',headers,body:JSON.stringify(item)});
    if (!response.ok) throw new Error(`Import failed for ${item.slug} (${response.status}). Earlier imports remain unpublished and can safely be retried.`);
    imported++;
  }
  console.log(`Imported ${imported} revisions awaiting human review; ${unchanged} unchanged. Nothing was approved or scheduled.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
