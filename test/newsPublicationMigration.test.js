const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('single-source publication is allowed after source validation; incomplete sources still fail',async()=>{
 const db=await PGlite.create();try{
  await db.exec(`create table scriptural_outlooks(id integer primary key,publication_status text);create table news_article_sources(outlook_id integer,url text,title text);`);
  await db.exec(fs.readFileSync('supabase/migrations/20261101140000_news_automated_publication.sql','utf8'));
  await db.exec(`create trigger enforce_news_publication_sources before insert or update of publication_status on scriptural_outlooks for each row execute function enforce_news_publication_sources();insert into scriptural_outlooks values(1,'pending_review');`);
  await assert.rejects(db.exec("update scriptural_outlooks set publication_status='published' where id=1"),/linked reporting source/);
  await db.exec("insert into news_article_sources values(1,'javascript:alert(1)','An invalid source')");
  await assert.rejects(db.exec("update scriptural_outlooks set publication_status='published' where id=1"),/linked reporting source/);
  await db.exec("delete from news_article_sources;insert into news_article_sources values(1,'https://publisher.example/story','Original reporting');update scriptural_outlooks set publication_status='published' where id=1");
  assert.equal((await db.query('select publication_status from scriptural_outlooks')).rows[0].publication_status,'published');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261101140000.sql','utf8'));
  assert.equal((await db.query('select publication_status from scriptural_outlooks')).rows[0].publication_status,'published','rollback preserves existing content');
 }finally{await db.close();}
});
