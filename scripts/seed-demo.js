'use strict';
const { openDatabase, runMigrations } = require('../src/db');
const modulesDb = require('../src/db/modules');
const quizzesDb = require('../src/db/quizzes');
const users = require('../src/db/users');
const attemptsDb = require('../src/db/attempts');
const passwords = require('../src/auth/passwords');
const db = openDatabase(process.env.DATABASE_FILE || 'data/cybersafe.db');
runMigrations(db);
const now = new Date().toISOString();
function ensureModule(t,d){const e=db.prepare('SELECT * FROM modules WHERE title = ?').get(t);if(e)return e;return modulesDb.createModule(db,{title:t,description:d,status:'published',sortOrder:0});}
function ensureItem(m,t,c){const e=db.prepare('SELECT * FROM module_items WHERE module_id = ? AND title = ?').get(m,t);if(e)return e;return modulesDb.addItem(db,{moduleId:m,type:'page',title:t,content:c,sortOrder:0});}
function ensureQuiz(s,t,d){const e=db.prepare('SELECT * FROM quizzes WHERE slug = ? AND version = 1').get(s);if(e)return e;const r=db.prepare('INSERT INTO quizzes (slug,version,title,description,status,passing_score_percent,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?)').run(s,1,t,d,'published',70,now,now,now);return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(r.lastInsertRowid);}
function ensureQuestion(q,p,ex,o){if(db.prepare('SELECT 1 FROM quiz_questions WHERE quiz_id = ? AND prompt = ?').get(q,p))return;const pos=db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM quiz_questions WHERE quiz_id=?').get(q).p;const qid=db.prepare('INSERT INTO quiz_questions (quiz_id,position,prompt,explanation,created_at) VALUES (?,?,?,?,?)').run(q,pos,p,ex,now).lastInsertRowid;o.forEach((x,i)=>db.prepare('INSERT INTO quiz_options (question_id,position,label,is_correct) VALUES (?,?,?,?)').run(qid,i+1,x.label,x.correct?1:0));}
function ensureUser(e,u,n){if(users.findByEmail(db,e))return users.findByEmail(db,e);const r=db.prepare('INSERT INTO users (google_sub,email,email_verified,username,display_name,role,status,created_at,updated_at,setup_completed_at,password_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('local:'+e,e,1,u,n,'student','active',now,now,now,null);return users.findById(db,r.lastInsertRowid);}
const topics=[];
function Q(p,e,o){return {prompt:p,explanation:e,options:o.map(x=>({label:x[0],correct:x[1]}))};}
// END_PART1_MARKER
topics.push({title:'Phishing awareness',description:'Spot fake emails, texts, and login pages before they steal your credentials.',items:[
{title:'What phishing looks like',content:'Phishing messages pretend to be from a bank, school, or app you trust. They push urgency ("your account will be closed") and ask you to click a link or open an attachment.\n\nWhat to do:\n- Pause before clicking.\n- Check the sender address, not just the display name.\n- Hover links to see the real URL.\n- Report suspicious messages to IT.'},
{title:'Spotting fake login pages',content:'A phishing link often leads to a page that looks like your school portal or email login. The URL is the giveaway: look for misspellings, extra words, or a different domain.\n\nWhat to do:\n- Type the site address yourself instead of clicking.\n- Check for https and a valid certificate.\n- Never enter credentials after following an email link.'},
{title:'Attachments and QR codes',content:'Attachments can carry malware; QR codes in emails can send you to phishing sites (quishing). Treat both like links.\n\nWhat to do:\n- Do not open unexpected attachments.\n- Scan QR codes only from trusted sources.\n- Keep your device and browser updated.'}],
quiz:{slug:'phishing-demo',title:'Phishing awareness check',qs:[
Q('Which is a common phishing tactic?','Urgency is used to make you act without thinking.',[['Urgency and a login link',true],['A plain newsletter',false],['A scheduled meeting',false],['A password reset you requested',false]]),
Q('What should you check first in a suspicious email?','The display name can be faked; the address reveals the real sender.',[['The sender email address',true],['The font size',false],['The number of recipients',false],['The subject line length',false]]),
Q('A link shows "https://school-portal.example.com/login". Red flag?','The domain is not the real school domain.',[['The domain is not the official school domain',true],['It uses https',false],['It has a path',false],['It is too long',false]]),
Q('What is "quishing"?','Quishing uses QR codes to hide phishing URLs.',[['Phishing via QR codes',true],['Email spam',false],['Password guessing',false],['Wi-Fi hacking',false]]),
Q('Best response to a suspected phishing email?','Reporting helps protect others.',[['Report it to IT and do not click',true],['Reply asking if it is real',false],['Forward to friends',false],['Click to check',false]]),
Q('Which password practice reduces phishing damage?','Unique passwords limit reuse damage.',[['Use a unique password per site',true],['Reuse one strong password',false],['Share passwords with classmates',false],['Write passwords on a sticky note',false]]),
]}});
topics.push({title:'Password security',description:'Build strong, unique passwords and use multi-factor authentication well.',items:[
{title:'Strong passwords',content:'A strong password is long (12+ characters), unique, and not based on personal info. Length beats complexity.\n\nWhat to do:\n- Use a passphrase of 4+ random words.\n- Never reuse passwords across sites.\n- Store them in a password manager.'},
{title:'Multi-factor authentication',content:'MFA adds a second check beyond your password. Prefer an authenticator app or hardware key over SMS.\n\nWhat to do:\n- Enable MFA on email, school, and banking accounts.\n- Save backup codes in a safe place.\n- Beware MFA fatigue: never approve prompts you did not trigger.'},
{title:'Password managers',content:'A password manager generates and stores unique passwords so you only remember one master password.\n\nWhat to do:\n- Choose a reputable manager.\n- Protect the master password with MFA.\n- Keep the manager updated.'}],
quiz:{slug:'passwords-demo',title:'Password security check',qs:[
Q('Minimum recommended password length?','Longer passwords resist brute force.',[['At least 12 characters',true],['6 characters',false],['8 characters',false],['4 characters',false]]),
Q('Best way to handle many passwords?','A manager keeps them unique and safe.',[['Use a password manager',true],['Reuse one password',false],['Write them in a notebook',false],['Store in browser notes',false]]),
Q('Which MFA method is strongest?','Hardware keys resist phishing.',[['Hardware security key',true],['SMS code',false],['Email code',false],['Security question',false]]),
Q('What is MFA fatigue?','Attackers spam prompts hoping you approve one.',[['Repeated prompts to trick approval',true],['Forgetting your password',false],['Slow login',false],['Locked account',false]]),
Q('Why avoid personal info in passwords?','Personal info is easy to guess or find.',[['It is easy to guess',true],['It is too long',false],['It breaks websites',false],['It is illegal',false]]),
Q('If a site is breached, you should:','Change the password and any reused ones.',[['Change that password and any reused ones',true],['Do nothing',false],['Delete the account only',false],['Tell no one',false]]),
]}});
topics.push({title:'Online scams',description:'Recognise marketplace, job, scholarship, and romance scams targeting students.',items:[
{title:'Common student scams',content:'Scams target students with fake jobs, scholarships, marketplaces, and romance. They promise easy money or urgent help.\n\nWhat to do:\n- Be sceptical of "too good to be true" offers.\n- Never pay to get a job or scholarship.\n- Verify organisations independently.'},
{title:'Marketplace and payment scams',content:'Overpayment and fake payment screenshots trick sellers. Buyers may be sent to phishing checkout pages.\n\nWhat to do:\n- Meet in public places for exchanges.\n- Use platform payment systems.\n- Confirm funds actually cleared before shipping.'},
{title:'Job and scholarship scams',content:'Fake recruiters ask for fees, bank details, or "training" payments. Real employers never charge you.\n\nWhat to do:\n- Verify the company on its official site.\n- Never share bank details early.\n- Report suspicious postings to your school.'}],
quiz:{slug:'scams-demo',title:'Online scams check',qs:[
Q('A job offer asks you to pay a training fee. This is:','Legitimate employers do not charge applicants.',[['A scam',true],['Normal',false],['Optional',false],['A tax',false]]),
Q('Best way to verify a scholarship?','Use official channels, not links in messages.',[['Check the school financial aid office',true],['Click the link in the email',false],['Reply with your SSN',false],['Pay a processing fee',false]]),
Q('Marketplace red flag?','Off-platform payment avoids buyer protection.',[['Seller insists on off-platform payment',true],['Local pickup',false],['Clear photos',false],['Detailed description',false]]),
Q('Romance scam warning sign?','They avoid meeting and ask for money.',[['Quick declarations of love plus money requests',true],['Shared hobbies',false],['Slow replies',false],['Different time zones',false]]),
Q('If you sent money to a scammer:','Report quickly; recovery is sometimes possible.',[['Report to your bank and platform immediately',true],['Do nothing',false],['Send more to recover',false],['Post their details online',false]]),
Q('Scholarship emails should be verified by:','Independent verification protects you.',[['Contacting the school directly',true],['Trusting the sender name',false],['Clicking the apply link',false],['Forwarding to friends',false]]),
]}});
topics.push({title:'Data privacy',description:'Protect personal information and understand what apps really collect.',items:[
{title:'What apps collect',content:'Apps collect more than you expect: location, contacts, usage, device IDs. Free apps often monetise your data.\n\nWhat to do:\n- Review permissions before installing.\n- Deny access that is not needed.\n- Uninstall apps you no longer use.'},
{title:'Sharing and oversharing',content:'Posting personal details (birthday, school, location) helps attackers build profiles for phishing and identity theft.\n\nWhat to do:\n- Keep accounts private where possible.\n- Avoid posting real-time location.\n- Think before you share.'},
{title:'Data rights',content:'You can request access, correction, or deletion of your data under privacy laws. Read privacy policies for retention and sharing.\n\nWhat to do:\n- Use account privacy settings.\n- Request data deletion when leaving a service.\n- Prefer services with clear policies.'}],
quiz:{slug:'privacy-demo',title:'Data privacy check',qs:[
Q('Which permission is least needed for a calculator app?','Location is unrelated to calculation.',[['Location',true],['Storage',false],['Camera',false],['Network',false]]),
Q('Best practice for app permissions?','Grant only what is needed.',[['Deny unnecessary permissions',true],['Allow all for convenience',false],['Ignore permission prompts',false],['Share with friends',false]]),
Q('Oversharing risk?','Personal details fuel targeted attacks.',[['Enables phishing and identity theft',true],['Faster downloads',false],['Better ads only',false],['No risk',false]]),
Q('What can you request under privacy laws?','Access, correction, deletion.',[['Access, correction, or deletion of your data',true],['Free premium access',false],['Source code',false],['Employee salaries',false]]),
Q('Before installing an app, you should:','Check permissions and policy.',[['Read permissions and privacy policy',true],['Install immediately',false],['Share the link',false],['Ignore reviews',false]]),
Q('Public Wi-Fi risk?','Untrusted networks can expose data.',[['Data interception on untrusted networks',true],['Faster battery drain',false],['Screen glare',false],['No risk with HTTPS only',false]]),
]}});
topics.push({title:'Responsible internet use',description:'Practise ethical, lawful, and respectful behaviour online.',items:[
{title:'Digital citizenship',content:'Being a good digital citizen means respecting others, following laws, and thinking before posting. Your online actions have real consequences.\n\nWhat to do:\n- Be kind and respectful.\n- Verify before sharing.\n- Protect your reputation.'},
{title:'Cyberbullying and harassment',content:'Online harassment harms people and can be illegal. Bystanders can help by reporting and supporting targets.\n\nWhat to do:\n- Do not participate in abuse.\n- Report harassment.\n- Support affected peers.'},
{title:'Copyright and plagiarism',content:'Sharing or copying work without permission can violate copyright and academic rules. Always credit sources.\n\nWhat to do:\n- Cite sources properly.\n- Use licensed or free-to-use media.\n- Ask when unsure.'}],
quiz:{slug:'ethics-demo',title:'Responsible internet use check',qs:[
Q('Good digital citizenship includes:','Respect and responsibility.',[['Respecting others and verifying before sharing',true],['Sharing everything immediately',false],['Anonymous insults',false],['Ignoring rules',false]]),
Q('If you witness cyberbullying, you should:','Reporting helps stop harm.',[['Report and support the target',true],['Join in',false],['Ignore it',false],['Share the content',false]]),
Q('Using an image without permission may:','Copyright protects creators.',[['Violate copyright',true],['Be always fine',false],['Only matter for videos',false],['Be encouraged',false]]),
Q('Before posting, ask:','Think about impact.',[['Would I say this in person?',true],['Will it get likes?',false],['Is it funny?',false],['Can I delete it later?',false]]),
Q('Plagiarism is:','Using others work without credit.',[['Using others work without credit',true],['Quoting with citation',false],['Paraphrasing with credit',false],['Original work',false]]),
Q('Responsible sharing means:','Verify and respect privacy.',[['Verify facts and respect privacy',true],['Share rumours quickly',false],['Post personal data of others',false],['Ignore sources',false]]),
]}});
for(const t of topics){const mod=ensureModule(t.title,t.description);for(const it of t.items)ensureItem(mod.id,it.title,it.content);const qz=ensureQuiz(t.quiz.slug,t.quiz.title,'Demo quiz for '+t.title);for(const q of t.quiz.qs)ensureQuestion(qz.id,q.prompt,q.explanation,q.options);console.log('Seeded:',t.title);}
const demoStudents=[
{email:'demo.ana@example.test',username:'ana',displayName:'Ana Reyes',modules:[],quiz:{slug:'phishing-demo',score:5,max:6}},
{email:'demo.ben@example.test',username:'ben',displayName:'Ben Cruz',modules:[],quiz:{slug:'passwords-demo',score:4,max:6}},
{email:'demo.cara@example.test',username:'cara',displayName:'Cara Lim',modules:[],quiz:{slug:'scams-demo',score:3,max:6}},
{email:'demo.dan@example.test',username:'dan',displayName:'Dan Ong',modules:[],quiz:null},
{email:'demo.eve@example.test',username:'eve',displayName:'Eve Tan',modules:[],quiz:{slug:'privacy-demo',score:6,max:6}},
];
const modIds=topics.map(t=>db.prepare('SELECT id FROM modules WHERE title=?').get(t.title).id);
demoStudents[0].modules=[modIds[0],modIds[1]];
demoStudents[1].modules=[modIds[0],modIds[1],modIds[2]];
demoStudents[2].modules=[modIds[0]];
demoStudents[4].modules=modIds.slice();
for(const s of demoStudents){
const u=ensureUser(s.email,s.username,s.displayName);
for(const mid of s.modules){const items=modulesDb.listItems(db,mid);for(const it of items)modulesDb.markComplete(db,u.id,it.id);}
if(s.quiz){const quiz=db.prepare('SELECT * FROM quizzes WHERE slug=?').get(s.quiz.slug);if(quiz){const ex=db.prepare('SELECT id FROM quiz_attempts WHERE user_id=? AND quiz_id=?').get(u.id,quiz.id);if(!ex){const att=attemptsDb.create(db,{userId:u.id,quizId:quiz.id,maxPoints:s.quiz.max});const qs=db.prepare('SELECT id FROM quiz_questions WHERE quiz_id=?').all(quiz.id);db.prepare(`UPDATE quiz_attempts SET status='submitted', score_points=?, max_points=?, submitted_at=? WHERE id=?`).run(s.quiz.score,s.quiz.max,now,att.id);}}}
db.prepare('UPDATE users SET last_login_at=? WHERE email IN (?,?,?,?,?)').run(now,...demoStudents.map(x=>x.email));
console.log('Demo student:',s.displayName);}
console.log('Seed demo complete.');
db.close();
