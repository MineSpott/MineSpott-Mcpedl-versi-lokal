require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) { throw new Error('Set SESSION_SECRET to a random value of at least 32 characters in production.'); }
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'storage', 'db.json');
const PRIVATE_DIR = path.join(ROOT, 'storage', 'private');
const PUBLIC_UPLOADS = path.join(ROOT, 'public', 'uploads');
for (const dir of [path.dirname(DB_FILE), PRIVATE_DIR, PUBLIC_UPLOADS]) fs.mkdirSync(dir, {recursive:true});

function loadDB(){
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({users:[],invites:[],content:[],activity:[]},null,2));
  return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
}
let db = loadDB();
function save(){ const tmp=DB_FILE+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(db,null,2)); fs.renameSync(tmp,DB_FILE); }
const id=()=>crypto.randomUUID();
const slugify=s=>String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'content';
const safeUser=u=>u?({id:u.id,username:u.username,role:u.role,status:u.status,bio:u.bio||'',avatar:u.avatar||null,createdAt:u.createdAt}):null;
function log(action,actor='system',target=''){db.activity.unshift({id:id(),action,actor,target,at:new Date().toISOString()});db.activity=db.activity.slice(0,500);save();}

// Seed a single Owner account from environment variables; never hard-code credentials in frontend files.
async function seedOwner(){
  const username=process.env.OWNER_USERNAME||'MineSpott';
  const password=process.env.OWNER_PASSWORD;
  const found=db.users.find(u=>u.role==='owner');
  if(found){ if(found.username!==username){found.username=username;save();} return; }
  if(!password){ console.warn('OWNER_PASSWORD is not set. Set it in the hosting environment before first launch to create the Owner account.'); return; }
  db.users.push({id:id(),username,passwordHash:await bcrypt.hash(password,12),role:'owner',status:'approved',bio:'Golden HUB Owner',createdAt:new Date().toISOString()}); save();
  console.log('Initial Owner account created for:',username);
}

app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:","blob:"],mediaSrc:["'self'","blob:"],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'1mb'}));
app.use(session({secret:process.env.SESSION_SECRET||'development-only-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*24*7}}));
app.use(express.static(path.join(ROOT,'public'),{index:'index.html'}));

const auth=(req,res,next)=>{const u=db.users.find(x=>x.id===req.session.userId&&x.status==='approved');if(!u)return res.status(401).json({error:'Silakan login dengan akun aktif.'});req.user=u;next();};
const roles=(...allowed)=>(req,res,next)=>{if(!req.user||!allowed.includes(req.user.role))return res.status(403).json({error:'Akses tidak diizinkan.'});next();};
function sameOrigin(req,res,next){const origin=req.get('origin');if(origin){try{const u=new URL(origin);if(u.host!==req.get('host'))return res.status(403).json({error:'Permintaan lintas situs ditolak.'});}catch{return res.status(403).json({error:'Origin tidak valid.'});}}next();}
app.use('/api',sameOrigin);
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:true,legacyHeaders:false}));

const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,PRIVATE_DIR),filename:(req,file,cb)=>cb(null,crypto.randomBytes(18).toString('hex')+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:100*1024*1024,files:10},fileFilter:(req,file,cb)=>{
  const ext=path.extname(file.originalname).toLowerCase();
  const image=['.png','.jpg','.jpeg','.webp'].includes(ext)&&file.mimetype.startsWith('image/');
  const video=['.mp4','.webm'].includes(ext)&&['video/mp4','video/webm'].includes(file.mimetype);
  const pack=['.mcaddon','.mcpack','.mcworld','.mcstructure','.zip','.mcfunction','.js'].includes(ext);
  const valid=file.fieldname==='thumbnail'?image:file.fieldname==='media'?(image||video):file.fieldname==='package'?pack:false;
  if(valid)return cb(null,true);cb(new Error('Format file tidak sesuai dengan kolom upload.'));
}});
const fields=upload.fields([{name:'thumbnail',maxCount:1},{name:'package',maxCount:1},{name:'media',maxCount:8}]);
function publicContent(c){return {id:c.id,slug:c.slug,title:c.title,category:c.category,description:c.description,version:c.version,creator:c.creator,creatorId:c.creatorId,createdAt:c.createdAt,updatedAt:c.updatedAt,downloads:c.downloads||0,views:c.views||0,thumbnail:c.thumbnail||null,media:c.media||[],features:c.features||[],changelog:c.changelog||'',status:c.status};}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Golden HUB'}));
app.get('/api/auth/me',(req,res)=>{const u=db.users.find(x=>x.id===req.session.userId&&x.status==='approved');res.json({user:safeUser(u)});});
app.post('/api/auth/register',async(req,res)=>{
  const username=String(req.body.username||'').trim();const password=String(req.body.password||'');const inviteCode=String(req.body.inviteCode||'').trim().toUpperCase();
  if(!/^[a-zA-Z0-9_]{3,24}$/.test(username))return res.status(400).json({error:'Username harus 3–24 karakter: huruf, angka, atau underscore.'});
  if(password.length<10)return res.status(400).json({error:'Password minimal 10 karakter.'});
  if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Username sudah digunakan.'});
  let invite=null;if(inviteCode){invite=db.invites.find(x=>x.code===inviteCode&&!x.usedAt&&new Date(x.expiresAt)>new Date());if(!invite)return res.status(400).json({error:'Kode undangan tidak valid, kedaluwarsa, atau sudah digunakan.'});}
  const user={id:id(),username,passwordHash:await bcrypt.hash(password,12),role:'creator',status:invite?'approved':'pending',bio:'',createdAt:new Date().toISOString()};
  db.users.push(user);if(invite){invite.usedAt=new Date().toISOString();invite.usedBy=user.id;}save();log(invite?'Creator joined with invite':'Creator registration awaiting Owner approval',username,user.id);
  res.status(201).json({message:invite?'Akun Creator aktif. Silakan login.':'Pendaftaran terkirim dan menunggu persetujuan Owner.',status:user.status});
});
app.post('/api/auth/login',async(req,res)=>{
  const username=String(req.body.username||'').trim();const password=String(req.body.password||'');const user=db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user||!(await bcrypt.compare(password,user.passwordHash)))return res.status(401).json({error:'Username atau password salah.'});
  if(user.status!=='approved')return res.status(403).json({error:'Akun belum aktif. Pendaftaran masih menunggu persetujuan Owner.'});
  req.session.userId=user.id;log('Login',user.username);res.json({user:safeUser(user)});
});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.patch('/api/profile',auth,(req,res)=>{req.user.bio=String(req.body.bio||'').slice(0,280);save();res.json({user:safeUser(req.user)});});

app.get('/api/content',(req,res)=>{
  const {category,search,sort='new',limit='60'}=req.query;let list=db.content.filter(c=>c.status==='published');
  if(category)list=list.filter(c=>c.category.toLowerCase()===String(category).toLowerCase());
  if(search){const q=String(search).toLowerCase();list=list.filter(c=>[c.title,c.description,c.category,c.creator,...(c.features||[])].join(' ').toLowerCase().includes(q));}
  if(sort==='popular')list.sort((a,b)=>(b.downloads||0)-(a.downloads||0));else if(sort==='updated')list.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));else list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({items:list.slice(0,Math.min(100,Number(limit)||60)).map(publicContent)});
});
app.get('/api/content/:slug',(req,res)=>{const c=db.content.find(x=>x.slug===req.params.slug&&x.status==='published');if(!c)return res.status(404).json({error:'Konten tidak ditemukan.'});c.views=(c.views||0)+1;save();res.json({item:publicContent(c)});});
app.post('/api/content/:id/download',(req,res)=>{const c=db.content.find(x=>x.id===req.params.id&&x.status==='published');if(!c||!c.packagePath)return res.status(404).json({error:'File belum tersedia.'});c.downloads=(c.downloads||0)+1;save();res.json({url:'/uploads/'+path.basename(c.packagePath),filename:c.packageName});});
app.get('/api/creators/:username',(req,res)=>{const u=db.users.find(x=>x.username.toLowerCase()===req.params.username.toLowerCase()&&x.status==='approved');if(!u)return res.status(404).json({error:'Creator tidak ditemukan.'});const items=db.content.filter(c=>c.creatorId===u.id&&c.status==='published').map(publicContent);res.json({creator:safeUser(u),items});});
app.post('/api/content',auth,roles('creator','admin','owner'),(req,res)=>fields(req,res,err=>{
  if(err)return res.status(400).json({error:err.message});const body=req.body;const title=String(body.title||'').trim(),description=String(body.description||'').trim();
  const category=String(body.category||'').trim();const allowed=['Addon','Map','Texture Pack','Skin','Script','Mod','Shader','Other'];
  if(title.length<3||title.length>90||description.length<30||!allowed.includes(category)||!req.files?.thumbnail?.[0]||req.files.thumbnail[0].size>5*1024*1024||!req.files?.package?.[0]){for(const f of Object.values(req.files||{}).flat())fs.rmSync(f.path,{force:true});return res.status(400).json({error:'Lengkapi judul, kategori, deskripsi minimal 30 karakter, thumbnail, dan file karya.'});}
  const thumb=req.files.thumbnail[0],pack=req.files.package[0],media=(req.files.media||[]).map(f=>({privatePath:f.path,filename:f.filename,mime:f.mimetype,originalName:f.originalname}));
  const item={id:id(),slug:slugify(title)+'-'+crypto.randomBytes(3).toString('hex'),title,category,description,version:String(body.version||'Belum ditentukan').slice(0,30),creator:req.user.username,creatorId:req.user.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),downloads:0,views:0,status:'pending',thumbnailPrivate:thumb.path,thumbnailName:thumb.filename,packagePath:pack.path,packageName:pack.originalname,mediaPrivate:media,changelog:String(body.changelog||'').slice(0,2000),features:String(body.features||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,12)};
  db.content.push(item);save();log('Content submitted for approval',req.user.username,item.title);res.status(201).json({message:'Konten dikirim dan menunggu persetujuan Owner.',item:{id:item.id,title:item.title,status:item.status}});
}));
app.get('/api/dashboard/creator',auth,roles('creator','admin','owner'),(req,res)=>res.json({items:db.content.filter(c=>c.creatorId===req.user.id).map(c=>({...publicContent(c),packageName:c.packageName}))}));
app.get('/api/owner/overview',auth,roles('owner'),(req,res)=>res.json({stats:{users:db.users.length,pendingUsers:db.users.filter(u=>u.status==='pending').length,pendingContent:db.content.filter(c=>c.status==='pending').length,published:db.content.filter(c=>c.status==='published').length},pendingUsers:db.users.filter(u=>u.status==='pending').map(safeUser),pendingContent:db.content.filter(c=>c.status==='pending').map(c=>({...publicContent(c),packageName:c.packageName,mediaCount:(c.mediaPrivate||[]).length})),users:db.users.map(safeUser),invites:db.invites.map(({code,createdAt,expiresAt,usedAt,usedBy})=>({code,createdAt,expiresAt,usedAt,usedBy})),activity:db.activity.slice(0,40)}));
app.post('/api/owner/invites',auth,roles('owner'),(req,res)=>{const code='GH-'+crypto.randomBytes(5).toString('hex').toUpperCase();const days=Math.max(1,Math.min(365,Number(req.body.days)||30));const item={id:id(),code,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+days*86400000).toISOString(),usedAt:null,usedBy:null};db.invites.unshift(item);save();log('Invite code created',req.user.username,code);res.status(201).json({invite:item});});
app.post('/api/owner/users/:id/approve',auth,roles('owner'),(req,res)=>{const u=db.users.find(x=>x.id===req.params.id&&x.role==='creator');if(!u)return res.status(404).json({error:'Akun tidak ditemukan.'});u.status='approved';save();log('Creator account approved',req.user.username,u.username);res.json({ok:true});});
app.post('/api/owner/users/:id/reject',auth,roles('owner'),(req,res)=>{const u=db.users.find(x=>x.id===req.params.id&&x.role==='creator');if(!u)return res.status(404).json({error:'Akun tidak ditemukan.'});u.status='rejected';save();log('Creator account rejected',req.user.username,u.username);res.json({ok:true});});
app.patch('/api/owner/users/:id/role',auth,roles('owner'),(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);const role=req.body.role;if(!u||u.role==='owner'||!['creator','admin'].includes(role))return res.status(400).json({error:'Perubahan role tidak valid.'});u.role=role;u.status='approved';save();log('User role changed',req.user.username,u.username+': '+role);res.json({ok:true});});
app.post('/api/owner/content/:id/approve',auth,roles('owner'),(req,res)=>{const c=db.content.find(x=>x.id===req.params.id);if(!c||c.status!=='pending')return res.status(404).json({error:'Kiriman tidak ditemukan.'});
  const move=(from,to)=>{if(from&&fs.existsSync(from)){const name=path.basename(from);const dest=path.join(PUBLIC_UPLOADS,name);fs.renameSync(from,dest);return '/uploads/'+name;}return null;};
  c.thumbnail=move(c.thumbnailPrivate,c.thumbnailPrivate);c.packagePath=move(c.packagePath,c.packagePath);c.media=(c.mediaPrivate||[]).map(m=>({url:move(m.privatePath,m.privatePath),type:m.mime,filename:m.originalName}));delete c.thumbnailPrivate;delete c.thumbnailName;delete c.mediaPrivate;c.status='published';c.updatedAt=new Date().toISOString();save();log('Content approved',req.user.username,c.title);res.json({ok:true});});
app.post('/api/owner/content/:id/reject',auth,roles('owner'),(req,res)=>{const c=db.content.find(x=>x.id===req.params.id);if(!c||c.status!=='pending')return res.status(404).json({error:'Kiriman tidak ditemukan.'});for(const p of [c.thumbnailPrivate,c.packagePath,...(c.mediaPrivate||[]).map(x=>x.privatePath)])if(p)fs.rmSync(p,{force:true});c.status='rejected';c.reviewNote=String(req.body.note||'Tidak memenuhi pedoman komunitas').slice(0,500);save();log('Content rejected',req.user.username,c.title);res.json({ok:true});});
app.get('/api/owner/private-file/:id/:kind',auth,roles('owner'),(req,res)=>{const c=db.content.find(x=>x.id===req.params.id&&x.status==='pending');if(!c)return res.status(404).end();let p=req.params.kind==='thumbnail'?c.thumbnailPrivate:req.params.kind==='package'?c.packagePath:null;if(!p&&req.params.kind.startsWith('media-'))p=c.mediaPrivate?.[Number(req.params.kind.slice(6))]?.privatePath;if(!p||!fs.existsSync(p))return res.status(404).end();res.sendFile(path.resolve(p));});
app.get('/api/owner/activity',auth,roles('owner'),(req,res)=>res.json({items:db.activity.slice(0,100)}));

app.use((err,req,res,next)=>{console.error(err);if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Ukuran file terlalu besar. Maksimal 100 MB.':err.message});res.status(500).json({error:'Terjadi kesalahan server.'});});
seedOwner().then(()=>app.listen(PORT,()=>console.log(`Golden HUB running on http://localhost:${PORT}`)));
