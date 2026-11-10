import {ownershipSchemaReady,publicAccountsReady,getPublicAccountUser,
  hashManagementToken,createManagementToken} from "./ownership.js";
import {authConfigReady,authReadiness,authStart,authCallback,authSession,authLogout}
  from "./public-session.js";
// Full-stack Cloudflare Worker: public reading, Turnstile-protected text posts and reports.
// Submission endpoints fail closed until Turnstile secrets and a rate limiter are configured.
const cacheHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const SITE_HOST = "votethemofftheroad.com";
const SITE_ORIGIN = "https://" + SITE_HOST;
const idPattern = /^[a-zA-Z0-9_-]{6,80}$/;
const reportReasons = new Set(["harassment", "private_info", "false_claim", "copyright", "removal_request", "other"]);
// Phase 3 features activate only when the D1 schema migration has run.
const behaviorCategories = {
  bad_parking: "Parking fails",
  cutting_off: "Cut-offs & close calls",
  tailgating: "Tailgating",
  distracted: "Distracted driving",
  signal: "Signals & intersections",
  speeding: "Speeding",
  road_rage: "Road rage",
  roadside: "Other roadside oddities",
  funny_unexpected: "Funny / Unexpected",
  other: "Other"
};
// The third vote is gated on the final step of the non-destructive 0004 migration.
let humorSchemaCache = { until: 0, ready: false };
async function humorSchemaReady(env) {
  if (!env.DB) return false;
  if (humorSchemaCache.until > Date.now()) return humorSchemaCache.ready;
  try {
    const migrated = await env.DB.prepare(
      "SELECT id FROM humor_migration_complete WHERE id=1"
    ).first();
    if (!migrated) throw new Error("Missing activation marker");
    await env.DB.prepare("SELECT choice FROM votes_v4 LIMIT 0").all();
    await env.DB.prepare("SELECT week_start FROM weekly_funny_awards LIMIT 0").all();
    humorSchemaCache = { until: Date.now()+30000, ready: true };
  } catch {
    humorSchemaCache = { until: Date.now()+30000, ready: false };
  }
  return humorSchemaCache.ready;
}
async function activeVoteTable(env) {
  return (await humorSchemaReady(env)) ? "votes_v4" : "votes";
}

let featureSchemaCache = { until: 0, ready: false };
async function featureSchemaReady(env) {
  if (!env.DB) return false;
  if (featureSchemaCache.until > Date.now()) return featureSchemaCache.ready;
  try {
    await env.DB.prepare("SELECT category,auto_hidden_at,reviewed_at FROM incidents LIMIT 0").all();
    await env.DB.prepare("SELECT reporter_key_hash,network_key_hash FROM reports LIMIT 0").all();
    featureSchemaCache = { until: Date.now() + 30000, ready: true };
  } catch {
    featureSchemaCache = { until: Date.now() + 30000, ready: false };
  }
  return featureSchemaCache.ready;
}
function reportHideThreshold(env) {
  const n = Number(env.AUTO_HIDE_REPORT_THRESHOLD ?? 5);
  return Number.isSafeInteger(n) && n >= 3 && n <= 25 ? n : 5;
}
const autoHideMinimumNetworks = 3;
const autoHideWindowSeconds = 7 * 86400;
async function reportNetworkHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !env.TURNSTILE_SECRET_KEY) return null;
  const key = await crypto.subtle.importKey("raw",
    new TextEncoder().encode("report-network:" + env.TURNSTILE_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}

const EASTERN_TZ = "America/New_York";
const easternFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
function easternParts(date) {
  return Object.fromEntries(easternFormatter.formatToParts(date)
    .filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
function easternDateKey(date = new Date()) {
  const p = easternParts(date);
  return [p.year, String(p.month).padStart(2,"0"), String(p.day).padStart(2,"0")].join("-");
}
function shiftDateKey(key, days) {
  return new Date(Date.parse(key + "T12:00:00Z") + days * 86400000)
    .toISOString().slice(0, 10);
}
function easternMidnight(key) {
  const [year, month, day] = key.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target + 5 * 3600000;
  for (let i = 0; i < 4; i++) {
    const p = easternParts(new Date(guess));
    guess += target - Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  }
  return Math.floor(guess / 1000);
}
function easternWeekKey(offset = 0, date = new Date()) {
  const key = easternDateKey(date);
  const dow = new Date(key + "T12:00:00Z").getUTCDay();
  return shiftDateKey(key,-((dow+6)%7)-offset*7);
}
function currentWeekStart() { return easternMidnight(easternWeekKey()); }
function nextEasternWeekStart() {
  return easternMidnight(shiftDateKey(easternWeekKey(),7));
}
function easternGameDay(date = new Date()) {
  const key = easternDateKey(date);
  return { key, start: easternMidnight(key),
    nextReset: easternMidnight(shiftDateKey(key,1)) };
}
let gameSchemaCache = { until: 0, ready: false };
async function gameSchemaReady(env) {
  if (!env.DB) return false;
  if (gameSchemaCache.until > Date.now()) return gameSchemaCache.ready;
  try {
    await env.DB.prepare("SELECT voter_key_hash FROM jury_daily_checkins LIMIT 0").all();
    await env.DB.prepare("SELECT week_start FROM weekly_awards LIMIT 0").all();
    await env.DB.prepare("SELECT left_id FROM battle_votes LIMIT 0").all();
    await env.DB.prepare("SELECT week_start FROM weekly_predictions LIMIT 0").all();
    await env.DB.prepare("SELECT week_start FROM weekly_category_results LIMIT 0").all();
    await env.DB.prepare("SELECT week_start FROM weekly_snapshots LIMIT 0").all();
    await env.DB.prepare("SELECT saved_day FROM jury_streak_saves LIMIT 0").all();
    gameSchemaCache = { until:Date.now()+30000, ready:true };
  } catch {
    gameSchemaCache = { until:Date.now()+30000, ready:false };
  }
  return gameSchemaCache.ready;
}


const XP_LEVELS = [
  {xp:0,name:"Jury Member",icon:"⚖️"},
  {xp:100,name:"Regular Juror",icon:"✅"},
  {xp:350,name:"Road Referee",icon:"🛡️"},
  {xp:1000,name:"Jury Foreperson",icon:"🏅"},
  {xp:2500,name:"Judge",icon:"👨‍⚖️"},
  {xp:7000,name:"Chief Justice",icon:"👑"}
];
let xpSchemaCache={until:0,ready:false};
async function xpSchemaReady(env){
  if(!env.DB)return false;
  if(xpSchemaCache.until>Date.now())return xpSchemaCache.ready;
  try{
    const marker=await env.DB.prepare("SELECT id FROM jury_xp_migration_complete WHERE id=1").first();
    if(!marker)throw Error("Jury XP not activated");
    await env.DB.prepare("SELECT event_key FROM jury_xp_events LIMIT 0").all();
    await env.DB.prepare("SELECT incident_id FROM jury_verdict_guesses LIMIT 0").all();
    xpSchemaCache={until:Date.now()+30000,ready:true};
  }catch{
    xpSchemaCache={until:Date.now()+30000,ready:false};
  }
  return xpSchemaCache.ready;
}
// Event keys are deterministic and keyed to the anonymous voter. Repeating a
// vote, changing a choice, or reloading cannot award the same XP twice.
async function awardJuryXP(env,voter,eventKey,kind,xp,day=easternDateKey()){
  if(!voter||!(await xpSchemaReady(env)))return false;
  const saved=await env.DB.prepare(
    "INSERT OR IGNORE INTO jury_xp_events "+
    "(voter_key_hash,event_key,kind,xp,eastern_day) VALUES(?,?,?,?,?)"
  ).bind(voter,eventKey,kind,xp,day).run();
  return Number(saved.meta?.changes||0)>0;
}
async function awardLimitedDailyXP(env,voter,eventKey,kind,xp,maxPerDay=3,day=easternDateKey()){
  if(!voter||!(await xpSchemaReady(env)))return false;
  const saved=await env.DB.prepare(
    "INSERT OR IGNORE INTO jury_xp_events "+
    "(voter_key_hash,event_key,kind,xp,eastern_day) "+
    "SELECT ?,?,?,?,? WHERE "+
    "(SELECT COUNT(*) FROM jury_xp_events WHERE voter_key_hash=? "+
    "AND eastern_day=? AND kind=?) < ?"
  ).bind(voter,eventKey,kind,xp,day,voter,day,kind,maxPerDay).run();
  return Number(saved.meta?.changes||0)>0;
}
async function awardReturningJurorXP(env,voter,day=easternDateKey()){
  if(!(await xpSchemaReady(env)))return false;
  const previous=shiftDateKey(day,-1);
  const didReturn=await env.DB.prepare(
    "SELECT 1 FROM jury_xp_events WHERE voter_key_hash=? AND eastern_day=? "+
    "AND kind IN ('vote','battle','verdict_guess','caught_up') LIMIT 1"
  ).bind(voter,previous).first();
  return didReturn?awardJuryXP(env,voter,"return:"+day,"return",5,day):false;
}
async function awardJuryDutyXP(env,voter,day=easternDateKey()){
  if(!(await xpSchemaReady(env)))return false;
  const vt=await activeVoteTable(env);
  const start=easternMidnight(day),end=easternMidnight(shiftDateKey(day,1));
  const [today,remaining]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM "+vt+
      " WHERE voter_key_hash=? AND created_at>=? AND created_at<?")
      .bind(voter,start,end).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM incidents i "+
      "WHERE i.state_code='NH' AND i.status='published' "+
      "AND NOT EXISTS (SELECT 1 FROM "+vt+" v WHERE v.incident_id=i.id "+
      "AND v.voter_key_hash=?)").bind(voter).first()
  ]);
  const totalToday=Number(today?.n||0);
  const target=Math.min(3,totalToday+Number(remaining?.n||0));
  if(totalToday<1||totalToday<target)return false;
  return awardJuryXP(env,voter,"duty:"+day,"jury_duty",20,day);
}
async function rewardJuryAction(env,voter,action){
  if(!(await xpSchemaReady(env)))return;
  try{
    const day=easternDateKey();
    let meaningful=false;
    if(action.type==="vote"){
      meaningful=await awardJuryXP(env,voter,"vote:"+action.incidentId,"vote",10,day);
      await awardJuryDutyXP(env,voter,day);
    }else if(action.type==="battle"){
      meaningful=await awardLimitedDailyXP(env,voter,"battle:"+action.pair,"battle",5,3,day);
    }else if(action.type==="caught_up"){
      meaningful=await awardJuryXP(env,voter,"caught-up:"+day,"caught_up",5,day);
    }
    // Editing an existing vote isn't a new action and cannot farm the return bonus.
    if(meaningful)await awardReturningJurorXP(env,voter,day);
  }catch(error){
    // A transient XP outage must not invalidate a legitimate recorded vote.
    console.error("Jury XP awarding error",error?.message||"unknown");
  }
}
async function settleWeeklyPredictionXP(env,voter){
  if(!(await gameSchemaReady(env)) || !(await xpSchemaReady(env)))return;
  // Award only after official archived category counts exist. Ties earn credit.
  const wins=await env.DB.prepare(
    "SELECT p.week_start FROM weekly_predictions p "+
    "JOIN weekly_snapshots s ON s.week_start=p.week_start "+
    "JOIN weekly_category_results r ON r.week_start=p.week_start "+
    "AND r.category=p.predicted_category "+
    "WHERE p.voter_key_hash=? AND r.incident_count>0 "+
    "AND r.incident_count=(SELECT MAX(q.incident_count) FROM "+
    "weekly_category_results q WHERE q.week_start=p.week_start) "+
    "ORDER BY p.week_start DESC LIMIT 36"
  ).bind(voter).all();
  for(const row of wins.results||[]){
    const week=Number(row.week_start);
    await awardJuryXP(env,voter,"weekly-prediction:"+week,
      "weekly_prediction",30,easternDateKey());
  }
}
async function juryXPOverview(request,env){
  const ready=await xpSchemaReady(env);
  const day=easternGameDay();
  const voter=await juryVoterHash(request,env);
  if(!ready||!voter)return json({ready:false,
    message:ready?"Refresh to start your anonymous Jury XP profile":
      "Jury XP launches after database migration 0005.",ranks:XP_LEVELS});
  try{await settleWeeklyPredictionXP(env,voter);}catch(error){
    console.error("Weekly prediction XP settlement error",error?.message||"unknown");
  }
  const vt=await activeVoteTable(env);
  const [total,events,votes,available,eligibleGuess,battles,duelReady]=await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(xp),0) AS xp FROM jury_xp_events WHERE voter_key_hash=?")
      .bind(voter).first(),
    env.DB.prepare("SELECT kind,COUNT(*) AS n,COALESCE(SUM(xp),0) AS xp FROM jury_xp_events "+
      "WHERE voter_key_hash=? AND eastern_day=? GROUP BY kind")
      .bind(voter,day.key).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM "+vt+
      " WHERE voter_key_hash=? AND created_at>=? AND created_at<?")
      .bind(voter,day.start,day.nextReset).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM incidents i WHERE i.state_code='NH' "+
      "AND i.status='published' AND NOT EXISTS "+
      "(SELECT 1 FROM "+vt+" v WHERE v.incident_id=i.id AND v.voter_key_hash=?)")
      .bind(voter).first(),
    env.DB.prepare(
      "SELECT 1 FROM incidents i WHERE i.state_code='NH' AND i.status='published' "+
      "AND EXISTS(SELECT 1 FROM "+vt+" v WHERE v.incident_id=i.id) "+
      "AND NOT EXISTS(SELECT 1 FROM jury_verdict_guesses g "+
      "WHERE g.incident_id=i.id AND g.voter_key_hash=?) LIMIT 1"
    ).bind(voter).first(),
    await gameSchemaReady(env) ? env.DB.prepare(
      "SELECT COUNT(*) AS n FROM battle_votes WHERE voter_key_hash=? "+
      "AND created_at>=? AND created_at<?"
    ).bind(voter,day.start,day.nextReset).first() : Promise.resolve({n:0}),
    await gameSchemaReady(env) ? env.DB.prepare(
      "SELECT 1 FROM incidents a JOIN incidents b "+
      "ON a.category=b.category AND a.id<b.id "+
      "WHERE a.state_code='NH' AND b.state_code='NH' "+
      "AND a.status='published' AND b.status='published' "+
      "AND a.created_at>=? AND a.created_at<? "+
      "AND b.created_at>=? AND b.created_at<? "+
      "AND NOT EXISTS (SELECT 1 FROM battle_votes v "+
      "WHERE v.left_id=a.id AND v.right_id=b.id AND v.voter_key_hash=?) "+
      "LIMIT 1"
    ).bind(currentWeekStart(),nextEasternWeekStart(),
      currentWeekStart(),nextEasternWeekStart(),voter).first() : Promise.resolve(null)
  ]);
  const xp=Number(total?.xp||0);
  const rank=[...XP_LEVELS].reverse().find(r=>xp>=r.xp)||XP_LEVELS[0];
  const next=XP_LEVELS.find(r=>r.xp>xp)||null;
  const activity=Object.fromEntries((events.results||[]).map(row=>[row.kind,
    {count:Number(row.n||0),xp:Number(row.xp||0)}]));
  const todayVotes=Number(votes?.n||0),remaining=Number(available?.n||0);
  const dutyTarget=Math.min(3,todayVotes+remaining);
  const checkin=Number(activity.caught_up?.count||0);
  const missions=[
    {id:"first-verdict",title:"Cast a fresh verdict",description:"Judge a case you haven't voted on.",
      progress:Math.min(1,todayVotes),target:1,available:todayVotes>0||remaining>0,
      reward_xp:10,complete:todayVotes>=1},
    {id:"daily-duty",title:dutyTarget?"Complete Daily Jury Duty":"All caught up?",
      description:dutyTarget?"Judge up to three new cases.":"Check in when you've voted on every available case.",
      progress:dutyTarget?Math.min(dutyTarget,todayVotes):checkin,
      target:dutyTarget||1,available:true,
      reward_xp:dutyTarget?20:5,
      complete:dutyTarget?
        Number(activity.jury_duty?.count||0)>0:checkin>0},
    {id:"guess",title:"Guess a community verdict",description:"Pick the leading reaction before seeing its tally.",
      progress:Math.min(1,Number(activity.verdict_guess?.count||0)),
      target:1,available:Boolean(eligibleGuess)||Number(activity.verdict_guess?.count||0)>0,
      reward_xp:5,complete:Number(activity.verdict_guess?.count||0)>0},
    {id:"duel",title:"Judge a head-to-head",description:"Pick between two cases in the same category.",
      progress:Math.min(1,Number(activity.battle?.count||0)),
      target:1,available:Boolean(duelReady)||Number(activity.battle?.count||0)>0,
      reward_xp:5,complete:Number(activity.battle?.count||0)>0}
  ];
  // A duel can be unavailable despite the presence of prior actions; the
  // challenge is not required to complete Daily Jury Duty.
  return json({ready:true,xp,rank,next_rank:next,
    xp_to_next:next?next.xp-xp:0,ranks:XP_LEVELS,day:day.key,
    next_reset_at:day.nextReset,today_xp:(events.results||[]).reduce((sum,row)=>
      sum+Number(row.xp||0),0),missions});
}


async function getVerdictGuess(request,env){
  if(!(await xpSchemaReady(env)))return json({
    ready:false,message:"Guess the Verdict opens after migration 0005."});
  const voter=await juryVoterHash(request,env);
  if(!voter)return json({ready:false,message:"Reload to start your anonymous Jury XP profile."});
  const category=new URL(request.url).searchParams.get("category")||"";
  if(category && !Object.hasOwn(behaviorCategories,category))
    return json({error:"Invalid category"},400);
  const vt=await activeVoteTable(env);
  const query=
    "SELECT i.id,i.title,i.category,SUBSTR(i.description,1,260) AS description " +
    "FROM incidents i WHERE i.state_code='NH' AND i.status='published' " +
    (category?"AND i.category=? ":"")+
    "AND EXISTS(SELECT 1 FROM "+vt+" v WHERE v.incident_id=i.id) "+
    "AND NOT EXISTS(SELECT 1 FROM jury_verdict_guesses g "+
    "WHERE g.incident_id=i.id AND g.voter_key_hash=?) "+
    "ORDER BY i.created_at DESC LIMIT 30";
  const rows=await env.DB.prepare(query)
    .bind(...(category?[category]:[]),voter).all();
  const incidents=rows.results||[];
  if(!incidents.length)return json({ready:true,incident:null,
    message:"No unguessed cases with community reactions in this category yet. New votes will unlock more."});
  // Rotating among the most recent 30 eligible cases makes the game replayable
  // without showing the tallies before the first guess.
  const chosen=incidents[Math.floor(Math.random()*incidents.length)];
  return json({ready:true,incident:chosen,
    message:"Predict the reaction currently leading this case. Results are revealed after your first guess."});
}
async function castVerdictGuess(request,env){
  if(!(await xpSchemaReady(env)))return json({error:"Verdict guessing is not active yet"},503);
  if(!isCommunityActionAllowed(request))return json({error:"Invalid request origin"},403);
  const voter=await juryVoterHash(request,env);
  if(!voter)return json({error:"Refresh the page to establish your jury ID"},428);
  const parsed=await parseBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const id=parsed.value.incident_id,guess=parsed.value.guess;
  if(!idPattern.test(id||"")||!["off","pass","funny"].includes(guess))
    return json({error:"Select a valid case and reaction"},400);
  if(!(await limitJuryAction(request,env)))
    return json({error:"Too many jury actions. Try later."},429);
  const vt=await activeVoteTable(env);
  const counts=await env.DB.prepare(
    "SELECT i.id,COUNT(CASE WHEN v.choice='off' THEN 1 END) AS off_votes,"+
    "COUNT(CASE WHEN v.choice='pass' THEN 1 END) AS pass_votes,"+
    "COUNT(CASE WHEN v.choice='funny' THEN 1 END) AS funny_votes "+
    "FROM incidents i JOIN "+vt+" v ON v.incident_id=i.id "+
    "WHERE i.id=? AND i.status='published' AND i.state_code='NH' "+
    "GROUP BY i.id"
  ).bind(id).first();
  if(!counts)return json({error:"The case has no community reactions yet or is no longer public."},409);
  const totals={off:Number(counts.off_votes||0),
    pass:Number(counts.pass_votes||0),funny:Number(counts.funny_votes||0)};
  const max=Math.max(...Object.values(totals));
  const leaders=Object.entries(totals).filter(([_,n])=>n===max);
  const resultChoice=leaders.length===1?leaders[0][0]:null;
  const correct=Boolean(resultChoice&&resultChoice===guess);
  const day=easternDateKey();
  const saved=await env.DB.prepare(
    "INSERT OR IGNORE INTO jury_verdict_guesses "+
    "(incident_id,voter_key_hash,guess,result_choice,was_correct,"+
    "off_votes,pass_votes,funny_votes,eastern_day) "+
    "SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM incidents "+
    "WHERE id=? AND status='published')"
  ).bind(id,voter,guess,resultChoice,resultChoice?Number(correct):null,
    totals.off,totals.pass,totals.funny,day,id).run();
  if(!saved.meta?.changes)return json({error:"You already guessed this case. Try another."},409);
  let earned=0;
  try{
    const participationAward=await awardLimitedDailyXP(
      env,voter,"guess:"+id,"verdict_guess",5,2,day);
    if(participationAward)earned+=5;
    if(participationAward&&correct&&totals.off+totals.pass+totals.funny>=2 &&
      await awardLimitedDailyXP(env,voter,"correct:"+id,"verdict_correct",5,2,day))
      earned+=5;
    await awardReturningJurorXP(env,voter,day);
  }catch(error){
    console.error("Verdict-guess XP failed",error?.message||"unknown");
  }
  return json({ok:true,incident_id:id,guess,current_lead:resultChoice,
    correct,tie:resultChoice===null,counts:totals,xp_earned:earned,
    message:resultChoice===null?"The community vote is tied!":
      correct?"You guessed the current leader!":"The jury currently leans a different way."});
}

async function myParticipation(request, env) {
  const time = easternGameDay();
  const ready = await gameSchemaReady(env);
  const hash = await juryVoterHash(request,env);
  const empty = { votes:0, recent_votes:0, today_votes:0, streak_days:0,
    daily_target:0, available_cases:0, duty_complete:false,
    can_check_in:false, badge:"New juror",next_badge_at:3,
    next_reset_at:time.nextReset,eastern_day:time.key,
    streak_calendar:[],can_save_streak:false,streak_save_day:null,game_features_enabled:ready };
  if (!hash) return json(empty);
  const vt=await activeVoteTable(env);
  const cutoff=easternMidnight(shiftDateKey(time.key,-370));
  const [overall,daily,history,remaining,checkins,saves]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS votes FROM " + vt + " WHERE voter_key_hash=?").bind(hash).first(),
    env.DB.prepare("SELECT COUNT(*) AS votes FROM " + vt + " WHERE voter_key_hash=? AND created_at>=? AND created_at<?")
      .bind(hash,time.start,time.nextReset).first(),
    env.DB.prepare("SELECT created_at FROM " + vt + " WHERE voter_key_hash=? AND created_at>=? ORDER BY created_at DESC LIMIT 5000")
      .bind(hash,cutoff).all(),
    env.DB.prepare("SELECT COUNT(*) AS remaining FROM incidents i WHERE i.state_code='NH' AND i.status='published' AND NOT EXISTS (SELECT 1 FROM " + vt + " v WHERE v.incident_id=i.id AND v.voter_key_hash=?)")
      .bind(hash).first(),
    ready ? env.DB.prepare("SELECT eastern_day FROM jury_daily_checkins WHERE voter_key_hash=? AND eastern_day>=?")
      .bind(hash,shiftDateKey(time.key,-370)).all() : Promise.resolve({results:[]}),
    ready ? env.DB.prepare("SELECT saved_day,eastern_month FROM jury_streak_saves WHERE voter_key_hash=? AND saved_day>=?")
      .bind(hash,shiftDateKey(time.key,-370)).all() : Promise.resolve({results:[]})
  ]);
  const votes=Number(overall?.votes||0);
  const todayVotes=Number(daily?.votes||0);
  const available=Number(remaining?.remaining||0);
  const activeDays=new Set((history.results||[]).map(row=>
    easternDateKey(new Date(Number(row.created_at)*1000))));
  for (const row of checkins.results||[]) activeDays.add(row.eastern_day);
  const savedDays=new Set((saves.results||[]).map(row=>row.saved_day));
  for(const key of savedDays)activeDays.add(key);
  const yesterday=shiftDateKey(time.key,-1);
  const threeBefore=[1,2,3].every(n=>activeDays.has(shiftDateKey(yesterday,-n)));
  const month=yesterday.slice(0,7);
  const saveUsed=(saves.results||[]).some(row=>row.eastern_month===month);
  const canSaveStreak=ready && !activeDays.has(yesterday) && threeBefore && !saveUsed;
  const activeToday=activeDays.has(time.key);
  let day=activeToday ? time.key : shiftDateKey(time.key,-1);
  let streak=0;
  while(streak<365 && activeDays.has(day)) {
    streak++;
    day=shiftDateKey(day,-1);
  }
  const target=Math.min(3,todayVotes+available);
  const calendar=[];
  for(let ago=13;ago>=0;ago--) {
    const key=shiftDateKey(time.key,-ago);
    calendar.push({day:key,active:activeDays.has(key),saved:savedDays.has(key)});
  }
  const tiers=[{min:0,name:"New juror"},{min:3,name:"Regular juror"},
    {min:10,name:"Road referee"},{min:25,name:"Veteran voter"},
    {min:100,name:"Legendary juror"}];
  const badge=[...tiers].reverse().find(t=>votes>=t.min).name;
  const next=tiers.find(t=>t.min>votes);
  return json({votes,recent_votes:(history.results||[]).filter(row=>
      Number(row.created_at)>=Math.floor(Date.now()/1000)-86400).length,
    today_votes:todayVotes,streak_days:streak,daily_target:target,
    available_cases:available,duty_complete:target>0?todayVotes>=target:activeToday,
    can_check_in:ready && target===0 && !activeToday,
    can_save_streak:canSaveStreak,streak_save_day:canSaveStreak?yesterday:null,
    badge,next_badge_at:next?.min||null,next_reset_at:time.nextReset,
    eastern_day:time.key,streak_calendar:calendar,game_features_enabled:ready});
}

function weeklyMinimumVotes(env) {
  const value=Number(env.WEEKLY_MIN_VOTES ?? 5);
  return Number.isSafeInteger(value) && value>=3 && value<=100 ? value : 5;
}
// A browser earns at most one weekly battle point per winning incident,
// even if it picks that same incident in more than one same-category duel.
// Both contenders and the duel must belong to the award's Eastern week.
function weeklyBattleScoreSQL() {
  return "SELECT bv.winner_id AS incident_id, COUNT(DISTINCT bv.voter_key_hash) AS wins " +
    "FROM battle_votes bv " +
    "JOIN incidents a ON a.id=bv.left_id " +
    "JOIN incidents b ON b.id=bv.right_id " +
    "WHERE a.state_code='NH' AND b.state_code='NH' " +
    "AND a.status='published' AND b.status='published' " +
    "AND a.category=b.category " +
    "AND bv.created_at>=? AND bv.created_at<? " +
    "AND a.created_at>=? AND a.created_at<? " +
    "AND b.created_at>=? AND b.created_at<? " +
    "GROUP BY bv.winner_id";
}
function weeklyBattleParams(start,end) {
  return [start,end,start,end,start,end];
}
async function weeklyBattlePoints(env,start,end) {
  if(!(await gameSchemaReady(env)))return new Map();
  const rows=await env.DB.prepare(weeklyBattleScoreSQL())
    .bind(...weeklyBattleParams(start,end)).all();
  return new Map((rows.results||[]).map(row=>
    [row.incident_id,Number(row.wins||0)]));
}

// Shared score query for the live weekly boards and Monday finalization.
// Worst score = Off votes + unique-browser same-category battle wins.
// Funniest score = Funny reactions + matching comedy duel wins (for funny-category cases).
// No migrations are required: all duel choices already live in battle_votes.
async function weeklyAwardCandidates(env,start,end,kind,qualifiedOnly=false,category="") {
  if(kind!=="worst" && kind!=="funny")throw new Error("Unknown weekly award");
  const vt=await activeVoteTable(env);
  const games=await gameSchemaReady(env);
  const battle=games?weeklyBattleScoreSQL():
    "SELECT NULL AS incident_id, 0 AS wins WHERE 0";
  const binds=[...(games?weeklyBattleParams(start,end):[]),start,end];
  const categoryWhere=kind==="funny" && category ? " AND i.category=?" : "";
  if(categoryWhere)binds.push(category);
  const points=kind==="worst"?"worst_points":"funny_points";
  const allowed=kind==="worst" ?
    "category<>'funny_unexpected' AND worst_points>0" :
    "(funny_points>0 OR category='funny_unexpected')";
  const qualification=kind==="worst" ?
    "worst_points>(pass_votes+funny_votes)" :
    "funny_points>(off_votes+pass_votes)";
  const qualifyWhere=qualifiedOnly?
    " AND total_actions>=? AND "+qualification:"";
  if(qualifiedOnly)binds.push(weeklyMinimumVotes(env));
  const ranking=kind==="worst" ?
    "PARTITION BY category ORDER BY worst_points DESC,off_votes DESC,total_actions DESC,created_at DESC,id ASC" :
    "ORDER BY funny_points DESC,funny_votes DESC,total_actions DESC,created_at DESC,id ASC";
  const sort=kind==="worst"?"category ASC,rank ASC":"rank ASC";
  const sql=
    "WITH battle_scores AS ("+battle+"), " +
    "reactions AS (SELECT i.id,i.title,i.category,i.created_at, " +
      "COUNT(CASE WHEN v.choice='off' THEN 1 END) AS off_votes, " +
      "COUNT(CASE WHEN v.choice='pass' THEN 1 END) AS pass_votes, " +
      "COUNT(CASE WHEN v.choice='funny' THEN 1 END) AS funny_votes " +
      "FROM incidents i LEFT JOIN "+vt+" v ON v.incident_id=i.id " +
      "WHERE i.state_code='NH' AND i.status='published' " +
      "AND i.created_at>=? AND i.created_at<?"+categoryWhere+" GROUP BY i.id), " +
    "scored AS (SELECT r.*,COALESCE(b.wins,0) AS battle_wins, " +
      "(r.off_votes+COALESCE(b.wins,0)) AS worst_points, " +
      "(r.funny_votes+CASE WHEN r.category='funny_unexpected' " +
        "THEN COALESCE(b.wins,0) ELSE 0 END) AS funny_points, " +
      "(r.off_votes+r.pass_votes+r.funny_votes+COALESCE(b.wins,0)) AS total_actions " +
      "FROM reactions r LEFT JOIN battle_scores b ON b.incident_id=r.id), " +
    "ranked AS (SELECT *,ROW_NUMBER() OVER ("+ranking+") AS rank " +
      "FROM scored WHERE "+allowed+qualifyWhere+") " +
    "SELECT * FROM ranked WHERE rank<=3 ORDER BY "+sort;
  const result=await env.DB.prepare(sql).bind(...binds).all();
  const minimum=weeklyMinimumVotes(env);
  return (result.results||[]).map(row=>{
    const off=Number(row.off_votes||0),pass=Number(row.pass_votes||0);
    const funny=Number(row.funny_votes||0),battleWins=Number(row.battle_wins||0);
    const worstScore=off+battleWins;
    const funnyBattleWins=row.category==="funny_unexpected"?battleWins:0;
    const funnyScore=funny+funnyBattleWins;
    const total=off+pass+funny+battleWins;
    return {...row,off_votes:off,pass_votes:pass,funny_votes:funny,
      battle_wins:battleWins,funny_battle_wins:funnyBattleWins,
      worst_score:worstScore,funny_score:funnyScore,
      score:kind==="worst"?worstScore:funnyScore,rank:Number(row.rank),
      total_votes:total,
      qualified:total>=minimum && (kind==="worst"?
        worstScore>pass+funny:funnyScore>off+pass)};
  });
}

async function weeklyBoard(env,offset=0) {
  const monday=easternWeekKey(offset);
  const start=easternMidnight(monday);
  const end=easternMidnight(shiftDateKey(monday,7));
  const minimum=weeklyMinimumVotes(env);
  if(!(await featureSchemaReady(env)))return json({
    ready:false,week_start:start,week_end:end,podiums:[],leaders:[],
    category_counts:[],categories:behaviorCategories,minimum_votes:minimum
  });
  const games=await gameSchemaReady(env);
  let archived=false,podiums=[];
  if(offset>0 && games) {
    archived=Boolean(await env.DB.prepare(
      "SELECT 1 FROM weekly_snapshots WHERE week_start=?"
    ).bind(start).first());
    if(archived){
      const [rows,battles]=await Promise.all([
        env.DB.prepare(
          "SELECT a.incident_id AS id,i.title,a.category,a.rank,a.off_votes,a.pass_votes " +
          "FROM weekly_awards a JOIN incidents i ON i.id=a.incident_id " +
          "WHERE a.week_start=? AND i.status='published' ORDER BY a.category,a.rank"
        ).bind(start).all(),
        weeklyBattlePoints(env,start,end)
      ]);
      podiums=(rows.results||[]).map(row=>{
        const battleWins=battles.get(row.id)||0;
        return {...row,off_votes:Number(row.off_votes),pass_votes:Number(row.pass_votes),
          battle_wins:battleWins,worst_score:Number(row.off_votes)+battleWins,
          score:Number(row.off_votes)+battleWins,
          total_votes:Number(row.off_votes)+Number(row.pass_votes)+battleWins,
          qualified:true};
      });
    }
  }
  if(!archived)podiums=await weeklyAwardCandidates(env,start,end,"worst");
  const counts=await env.DB.prepare(
    "SELECT category,COUNT(*) AS incidents FROM incidents " +
    "WHERE state_code='NH' AND status='published' GROUP BY category ORDER BY incidents DESC"
  ).all();
  const podiumWithImages=await attachImages(podiums,env);
  return json({ready:true,week_start:start,week_end:end,minimum_votes:minimum,
    archived,history_offset:offset,podiums:podiumWithImages,
    leaders:podiumWithImages.filter(row=>row.rank===1),
    categories:behaviorCategories,category_counts:counts.results||[],
    scoring:"1 Off vote = 1 point; 1 distinct-browser matchup win = 1 point"});
}

async function funniestWeekBoard(env,offset=0,category="") {
  const monday=easternWeekKey(offset);
  const start=easternMidnight(monday);
  const end=easternMidnight(shiftDateKey(monday,7));
  const minimum=weeklyMinimumVotes(env);
  if(!(await humorSchemaReady(env)) || !(await featureSchemaReady(env)))
    return json({ready:false,week_start:start,week_end:end,podiums:[],
      minimum_votes:minimum});
  if(category && !Object.hasOwn(behaviorCategories,category))
    return json({error:"Unknown incident category"},400);
  let archived=false,podiums=[];
  if(offset>0 && await gameSchemaReady(env)) {
    archived=Boolean(await env.DB.prepare(
      "SELECT 1 FROM weekly_snapshots WHERE week_start=?"
    ).bind(start).first());
    if(archived) {
      const [rows,battles]=await Promise.all([
        env.DB.prepare(
          "SELECT a.incident_id AS id,i.title,i.category,a.rank," +
          "a.off_votes,a.pass_votes,a.funny_votes FROM weekly_funny_awards a " +
          "JOIN incidents i ON i.id=a.incident_id " +
          "WHERE a.week_start=? AND i.status='published' " +
          (category?"AND i.category=? ":"")+"ORDER BY a.rank"
        ).bind(start,...(category?[category]:[])).all(),
        weeklyBattlePoints(env,start,end)
      ]);
      podiums=(rows.results||[]).map(row=>{
        const battleWins=row.category==="funny_unexpected"?(battles.get(row.id)||0):0;
        const off=Number(row.off_votes),pass=Number(row.pass_votes),funny=Number(row.funny_votes);
        return {...row,off_votes:off,pass_votes:pass,funny_votes:funny,
          battle_wins:battleWins,funny_battle_wins:battleWins,
          funny_score:funny+battleWins,score:funny+battleWins,
          total_votes:off+pass+funny+battleWins,qualified:true};
      });
    }
  }
  if(!archived)podiums=await weeklyAwardCandidates(env,start,end,"funny",false,category);
  const podiumWithImages=await attachImages(podiums,env);
  return json({ready:true,week_start:start,week_end:end,minimum_votes:minimum,
    archived,history_offset:offset,category,podiums:podiumWithImages,
    scoring:"1 Funny reaction = 1 point; 1 unique-browser funny-category duel win = 1 point"});
}

async function snapshotPreviousWeek(env,scheduledAt=Date.now()) {
  if(!(await featureSchemaReady(env)) || !(await gameSchemaReady(env)))return;
  const d=new Date(scheduledAt);
  const p=easternParts(d);
  const key=easternDateKey(d);
  const dow=new Date(key+"T12:00:00Z").getUTCDay();
  // The UTC cron fires twice at 04:05 and 05:05; only one is 00:05 Eastern.
  if(dow!==1 || p.hour!==0 || p.minute!==5)return;
  const monday=easternWeekKey(1,d);
  const start=easternMidnight(monday);
  const end=easternMidnight(shiftDateKey(monday,7));
  const existing=await env.DB.prepare(
    "SELECT 1 FROM weekly_snapshots WHERE week_start=?"
  ).bind(start).first();
  if(existing)return;
  const [worst,counts,funny]=await Promise.all([
    weeklyAwardCandidates(env,start,end,"worst",true),
    env.DB.prepare(
      "SELECT category,COUNT(*) AS count FROM incidents " +
      "WHERE state_code='NH' AND status='published' " +
      "AND created_at>=? AND created_at<? GROUP BY category"
    ).bind(start,end).all(),
    await humorSchemaReady(env) ?
      weeklyAwardCandidates(env,start,end,"funny",true) : Promise.resolve([])
  ]);
  const statements=[];
  for(const row of worst){
    statements.push(env.DB.prepare(
      "INSERT OR IGNORE INTO weekly_awards " +
      "(week_start,category,rank,incident_id,off_votes,pass_votes) VALUES(?,?,?,?,?,?)"
    ).bind(start,row.category,row.rank,row.id,row.off_votes,row.pass_votes));
  }
  const countMap=new Map((counts.results||[]).map(row=>[row.category,Number(row.count)]));
  for(const category of Object.keys(behaviorCategories)) {
    statements.push(env.DB.prepare(
      "INSERT OR IGNORE INTO weekly_category_results(week_start,category,incident_count) VALUES(?,?,?)"
    ).bind(start,category,countMap.get(category)||0));
  }
  for(const row of funny){
    statements.push(env.DB.prepare(
      "INSERT OR IGNORE INTO weekly_funny_awards " +
      "(week_start,rank,incident_id,funny_votes,off_votes,pass_votes) VALUES(?,?,?,?,?,?)"
    ).bind(start,row.rank,row.id,row.funny_votes,row.off_votes,row.pass_votes));
  }
  // Store all awards, category totals and the finalization marker atomically.
  statements.push(env.DB.prepare(
    "INSERT OR IGNORE INTO weekly_snapshots(week_start) VALUES(?)"
  ).bind(start));
  await env.DB.batch(statements);
  console.log("Finalized Eastern weekly awards",{
    week_start:start,worst_winners:worst.length,funniest_winners:funny.length
  });
}

function isCommunityActionAllowed(request) {
  const site=request.headers.get("Sec-Fetch-Site");
  return request.headers.get("Origin")===SITE_ORIGIN && (!site || site==="same-origin");
}
async function limitJuryAction(request,env) {
  if (!env.VOTE_RATE_LIMITER) return false;
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const allowed=await env.VOTE_RATE_LIMITER.limit({key:"ip:"+ip});
  return allowed.success===true;
}
async function juryCheckin(request,env) {
  const vt=await activeVoteTable(env);
  if (!(await gameSchemaReady(env))) return json({error:"The jury game migration is not active yet."},503);
  if (!isCommunityActionAllowed(request)) return json({error:"Invalid request origin"},403);
  const voter=await juryVoterHash(request,env);
  if (!voter) return json({error:"Reload the jury board to establish your browser ID"},428);
  if (!(await limitJuryAction(request,env))) return json({error:"Too many actions. Try later."},429);
  const remaining=await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM incidents i WHERE i.state_code='NH' AND i.status='published' " +
    "AND NOT EXISTS (SELECT 1 FROM " + vt + " v WHERE v.voter_key_hash=? AND v.incident_id=i.id)"
  ).bind(voter).first();
  if (Number(remaining?.count||0)>0) {
    return json({error:"There are new cases to vote on. Finish those to maintain your streak."},409);
  }
  const day=easternDateKey();
  const result=await env.DB.prepare(
    "INSERT OR IGNORE INTO jury_daily_checkins(voter_key_hash,eastern_day) VALUES(?,?)"
  ).bind(voter,day).run();
  if(Number(result.meta?.changes||0)>0)
    await rewardJuryAction(env,voter,{type:"caught_up"});
  return json({ok:true,day,already_checked_in:Number(result.meta?.changes||0)===0});
}

async function juryStreakSave(request,env) {
  const vt=await activeVoteTable(env);
  if (!(await gameSchemaReady(env))) return json({error:"Streak recovery is not yet available"},503);
  if (!isCommunityActionAllowed(request)) return json({error:"Invalid request origin"},403);
  const voter=await juryVoterHash(request,env);
  if(!voter)return json({error:"Reload the page first"},428);
  if(!(await limitJuryAction(request,env)))return json({error:"Too many requests. Try again shortly."},429);
  const today=easternDateKey();
  const missed=shiftDateKey(today,-1);
  const dates=[missed,...[1,2,3].map(n=>shiftDateKey(missed,-n))];
  const cutoff=easternMidnight(shiftDateKey(missed,-3));
  const end=easternMidnight(today);
  const [votes,checkins,saved]=await Promise.all([
    env.DB.prepare(
      "SELECT created_at FROM " + vt + " WHERE voter_key_hash=? AND created_at>=? AND created_at<? LIMIT 1000"
    ).bind(voter,cutoff,end).all(),
    env.DB.prepare(
      "SELECT eastern_day FROM jury_daily_checkins WHERE voter_key_hash=? AND eastern_day>=? AND eastern_day<?"
    ).bind(voter,shiftDateKey(missed,-3),today).all(),
    env.DB.prepare(
      "SELECT saved_day FROM jury_streak_saves WHERE voter_key_hash=? AND saved_day>=? AND saved_day<?"
    ).bind(voter,shiftDateKey(missed,-3),today).all()
  ]);
  const days=new Set((votes.results||[]).map(row=>
    easternDateKey(new Date(Number(row.created_at)*1000))));
  for(const row of checkins.results||[])days.add(row.eastern_day);
  for(const row of saved.results||[])days.add(row.saved_day);
  if(days.has(missed) || !dates.slice(1).every(day=>days.has(day)))
    return json({error:"No eligible missed day. A three-day streak immediately before yesterday is required."},409);
  const savedResult=await env.DB.prepare(
    "INSERT OR IGNORE INTO jury_streak_saves(voter_key_hash,eastern_month,saved_day) VALUES(?,?,?)"
  ).bind(voter,missed.slice(0,7),missed).run();
  if(!savedResult.meta?.changes)return json({error:"Your monthly streak save has already been used."},409);
  return json({ok:true,saved_day:missed,message:"Your missed day was saved. Your jury streak is protected."});
}
// One head-to-head duel requires two published cases in the SAME category
// and the SAME Eastern competition week. This keeps every duel relevant to
// the current weekly leaderboard and avoids mixing comedy with bad driving.
async function getBattle(request,env) {
  if (!(await gameSchemaReady(env)) || !(await featureSchemaReady(env)))
    return json({ready:false,message:"Head-to-head battles open after the database migration."});
  const category=new URL(request.url).searchParams.get("category")||"";
  if(category && !Object.hasOwn(behaviorCategories,category))
    return json({error:"Unknown head-to-head category"},400);
  const voter=await juryVoterHash(request,env);
  if(!voter)return json({ready:false,message:"Reload the page to activate your jury ID."});
  const start=currentWeekStart(),end=nextEasternWeekStart();
  const match=await env.DB.prepare(
    "SELECT a.id AS left_id,b.id AS right_id,a.category FROM incidents a " +
    "JOIN incidents b ON b.category=a.category AND a.id<b.id " +
    "WHERE a.state_code='NH' AND b.state_code='NH' " +
    "AND a.status='published' AND b.status='published' " +
    "AND a.created_at>=? AND a.created_at<? AND b.created_at>=? AND b.created_at<? " +
    (category ? "AND a.category=? " : "") +
    "AND NOT EXISTS (SELECT 1 FROM battle_votes bv WHERE bv.left_id=a.id AND bv.right_id=b.id " +
    "AND bv.voter_key_hash=?) ORDER BY RANDOM() LIMIT 1"
  ).bind(start,end,start,end,...(category?[category]:[]),voter).first();
  if(!match) {
    const candidates=await env.DB.prepare(
      "SELECT category FROM incidents WHERE state_code='NH' AND status='published' " +
      "AND created_at>=? AND created_at<? " +
      (category ? "AND category=? " : "") +
      "GROUP BY category HAVING COUNT(*)>=2 LIMIT 1"
    ).bind(start,end,...(category?[category]:[])).first();
    return json({ready:true,pair:null,
      message:candidates ?
        "You've judged all available "+(category ? behaviorCategories[category]+" " : "")+
        "same-category matchups this week. New cases will create new matchups." :
        (category ? "Head-to-head needs two "+behaviorCategories[category]+
          " cases published during the same Eastern contest week." :
          "Head-to-head needs two cases in the same category, both posted this week. Funny and Other cases can't be paired.")});
  }
  const rows=await env.DB.prepare(
    "SELECT id,title,description,category,location_label FROM incidents " +
    "WHERE id IN (?,?) AND state_code='NH' AND status='published' AND category=?"
  ).bind(match.left_id,match.right_id,match.category).all();
  if((rows.results||[]).length!==2)
    return json({ready:true,pair:null,message:"The matchup just changed. Try another."});
  const ordered=[match.left_id,match.right_id].map(id=>rows.results.find(row=>row.id===id));
  const [left,right]=await attachImages(ordered,env);
  const summarize=row=>({id:row.id,title:row.title,category:row.category,
    description:(row.description||"").slice(0,350),
    location_label:row.location_label,photo:row.photos?.[0]?.url||null});
  return json({ready:true,pair:[summarize(left),summarize(right)],
    category:match.category,competition:match.category==="funny_unexpected"?"funniest":"worst",
    message:match.category==="funny_unexpected" ?
      "Which funny case makes you laugh more? Your choice adds a weekly Funniest point." :
      "Which driving case is worse? Your choice adds a weekly Worst point."});
}
async function castBattleVote(request,env) {
  if (!(await gameSchemaReady(env)) || !(await featureSchemaReady(env)))
    return json({error:"Battles are not active yet"},503);
  if(!isCommunityActionAllowed(request))return json({error:"Invalid request origin"},403);
  const voter=await juryVoterHash(request,env);
  if(!voter)return json({error:"Refresh the page first"},428);
  const body=await parseBody(request);
  if(body.error)return json({error:body.error},body.status);
  const {left_id,right_id,winner_id}=body.value;
  if(!idPattern.test(left_id||"")||!idPattern.test(right_id||"")||
     left_id===right_id||(winner_id!==left_id&&winner_id!==right_id))
    return json({error:"Invalid battle selection"},400);
  if(!(await limitJuryAction(request,env)))return json({error:"Too many actions. Try later."},429);
  const start=currentWeekStart(),end=nextEasternWeekStart();
  const entries=await env.DB.prepare(
    "SELECT id,category FROM incidents WHERE id IN (?,?) " +
    "AND state_code='NH' AND status='published' AND created_at>=? AND created_at<?"
  ).bind(left_id,right_id,start,end).all();
  const cases=entries.results||[];
  if(cases.length!==2)return json({error:"One or both cases are no longer eligible for this week's matchup"},409);
  if(cases[0].category!==cases[1].category)
    return json({error:"Head-to-head voting requires two incidents from the same category"},409);
  const [first,second]=[left_id,right_id].sort();
  const saved=await env.DB.prepare(
    "INSERT OR IGNORE INTO battle_votes(left_id,right_id,voter_key_hash,winner_id) VALUES(?,?,?,?)"
  ).bind(first,second,voter,winner_id).run();
  if(Number(saved.meta?.changes||0)===0)
    return json({error:"This browser already judged that pairing"},409);
  await rewardJuryAction(env,voter,{type:"battle",pair:first+"|"+second});
  const result=await env.DB.prepare(
    "SELECT winner_id,COUNT(*) AS wins FROM battle_votes " +
    "WHERE left_id=? AND right_id=? GROUP BY winner_id"
  ).bind(first,second).all();
  return json({ok:true,winner_id,category:cases[0].category,
    competition:cases[0].category==="funny_unexpected"?"funniest":"worst",
    results:(result.results||[]).map(row=>
      ({id:row.winner_id,votes:Number(row.wins||0)}))});
}

async function juryPrediction(request,env) {
  if (!(await gameSchemaReady(env)) || !(await featureSchemaReady(env)))
    return json({ready:false,message:"Predictions open after the game database migration."});
  const voter=await juryVoterHash(request,env);
  if (!voter)return json({ready:false,message:"Reload the site to establish your jury ID."});
  const nextStart=nextEasternWeekStart();
  const previous=easternMidnight(easternWeekKey(1));
  const [pick,history,result]=await Promise.all([
    env.DB.prepare(
      "SELECT predicted_category FROM weekly_predictions WHERE week_start=? AND voter_key_hash=?"
    ).bind(nextStart,voter).first(),
    env.DB.prepare(
      "SELECT p.week_start,p.predicted_category," +
      "(SELECT MAX(incident_count) FROM weekly_category_results r WHERE r.week_start=p.week_start) AS max_count," +
      "(SELECT incident_count FROM weekly_category_results r WHERE r.week_start=p.week_start " +
      "AND r.category=p.predicted_category) AS predicted_count " +
      "FROM weekly_predictions p WHERE p.voter_key_hash=? AND p.week_start<? " +
      "ORDER BY p.week_start DESC LIMIT 50"
    ).bind(voter,currentWeekStart()).all(),
    env.DB.prepare(
      "SELECT category,incident_count FROM weekly_category_results WHERE week_start=? " +
      "ORDER BY incident_count DESC,category ASC"
    ).bind(previous).all()
  ]);
  const past=(history.results||[]).filter(row=>Number(row.max_count)>0);
  const correct=past.filter(row=>Number(row.predicted_count)===Number(row.max_count));
  const resultRows=result.results||[];
  const high=Number(resultRows[0]?.incident_count||0);
  const winnerCategories=high>0 ?
    resultRows.filter(row=>Number(row.incident_count)===high).map(row=>row.category) : [];
  return json({ready:true,for_week_start:nextStart,
    can_change_until:nextStart,selection:pick?.predicted_category||null,
    categories:behaviorCategories,total_predictions_settled:past.length,
    correct_predictions:correct.length,
    last_week:{week_start:previous,winners:winnerCategories,
      qualifying_submissions:high}});
}
async function saveJuryPrediction(request,env) {
  if (!(await gameSchemaReady(env)))return json({error:"Predictions are not active yet"},503);
  if(!isCommunityActionAllowed(request))return json({error:"Invalid request origin"},403);
  const voter=await juryVoterHash(request,env);
  if(!voter)return json({error:"Reload the site first"},428);
  const parsed=await parseBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const category=parsed.value.category;
  if(typeof category!=="string" || !Object.hasOwn(behaviorCategories,category))
    return json({error:"Select a valid category"},400);
  if(!(await limitJuryAction(request,env)))return json({error:"Too many predictions. Try later."},429);
  const week=nextEasternWeekStart();
  await env.DB.prepare(
    "INSERT INTO weekly_predictions(week_start,voter_key_hash,predicted_category) VALUES(?,?,?) " +
    "ON CONFLICT(week_start,voter_key_hash) DO UPDATE SET " +
    "predicted_category=excluded.predicted_category,created_at=unixepoch()"
  ).bind(week,voter,category).run();
  return json({ok:true,week_start:week,category,
    message:"Prediction saved for next week. Come back after that week closes to see whether you were right."});
}
const maxPhotos = 5;
const maxPhotoBytes = 5 * 1024 * 1024;
const maxRequestBytes = 32 * 1024 * 1024;
const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
function photosReady(env) { return writesReady(env) && Boolean(env.PHOTOS); }
function imageSignatureIsValid(bytes, type) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (type === "image/webp") return [82,73,70,70].every((v,i) => bytes[i] === v) && [87,69,66,80].every((v,i) => bytes[i+8] === v);
  return false;
}
async function attachImages(incidents, env, urlPrefix="/media/") {
  if (!incidents.length) return incidents;
  const ids = [...new Set(incidents.map(row => row.id))];
  const placeholders = ids.map(() => "?").join(",");
  const result = await env.DB.prepare(
    "SELECT id, incident_id, display_order FROM incident_media WHERE media_type = 'image' AND incident_id IN (" + placeholders + ") ORDER BY display_order ASC"
  ).bind(...ids).all();
  const byIncident = new Map(ids.map(id => [id, []]));
  for (const m of result.results || []) {
    byIncident.get(m.incident_id)?.push({ id:m.id,
      url:urlPrefix+encodeURIComponent(m.id) });
  }
  return incidents.map(i => ({ ...i, photos: byIncident.get(i.id) || [] }));
}
async function serveImage(id, env, includeUnpublished=false) {
  if (!env.PHOTOS || !env.DB || !idPattern.test(id))
    return new Response("Not found", { status: 404 });
  // Only call with includeUnpublished=true AFTER administrator or incident
  // ownership has been verified. Public image requests remain published-only.
  const media = await env.DB.prepare(
    "SELECT m.storage_key FROM incident_media m JOIN incidents i ON i.id = m.incident_id " +
    "WHERE m.id = ? AND m.media_type = 'image' AND m.storage_provider = 'r2' " +
    (includeUnpublished ? "" : "AND i.status = 'published'")
  ).bind(id).first();
  if (!media) return new Response("Not found", { status: 404 });
  const object = await env.PHOTOS.get(media.storage_key);
  if (!object?.body) return new Response("Not found", { status: 404 });
  const type = object.httpMetadata?.contentType;
  if (!photoTypes.has(type)) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: {
    "Content-Type": type, "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, noimageindex",
    "Cross-Origin-Resource-Policy": "same-origin"
  } });
}

// Social-platform previews for individual public cases. Never expose metadata
// from hidden or removed incidents, and avoid caching changed moderation status.
function escapeMeta(value) {
  return String(value ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;");
}
async function serveSharedIncidentPage(request, env, url) {
  const id=url.searchParams.get("incident");
  if (!idPattern.test(id || "")) return env.ASSETS.fetch(request);
  let row=null;
  try {
    row=await env.DB.prepare(
      "SELECT i.title,i.description,m.id AS image_id FROM incidents i " +
      "LEFT JOIN incident_media m ON m.id=(" +
      "SELECT id FROM incident_media WHERE incident_id=i.id AND media_type='image' ORDER BY display_order LIMIT 1) " +
      "WHERE i.id=? AND i.status='published' LIMIT 1"
    ).bind(id).first();
  } catch (error) {
    console.warn("Incident preview unavailable", error?.message || "error");
  }
  if (!row) return env.ASSETS.fetch(request);
  const asset=await env.ASSETS.fetch(new Request(SITE_ORIGIN+"/nh/"));
  if (!asset.ok) return asset;
  const page=await asset.text();
  const pageUrl=SITE_ORIGIN+"/nh/?incident="+encodeURIComponent(id);
  const title=escapeMeta(row.title+" | Vote Them Off the Road");
  // Deliberately avoid republishing potentially unverified accusations in snippets.
  const description=escapeMeta("New Hampshire's community jury is voting on this driving story. Vote Them Off or Give 'Em a Pass. Community opinion, not a verified violation.");
  const image=row.image_id ?
    '<meta property="og:image" content="'+escapeMeta(SITE_ORIGIN+"/media/"+row.image_id)+'">' +
    '<meta name="twitter:card" content="summary_large_image">' :
    '<meta name="twitter:card" content="summary">';
  const meta='<meta property="og:type" content="article">' +
    '<meta property="og:site_name" content="Vote Them Off the Road">' +
    '<meta property="og:title" content="'+title+'">' +
    '<meta property="og:description" content="'+description+'">' +
    '<meta property="og:url" content="'+escapeMeta(pageUrl)+'">' +
    '<meta name="twitter:title" content="'+title+'">' +
    '<meta name="twitter:description" content="'+description+'">' + image;
  const canonical='<link rel="canonical" href="'+escapeMeta(pageUrl)+'">';
  const result=page.replace('<link rel="canonical" href="'+SITE_ORIGIN+'/nh/">',canonical)
    .replace('</head>',meta+'</head>');
  return new Response(result,{status:200,headers:{
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff"
  }});
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...cacheHeaders, ...headers } });
}

function writesReady(env) {
  return Boolean(env.DB && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.WRITE_RATE_LIMITER);
}

// Anonymous browser voting. No IP address or raw voter cookie is stored in D1.
// Clearing cookies permits another vote; this is a lightweight launch safeguard, not verified identity.
const voterCookieName = "vtor_voter";
const voterIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readVoterId(request) {
  const cookie = (request.headers.get("Cookie") || "").split(";")
    .map(value => value.trim()).find(value => value.startsWith(voterCookieName + "="));
  if (!cookie) return null;
  const id = cookie.slice(voterCookieName.length + 1);
  return voterIdPattern.test(id) ? id.toLowerCase() : null;
}
function withVoterCookie(request, response) {
  if (readVoterId(request) || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", voterCookieName + "=" + crypto.randomUUID() +
    "; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax");
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}
async function voterHash(request) {
  const id = readVoterId(request);
  if (!id) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function accountJuryKey(userId) {
  // Account keys are deterministic per internal member and cannot be
  // selected or forged by setting the anonymous voter cookie.
  const bytes=await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode("vtor-jury-account-v1:"+userId));
  return [...new Uint8Array(bytes)]
    .map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
class JuryAuthError extends Error {
  constructor(){super("Your sign-in expired. Please sign in again.");}
}
async function juryVoterHash(request,env) {
  if(request.headers.has("Authorization")){
    try{
      const identity=await getPublicAccountUser(request,env);
      if(!identity?.userId)throw new JuryAuthError();
      return accountJuryKey(identity.userId);
    }catch{throw new JuryAuthError();}
  }
  return voterHash(request);
}

async function attachMyVotes(rows, request, env) {
  const vt=await activeVoteTable(env);
  const hash = await juryVoterHash(request,env);
  if (!rows.length || !hash) return rows.map(row => ({ ...row, my_vote: null }));
  const placeholders = rows.map(() => "?").join(",");
  const result = await env.DB.prepare(
    "SELECT incident_id, choice FROM " + vt + " WHERE voter_key_hash = ? AND incident_id IN (" +
      placeholders + ")"
  ).bind(hash, ...rows.map(row => row.id)).all();
  const choices = new Map((result.results || []).map(row => [row.incident_id, row.choice]));
  return rows.map(row => ({ ...row, my_vote: choices.get(row.id) || null }));
}
async function voteIncident(id, request, env) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  if (!env.DB || !env.VOTE_RATE_LIMITER) return json({ error: "Voting is not available yet" }, 503);
  if (request.headers.get("Origin") !== SITE_ORIGIN) {
    return json({ error: "Request origin not allowed" }, 403);
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    return json({ error: "Request not allowed" }, 403);
  }
  const hash = await juryVoterHash(request,env);
  if (!hash) return json({ error: "Refresh the incident feed to initialize voting" }, 428);
  const parsed = await parseBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const choice = parsed.value.choice;
  const funnyEnabled=await humorSchemaReady(env);
  const vt=funnyEnabled ? "votes_v4" : "votes";
  if (!["off","pass",...(funnyEnabled?["funny"]:[])].includes(choice))
    return json({error: funnyEnabled?"Invalid reaction choice":"Funny reactions are not active until migration 0004 is applied"},400);
  // Per-network throttling deters rapid automated voting; Cloudflare limits are approximate.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await env.VOTE_RATE_LIMITER.limit({ key: "ip:" + ip });
  if (!allowed.success) {
    return json({ error: "Too many votes right now. Try again shortly." }, 429);
  }
  await env.DB.prepare(`
    INSERT INTO ${vt} (incident_id, voter_key_hash, choice)
    SELECT ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM incidents WHERE id = ? AND status = 'published'
    )
    ON CONFLICT (incident_id, voter_key_hash)
    DO UPDATE SET choice = excluded.choice
  `).bind(id, hash, choice, id).run();
  // If an incident was hidden or removed, never return its vote totals.
  const publicIncident = await env.DB.prepare(
    "SELECT 1 FROM incidents WHERE id = ? AND status = 'published'"
  ).bind(id).first();
  if (!publicIncident) return json({ error: "Not found" }, 404);
  const counts = await env.DB.prepare(`
    SELECT
      COUNT(CASE WHEN choice = 'off' THEN 1 END) AS off_votes,
      COUNT(CASE WHEN choice = 'pass' THEN 1 END) AS pass_votes,
      COUNT(CASE WHEN choice = 'funny' THEN 1 END) AS funny_votes
    FROM ${vt} WHERE incident_id = ?
  `).bind(id).first();
  await rewardJuryAction(env,hash,{type:"vote",incidentId:id});
  return json({
    ok: true, id, my_vote: choice,
    off_votes: Number(counts?.off_votes || 0),
    pass_votes: Number(counts?.pass_votes || 0),
    funny_votes: Number(counts?.funny_votes || 0), funny_enabled: funnyEnabled
  });
}

const summaryColumns = `
  i.id, i.state_code, i.location_label, i.title, i.description, i.created_at,
  COUNT(CASE WHEN v.choice = 'off' THEN 1 END) AS off_votes,
  COUNT(CASE WHEN v.choice = 'pass' THEN 1 END) AS pass_votes,
  COUNT(CASE WHEN v.choice = 'funny' THEN 1 END) AS funny_votes
`;
const summaryColumnsWithCategory = summaryColumns.replace("i.created_at,",
  "i.created_at, i.category,");
const summaryJoin = vt => `
  FROM incidents i
  LEFT JOIN ${vt} v ON v.incident_id = i.id
`;
const summaryGroup = `
  GROUP BY i.id, i.state_code, i.location_label, i.title, i.description, i.created_at
`;


async function listIncidents(url, env, request) {
  const state=(url.searchParams.get("state")||"NH").toUpperCase();
  const sort=url.searchParams.get("sort")||"newest";
  const category=url.searchParams.get("category")||"";
  const vt=await activeVoteTable(env);
  const rawOffset=url.searchParams.get("offset")||"0";
  const offset=Number(rawOffset);
  if(!/^[A-Z]{2}$/.test(state))return json({error:"Invalid state"},400);
  if(!["newest","top","week","unvoted"].includes(sort))return json({error:"Invalid sort"},400);
  if(category && !Object.hasOwn(behaviorCategories,category))return json({error:"Invalid category"},400);
  if(!/^(0|[1-9][0-9]{0,4})$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset>2000)
    return json({error:"Invalid page offset"},400);
  const ready=await featureSchemaReady(env);
  const columns=ready?summaryColumnsWithCategory:summaryColumns;
  if(category&&!ready)return json({error:"Categories are not active yet"},503);
  const voter=sort==="unvoted"?await juryVoterHash(request,env):null;
  const order=(sort==="top"||sort==="week")?
    "off_votes DESC, i.created_at DESC":"i.created_at DESC";
  let filter="WHERE i.state_code = ? AND i.status = 'published'";
  const binds=[state];
  if(category){filter+=" AND i.category = ?";binds.push(category);}
  if(sort==="week"){filter+=" AND i.created_at >= ?";binds.push(currentWeekStart());}
  if(sort==="unvoted" && voter){
    filter+=" AND NOT EXISTS (SELECT 1 FROM " + vt + " v2 WHERE v2.incident_id=i.id AND v2.voter_key_hash=?)";
    binds.push(voter);
  }
  // Fetch one extra row to determine whether Load More should appear.
  const result=await env.DB.prepare(`
    SELECT ${columns} ${summaryJoin(vt)}
    ${filter}
    ${summaryGroup} ORDER BY ${order} LIMIT 21 OFFSET ?
  `).bind(...binds,offset).all();
  const rows=result.results||[];
  return json({state,sort,category,funny_enabled:await humorSchemaReady(env),offset,has_more:rows.length>20,
    next_offset:offset+Math.min(20,rows.length),
    incidents:await attachMyVotes(await attachImages(rows.slice(0,20),env),request,env)
  });
}

async function featuredCase(request,env) {
  const day=easternGameDay();
  // Recent, public cases only; stable selection during the Eastern calendar day.
  const found=await env.DB.prepare(
    "SELECT id FROM incidents WHERE state_code='NH' AND status='published' "+
    "ORDER BY created_at DESC,id DESC LIMIT 60"
  ).all();
  const cases=found.results||[];
  if(!cases.length)return json({ready:true,incident:null,day:day.key,next_reset_at:day.nextReset});
  const source=new TextEncoder().encode("featured-case:"+day.key);
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",source));
  const key=(digest[0]*16777216+digest[1]*65536+digest[2]*256+digest[3])>>>0;
  const index=key%cases.length;
  // Recheck status in getIncident, preventing a case just hidden from being featured.
  const response=await getIncident(cases[index].id,env,request);
  if(!response.ok)return json({ready:true,incident:null,day:day.key,next_reset_at:day.nextReset});
  const result=await response.json();
  return json({ready:true,incident:result.incident,
    day:day.key,next_reset_at:day.nextReset});
}

async function getIncident(id, env, request) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  const vt=await activeVoteTable(env);
  const columns = await featureSchemaReady(env) ? summaryColumnsWithCategory : summaryColumns;
  const row = await env.DB.prepare(`
    SELECT ${columns} ${summaryJoin(vt)}
    WHERE i.id = ? AND i.status = 'published'
    ${summaryGroup} LIMIT 1
  `).bind(id).first();
  return row
    ? json({ incident: (await attachMyVotes(await attachImages([row], env), request, env))[0], funny_enabled:await humorSchemaReady(env) })
    : json({ error: "Not found" }, 404);
}

async function parseBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    return { error: "Expected JSON", status: 415 };
  }
  const sizeHeader = Number(request.headers.get("content-length") || "0");
  if (sizeHeader > 8192) return { error: "Request too large", status: 413 };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 8192) return { error: "Request too large", status: 413 };
  let value;
  try { value = JSON.parse(raw); } catch { return { error: "Invalid JSON", status: 400 }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Expected a JSON object", status: 400 };
  }
  return { value };
}

async function validateTurnstile(token, action, request, env) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const verdict = await response.json();
  return verdict.success === true && verdict.hostname === SITE_HOST && verdict.action === action;
}

async function prepareWrite(request, env, action) {
  if (!writesReady(env)) return { response: json({ error: "Submissions are not open yet" }, 503) };
  if (request.headers.get("origin") !== SITE_ORIGIN) {
    return { response: json({ error: "Request origin not allowed" }, 403) };
  }
  // Approximate, Cloudflare-location-local throttle, with independent keys for posting/reporting.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await env.WRITE_RATE_LIMITER.limit({ key: action + ":" + ip });
  if (!allowed.success) return { response: json({ error: "Too many attempts. Please try again shortly." }, 429) };
  let body;
  const type = request.headers.get("content-type") || "";
  if (/^multipart\/form-data(?:;|$)/i.test(type)) {
    if (Number(request.headers.get("content-length") || 0) > maxRequestBytes) {
      return { response: json({ error: "Upload too large" }, 413) };
    }
    const data = await request.formData();
    const photos = data.getAll("photos");
    if (photos.length > maxPhotos || photos.some(f => typeof f?.arrayBuffer !== "function")) {
      return { response: json({ error: "Choose up to five photos" }, 400) };
    }
    if (photos.reduce((sum,f) => sum + f.size, 0) > 25 * 1024 * 1024) {
      return { response: json({ error: "Total image upload too large" }, 413) };
    }
    body = {
      title: data.get("title"), location_label: data.get("location_label"),
      description: data.get("description"), category: data.get("category"), turnstile_token: data.get("turnstile_token"), photos
    };
  } else {
    const parsed = await parseBody(request);
    if (parsed.error) return { response: json({ error: parsed.error }, parsed.status) };
    body = parsed.value;
  }
  if (!(await validateTurnstile(body.turnstile_token, action, request, env))) {
    return { response: json({ error: "Verification expired or failed. Please try again." }, 400) };
  }
  return { body };
}


// Incident authorship: users may post as guests, or attach to a verified WorkOS
// session when explicitly enabled. The secret guest key is accepted only in a
// request header and is never stored in plaintext or embedded in a GET URL.
async function publicAccountIdentity(request,env){
  if(!(await publicAccountsReady(env)))
    return {error:json({error:"Public accounts are not configured yet"},503)};
  try{
    const identity=await getPublicAccountUser(request,env);
    return identity?{identity}:{error:json({error:"Sign in to manage your account"},401)};
  }catch{
    return {error:json({error:"Your sign-in session could not be verified"},401)};
  }
}
async function ownerForIncident(request,env,id){
  if(!(await ownershipSchemaReady(env)))
    return {error:json({error:"Incident management opens after migration 0006"},503)};
  if(!idPattern.test(id))return {error:json({error:"Not found"},404)};
  const row=await env.DB.prepare(
    "SELECT i.id,i.title,i.description,i.category,i.location_label,i.status,"+
    "i.created_at,i.updated_at,o.owner_user_id,o.owner_token_hash "+
    "FROM incident_ownership o JOIN incidents i ON i.id=o.incident_id "+
    "WHERE i.id=?"
  ).bind(id).first();
  if(!row)return {error:json({error:"No ownership record exists for this incident"},404)};
  let identity=null;
  if(request.headers.has("Authorization")){
    try{identity=await getPublicAccountUser(request,env);}
    catch{return {error:json({error:"Account session invalid or expired"},401)};}
  }
  const tokenHash=await hashManagementToken(
    request.headers.get("X-Incident-Manage-Key")||"");
  const byAccount=!!(identity&&row.owner_user_id&&identity.userId===row.owner_user_id);
  const byGuest=!!(tokenHash&&row.owner_token_hash&&tokenHash===row.owner_token_hash);
  if(!byAccount&&!byGuest)return {error:json({error:"You don't have the management key or account for this incident"},403)};
  delete row.owner_user_id;
  delete row.owner_token_hash;
  return {row,identity,method:byAccount?"account":"guest"};
}
async function getOwnedIncident(request,env,id){
  const owner=await ownerForIncident(request,env,id);
  if(owner.error)return owner.error;
  const [result]=await attachImages([owner.row],env,"/api/owner/media/");
  return json({ok:true,incident:result,owner_access:owner.method,
    can_edit:owner.row.status!=="removed"});
}
async function updateOwnedIncident(request,env,id){
  if(!isCommunityActionAllowed(request))
    return json({error:"Invalid request origin"},403);
  if(!(await limitJuryAction(request,env)))
    return json({error:"Too many requests. Try again later."},429);
  const owner=await ownerForIncident(request,env,id);
  if(owner.error)return owner.error;
  if(owner.row.status==="removed")
    return json({error:"Removed incidents cannot be edited"},409);
  const parsed=await parseBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const value=parsed.value;
  if(typeof value.title!=="string"||typeof value.description!=="string"||
     typeof value.category!=="string"||
     !(value.location_label===null||typeof value.location_label==="string"))
    return json({error:"Title, story, location and category are required"},400);
  const title=value.title.trim(),description=value.description.trim();
  const location=typeof value.location_label==="string"?value.location_label.trim():"";
  const category=value.category;
  if(title.length<5||title.length>160||description.length<20||
     description.length>3000||location.length>100||
     !Object.hasOwn(behaviorCategories,category))
    return json({error:"Invalid title, story, location or category"},400);
  if(owner.row.title===title&&owner.row.description===description&&
     (owner.row.location_label||"")===location&&owner.row.category===category)
    return json({ok:true,unchanged:true,status:owner.row.status});
  const vt=await activeVoteTable(env);
  const prior=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM "+vt+" WHERE incident_id=?").bind(id).first();
  // After anyone voted, substantive edits may reverse the meaning of previous
  // votes. Hide until admin can review and republish; keep an audit of changes.
  const hadVotes=Number(prior?.n||0)>0;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO incident_author_edits "+
      "(id,incident_id,actor_type,previous_title,previous_description,"+
      "previous_category,previous_location_label,previous_status) "+
      "SELECT ?,id,?,?,?,?,?,? FROM incidents WHERE id=? AND status!='removed'"
    ).bind(crypto.randomUUID(),owner.method,owner.row.title,owner.row.description,
      owner.row.category,owner.row.location_label,owner.row.status,id),
    env.DB.prepare(
      "UPDATE incidents SET title=?,description=?,category=?,location_label=?,"+
      "status=CASE WHEN ? THEN 'hidden' ELSE status END,updated_at=unixepoch() "+
      "WHERE id=? AND status!='removed'"
    ).bind(title,description,category,location||null,hadVotes?1:0,id)
  ]);
  return json({ok:true,status:hadVotes?"hidden":owner.row.status,
    pending_review:hadVotes,message:hadVotes?
      "Saved. Because the case has votes, it is hidden until an administrator reviews the changes.":
      "Your changes are saved."});
}
async function removeOwnedIncident(request,env,id){
  if(!isCommunityActionAllowed(request))
    return json({error:"Invalid request origin"},403);
  if(!(await limitJuryAction(request,env)))
    return json({error:"Too many requests. Try again later."},429);
  const owner=await ownerForIncident(request,env,id);
  if(owner.error)return owner.error;
  await env.DB.prepare(
    "UPDATE incidents SET status='removed',updated_at=unixepoch() "+
    "WHERE id=? AND status!='removed'"
  ).bind(id).run();
  // Publicly removed immediately. We retain private moderation/audit records
  // and R2 media pending a separate permanent-erasure policy.
  return json({ok:true,status:"removed",
    message:"The incident is removed from public view. Contact the administrator for permanent data erasure."});
}
async function claimGuestIncident(request,env,id){
  if(!isCommunityActionAllowed(request))
    return json({error:"Invalid request origin"},403);
  if(!(await limitJuryAction(request,env)))
    return json({error:"Too many requests. Try again later."},429);
  const auth=await publicAccountIdentity(request,env);
  if(auth.error)return auth.error;
  if(!(await ownershipSchemaReady(env)))
    return json({error:"Ownership management is not active"},503);
  const tokenHash=await hashManagementToken(request.headers.get("X-Incident-Manage-Key")||"");
  if(!tokenHash)return json({error:"A valid private management key is required"},403);
  const changed=await env.DB.prepare(
    "UPDATE incident_ownership SET owner_user_id=?,owner_token_hash=NULL,"+
    "claimed_at=unixepoch() WHERE incident_id=? AND owner_user_id IS NULL "+
    "AND owner_token_hash=?"
  ).bind(auth.identity.userId,id,tokenHash).run();
  if(!changed.meta?.changes)
    return json({error:"This private management link is invalid or already claimed"},409);
  return json({ok:true,message:"This incident now belongs to your account. The old guest management link is disabled."});
}
async function accountXP(request,env){
  const auth=await publicAccountIdentity(request,env);
  if(auth.error)return auth.error;
  if(!(await xpSchemaReady(env)))
    return json({ready:false,message:"Jury XP becomes available after migration 0005."});
  // One event key contributes once even if the owner links two browsers
  // that each previously earned the same case or challenge XP.
  const [total,browsers]=await Promise.all([
    env.DB.prepare(
      "SELECT COALESCE(SUM(xp),0) AS xp FROM ("+
      "SELECT MAX(e.xp) AS xp FROM jury_xp_events e "+
      "WHERE e.voter_key_hash=? OR e.voter_key_hash IN "+
      "(SELECT l.voter_key_hash FROM account_voter_links l WHERE l.owner_user_id=?) "+
      "GROUP BY e.event_key)"
    ).bind(await accountJuryKey(auth.identity.userId),auth.identity.userId).first(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM account_voter_links WHERE owner_user_id=?"
    ).bind(auth.identity.userId).first()
  ]);
  const xp=Number(total?.xp||0);
  const rank=[...XP_LEVELS].reverse().find(level=>xp>=level.xp)||XP_LEVELS[0];
  const next=XP_LEVELS.find(level=>xp<level.xp)||null;
  return json({ready:true,xp,rank,next_rank:next,
    linked_browsers:Number(browsers?.n||0)});
}
async function accountMyIncidents(request,env){
  const auth=await publicAccountIdentity(request,env);
  if(auth.error)return auth.error;
  const rows=await env.DB.prepare(
    "SELECT i.id,i.title,i.category,i.status,i.created_at,i.updated_at,"+
    "(SELECT COUNT(*) FROM incident_media m WHERE m.incident_id=i.id) AS photos, "+
    "(SELECT m.id FROM incident_media m WHERE m.incident_id=i.id AND m.media_type='image' "+
    "ORDER BY m.display_order ASC LIMIT 1) AS cover_photo_id "+
    "FROM incident_ownership o JOIN incidents i ON i.id=o.incident_id "+
    "WHERE o.owner_user_id=? ORDER BY i.created_at DESC LIMIT 200"
  ).bind(auth.identity.userId).all();
  return json({ok:true,incidents:rows.results||[]});
}
async function accountMe(request,env){
  const auth=await publicAccountIdentity(request,env);
  if(auth.error)return auth.error;
  const hash=await voterHash(request);
  const linked=hash?await env.DB.prepare(
    "SELECT owner_user_id FROM account_voter_links WHERE voter_key_hash=?"
  ).bind(hash).first():null;
  return json({ok:true,user_id:auth.identity.userId,
    browser_linked:linked?.owner_user_id===auth.identity.userId,
    browser_linked_elsewhere:!!linked&&linked.owner_user_id!==auth.identity.userId});
}
async function linkAccountBrowser(request,env){
  if(!isCommunityActionAllowed(request))
    return json({error:"Invalid request origin"},403);
  if(!(await limitJuryAction(request,env)))
    return json({error:"Too many requests. Try again later."},429);
  const auth=await publicAccountIdentity(request,env);
  if(auth.error)return auth.error;
  const hash=await voterHash(request);
  if(!hash)return json({error:"Your guest browser identity is not initialized"},428);
  const account=auth.identity.userId;
  const canonical=await accountJuryKey(account);
  // Never migrate activity from a browser previously linked to someone else.
  // D1 batch below is transactional and its statements also check ownership,
  // protecting against concurrent link requests from two different accounts.
  const existing=await env.DB.prepare(
    "SELECT owner_user_id FROM account_voter_links WHERE voter_key_hash=?"
  ).bind(hash).first();
  if(existing && existing.owner_user_id!==account)
    return json({error:"This browser's guest history belongs to another account."},409);
  if(hash===canonical)return json({ok:true,linked:true,merged:true});
  const stmts=[env.DB.prepare(
    "INSERT OR IGNORE INTO account_voter_links(owner_user_id,voter_key_hash) "+
    "SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM account_voter_links "+
    "WHERE voter_key_hash=? AND owner_user_id<>?)"
  ).bind(account,hash,hash,account)];
  // These are the ONLY tables that store independent browser-keyed jury
  // activity. Prefer the existing account row on conflicts, then remove
  // duplicates, keeping one vote/guess/duel/prediction per account.
  const sources=[
    ["votes",["incident_id","voter_key_hash","choice","created_at"]],
    ["votes_v4",["incident_id","voter_key_hash","choice","created_at"]],
    ["jury_xp_events",["voter_key_hash","event_key","kind","xp","eastern_day","created_at"]],
    ["jury_verdict_guesses",["incident_id","voter_key_hash","guess","result_choice",
      "was_correct","off_votes","pass_votes","funny_votes","eastern_day","created_at"]],
    ["jury_daily_checkins",["voter_key_hash","eastern_day","created_at"]],
    ["jury_streak_saves",["voter_key_hash","eastern_month","saved_day","created_at"]],
    ["battle_votes",["left_id","right_id","voter_key_hash","winner_id","created_at"]],
    ["weekly_predictions",["week_start","voter_key_hash","predicted_category","created_at"]]
  ];
  const authGuard="EXISTS(SELECT 1 FROM account_voter_links "+
    "WHERE owner_user_id=? AND voter_key_hash=?)";
  for(const [table,cols] of sources){
    const projected=cols.map(c=>c==="voter_key_hash"?"?":c).join(",");
    stmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO "+table+" ("+cols.join(",")+") "+
      "SELECT "+projected+" FROM "+table+" WHERE voter_key_hash=? AND "+authGuard
    ).bind(canonical,hash,account,hash));
    stmts.push(env.DB.prepare(
      "DELETE FROM "+table+" WHERE voter_key_hash=? AND "+authGuard
    ).bind(hash,account,hash));
  }
  await env.DB.batch(stmts);
  const linked=await env.DB.prepare(
    "SELECT owner_user_id FROM account_voter_links WHERE voter_key_hash=?"
  ).bind(hash).first();
  if(linked?.owner_user_id!==account)
    return json({error:"This browser's guest history belongs to another account."},409);
  return json({ok:true,linked:true,merged:true,
    message:"Your guest votes, games, streaks and XP are now part of your account."});
}

async function createIncident(request, env) {
  const prepared = await prepareWrite(request, env, "submit");
  if (prepared.response) return prepared.response;
  const body = prepared.body;
  if (typeof body.title !== "string" || typeof body.description !== "string") {
    return json({ error: "Title and description are required" }, 400);
  }
  const title = body.title.trim();
  const description = body.description.trim();
  const location = typeof body.location_label === "string" ? body.location_label.trim() : "";
  if (title.length < 5 || title.length > 160 || description.length < 20 || description.length > 3000 || location.length > 100) {
    return json({ error: "Title must be 5–160 characters, story 20–3000, location at most 100." }, 400);
  }
  const category = typeof body.category === "string" ? body.category : "other";
  if (!Object.hasOwn(behaviorCategories, category)) return json({ error: "Invalid driving behavior category" }, 400);
  const enhanced = await featureSchemaReady(env);
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length && !photosReady(env)) return json({ error: "Photo uploads are being set up. Submit a text story for now." }, 503);
  if (photos.length > maxPhotos) return json({ error: "Maximum five photos" }, 400);
  for (const file of photos) {
    if (!photoTypes.has(file.type) || file.size < 100 || file.size > maxPhotoBytes) {
      return json({ error: "Photos must be JPG, PNG, or WebP under 5 MB each." }, 400);
    }
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!imageSignatureIsValid(head, file.type)) return json({ error: "Invalid photo file" }, 400);
  }
  const ownershipOn=await ownershipSchemaReady(env);
  let accountUser=null;
  if(request.headers.has("Authorization")){
    try{accountUser=await getPublicAccountUser(request,env);}
    catch{return json({error:"Your account session needs to be refreshed. Please sign in again."},401);}
    if(!accountUser)return json({error:"Sign in again or submit as guest."},401);
  }
  const managementToken=ownershipOn&&!accountUser?createManagementToken():null;
  const managementHash=managementToken?await hashManagementToken(managementToken):null;
  const id = crypto.randomUUID();
  // Keep the incident hidden until every photo and database reference is safely stored.
  const initialStatus = photos.length ? "hidden" : "published";
  if (enhanced) {
    await env.DB.prepare(`
      INSERT INTO incidents (id, state_code, location_label, title, description, status, category)
      VALUES (?, 'NH', ?, ?, ?, ?, ?)
    `).bind(id, location || null, title, description, initialStatus, category).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO incidents (id, state_code, location_label, title, description, status)
      VALUES (?, 'NH', ?, ?, ?, ?)
    `).bind(id, location || null, title, description, initialStatus).run();
  }
  if(ownershipOn){
    try{
      await env.DB.prepare(
        "INSERT INTO incident_ownership "+
        "(incident_id,owner_user_id,owner_token_hash) VALUES(?,?,?)"
      ).bind(id,accountUser?.userId||null,managementHash).run();
    }catch(error){
      console.error("Could not assign new incident ownership",error?.message||"error");
      await env.DB.prepare("DELETE FROM incidents WHERE id=?").bind(id).run();
      return json({error:"Could not initialize ownership. Please retry."},503);
    }
  }
  const ownershipReply=ownershipOn?
    {owner_type:accountUser?"account":"guest",management_token:managementToken}:
    {owner_type:"unavailable"};
  if (!photos.length) return json({
    ok:true,id,...ownershipReply,message:"Your driving story is on the board."
  },201);
  const uploadedKeys = [];
  try {
    for (let index = 0; index < photos.length; index++) {
      const file = photos[index];
      const imageId = crypto.randomUUID();
      const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
      const key = "incidents/" + id + "/" + imageId + "." + extension;
      const stored = await env.PHOTOS.put(key, file, {
        httpMetadata: { contentType: file.type, contentDisposition: "inline" }
      });
      if (!stored) throw new Error("Image storage refused file");
      uploadedKeys.push(key);
      await env.DB.prepare(`
        INSERT INTO incident_media (id, incident_id, media_type, storage_provider, storage_key, display_order)
        VALUES (?, ?, 'image', 'r2', ?, ?)
      `).bind(imageId, id, key, index).run();
    }
    await env.DB.prepare("UPDATE incidents SET status = 'published', updated_at = unixepoch() WHERE id = ?")
      .bind(id).run();
    return json({ok:true,id,photos:photos.length,...ownershipReply,message:"Your photo story is on the board."},201);
  } catch (error) {
    console.error("Photo submission failed", error);
    // Best-effort rollback to avoid leaving visible partial incidents or orphaned photos.
    await Promise.allSettled([
      env.DB.prepare("DELETE FROM incidents WHERE id = ?").bind(id).run(),
      ...uploadedKeys.map(key => env.PHOTOS.delete(key))
    ]);
    return json({ error: "Photos could not be saved. Please retry your submission." }, 503);
  }
}

// Optional native Cloudflare Email Service alerts. No emails are sent until
// a REPORT_ALERT_EMAIL binding is configured and the recipient is verified.
async function notifyAdminOfNewReport(env, incidentId, title, reason, autoHidden = false) {
  if (!env.REPORT_ALERT_EMAIL || !env.ADMIN_EMAIL) return;
  try {
    await env.REPORT_ALERT_EMAIL.send({
      to: String(env.ADMIN_EMAIL).trim(),
      from: "alerts@" + SITE_HOST,
      subject: "Vote Them Off the Road: " + (autoHidden ? "AUTO-HIDDEN POST" : "New report") +
        " (" + reason.replace(/_/g, " ") + ")",
      text: "A report or removal request needs review.\n\n" +
        "Incident: " + title + "\n" +
        "Reason: " + reason.replace(/_/g, " ") + "\n" +
        "Incident ID: " + incidentId + "\n\n" +
        "Review: " + SITE_ORIGIN + "/admin/\n\n" +
        (autoHidden ? "The incident was automatically hidden and needs priority review." :
          "The incident remains published unless manually hidden or auto-hidden by reports.")
    });
  } catch (error) {
    // Never drop a valid report due to an email service outage.
    console.error("Admin email notification failed", error?.code || "error", error?.message || "");
  }
}

async function createReport(id, request, env, ctx) {
  if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
  const prepared = await prepareWrite(request, env, "report");
  if (prepared.response) return prepared.response;
  const { reason, details, contact_email } = prepared.body;
  if (typeof reason !== "string" || !reportReasons.has(reason)) return json({ error: "Choose a report reason" }, 400);
  const note = typeof details === "string" ? details.trim() : "";
  const email = typeof contact_email === "string" ? contact_email.trim() : "";
  if (note.length > 3000 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return json({ error: "Invalid report details or contact email" }, 400);
  }
  const incident = await env.DB.prepare("SELECT title FROM incidents WHERE id = ? AND status = 'published'").bind(id).first();
  if (!incident) return json({ error: "Not found" }, 404);
  const enhanced = await featureSchemaReady(env);
  let autoHidden = false;
  if (enhanced) {
    const reporter = await voterHash(request);
    const network = await reportNetworkHash(request, env);
    // Reports with blocked cookies or missing CF network context remain reviewable,
    // but cannot inflate automated hiding thresholds.
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO reports
        (id, incident_id, reason, details, contact_email, reporter_key_hash, network_key_hash)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM incidents WHERE id=? AND status='published')
    `).bind(crypto.randomUUID(), id, reason, note, email || null, reporter, network, id).run();
    if (!result.meta?.changes) {
      return json({ ok: true, duplicate: true, message: "This browser has already reported the incident." });
    }
    if (reporter && network) {
      const windowStart = Math.floor(Date.now() / 1000) - autoHideWindowSeconds;
      const change = await env.DB.prepare(`
        UPDATE incidents SET status='hidden', auto_hidden_at=unixepoch(), updated_at=unixepoch()
        WHERE id=? AND status='published'
          AND (SELECT COUNT(DISTINCT reporter_key_hash) FROM reports
               WHERE incident_id=? AND created_at >= ?
                 AND created_at > COALESCE((SELECT reviewed_at FROM incidents WHERE id=?),0))
              >= ?
          AND (SELECT COUNT(DISTINCT network_key_hash) FROM reports
               WHERE incident_id=? AND created_at >= ?
                 AND created_at > COALESCE((SELECT reviewed_at FROM incidents WHERE id=?),0))
              >= ?
      `).bind(id, id, windowStart, id, reportHideThreshold(env),
               id, windowStart, id, autoHideMinimumNetworks).run();
      autoHidden = Number(change.meta?.changes || 0) > 0;
    }
  } else {
    await env.DB.prepare(`
      INSERT INTO reports (id, incident_id, reason, details, contact_email)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, reason, note, email || null).run();
  }
  if (env.REPORT_ALERT_EMAIL && ctx?.waitUntil) {
    ctx.waitUntil(notifyAdminOfNewReport(env, id, incident.title, reason, autoHidden));
  }
  return json({ ok: true, auto_hidden: autoHidden,
    message: autoHidden ?
      "Report received. This incident was temporarily hidden pending review." :
      "Report received and pending review. Multiple independent reports may temporarily hide a post." }, 201);
}


// Inlined so the authenticated dashboard works even when the static asset
// resolver does not map /admin/ to /admin/index.html in production.
const ADMIN_DASHBOARD_HTML = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\"><meta name=\"theme-color\" content=\"#f7c744\">\n<title>Admin Dashboard | Vote Them Off the Road</title>\n<link rel=\"icon\" href=\"/assets/favicon.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"/assets/styles.css\"><link rel=\"stylesheet\" href=\"/assets/admin.css?v=20261110-photo-gallery\"></head>\n<body><a class=\"skip\" href=\"#main\">Skip to content</a>\n<div class=\"announcement\">PRIVATE ADMIN DASHBOARD <strong>• NEW HAMPSHIRE</strong></div>\n<header><div class=\"container header-inner\">\n<a class=\"brand\" href=\"/\" aria-label=\"Vote Them Off the Road home\"><span class=\"brand-mark\" aria-hidden=\"true\">✓</span><span class=\"brand-words\">Vote Them Off<br>the Road<small>SITE MANAGEMENT.</small></span></a>\n<nav class=\"nav\"><a href=\"/nh/\" target=\"_blank\" rel=\"noopener\">Public site ↗</a><a class=\"nav-cta\" href=\"/guidelines/\" target=\"_blank\" rel=\"noopener\">Site rules ↗</a></nav>\n</div></header>\n<main id=\"main\">\n<section class=\"admin-hero\"><div class=\"container admin-hero-inner\"><div><div class=\"section-kicker\">Your control room</div><h1>Admin dashboard.</h1><p>Review reports, manage published incidents and keep the community entertaining.</p>\n<p id=\"admin-signed-in\" class=\"admin-signed-in\"></p></div>\n<button id=\"refresh-admin\" class=\"btn btn-primary\" type=\"button\">↻ Refresh dashboard</button></div></section>\n<section class=\"section admin-section\"><div class=\"container\">\n<p id=\"admin-status\" class=\"admin-status\" role=\"status\" aria-live=\"polite\">Loading dashboard…</p>\n<div class=\"admin-stats\" id=\"admin-stats\"></div>\n<div class=\"admin-heading\"><div><div class=\"section-kicker\">Reports first</div><h2>Removal requests & reports</h2></div><span class=\"admin-note\">A report does not automatically hide a post.</span></div>\n<div id=\"admin-reports\" class=\"admin-list\"></div>\n<div class=\"admin-heading admin-heading-spaced\"><div><div class=\"section-kicker\">The whole board</div><h2>Manage incidents</h2><p class=\"admin-category-help\">To change an incident category, choose a category in its card and click <strong>Save category</strong>.</p></div></div>\n<div id=\"admin-incidents\" class=\"admin-list\"></div>\n<p class=\"admin-footnote\">“Remove from site” is reversible. “Permanently delete + photos” destroys the incident, its votes and reports, and associated R2 photos. This action cannot be undone.</p>\n</div></section></main>\n<footer class=\"footer\"><div class=\"container\"><div class=\"footer-bottom\">Vote Them Off the Road • Private administrator area</div></div></footer>\n<script src=\"/assets/site.js\" defer></script><script src=\"/assets/admin.js?v=20261110-photo-gallery\" defer></script></body></html>\n";

/* Private admin API. Both Cloudflare Access and Worker-side signed JWT validation
   must succeed. No admin credentials or user report details are exposed publicly. */
let cachedAccessKeys = { team: "", expiresAt: 0, keys: [] };

function base64UrlBytes(encoded) {
  if (typeof encoded !== "string" || !/^[a-zA-Z0-9_-]+$/.test(encoded)) {
    throw new Error("Bad token encoding");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function tokenJson(encoded) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(encoded)));
}

async function getAccessKeys(team, refresh = false) {
  if (!refresh && cachedAccessKeys.team === team && cachedAccessKeys.expiresAt > Date.now()) {
    return cachedAccessKeys.keys;
  }
  let response;
  try {
    response = await fetch("https://" + team + "/cdn-cgi/access/certs", {
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    console.error("Cloudflare Access public-key fetch failed", error?.name, error?.message);
    throw new Error("KEY_FETCH");
  }
  if (!response.ok) {
    console.error("Cloudflare Access public-key HTTP status", response.status);
    throw new Error("KEY_HTTP_" + String(response.status));
  }
  let certs;
  try { certs = await response.json(); }
  catch {
    console.error("Cloudflare Access public-key response was not JSON");
    throw new Error("KEY_JSON");
  }
  if (!Array.isArray(certs?.keys)) throw new Error("KEY_FORMAT");
  const keys = certs.keys.filter(key => key.kty === "RSA" && key.n && key.e && key.kid);
  if (!keys.length) throw new Error("KEY_EMPTY");
  cachedAccessKeys = { team, keys, expiresAt: Date.now() + 300000 };
  return keys;
}

async function authorizeAdmin(request, env) {
  const failed = code => ({ error: code });
  const team = String(env.ADMIN_ACCESS_TEAM || "").trim().toLowerCase();
  const aud = String(env.ADMIN_ACCESS_AUD || "").trim();
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}\.cloudflareaccess\.com$/.test(team) ||
      !aud || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return failed("AUTH_CONFIG");
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  if (token.length > 12000) return failed("TOKEN_FORMAT");
  const parts = token.split(".");
  if (parts.length !== 3) return failed(token ? "TOKEN_FORMAT" : "TOKEN_MISSING");
  try {
    const header = tokenJson(parts[0]);
    const payload = tokenJson(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" ||
        typeof payload.email !== "string" || payload.email.toLowerCase() !== adminEmail) return failed("IDENTITY_MISMATCH");
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= now ||
        (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf > now + 30)) ||
        (payload.iat !== undefined && (typeof payload.iat !== "number" || payload.iat > now + 30)) ||
        payload.iss !== "https://" + team ||
        !(Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud)) {
      return failed("TOKEN_CLAIMS");
    }
    let keys;
    try {
      keys = await getAccessKeys(team);
    } catch (error) {
      return failed(String(error?.message || "").startsWith("KEY_") ? error.message : "KEY_FETCH");
    }
    let signingKey = keys.find(key => key.kid === header.kid);
    if (!signingKey) {
      try { keys = await getAccessKeys(team, true); }
      catch (error) {
        return failed(String(error?.message || "").startsWith("KEY_") ? error.message : "KEY_FETCH");
      }
      signingKey = keys.find(key => key.kid === header.kid);
    }
    if (!signingKey) return failed("SIGNING_KEY");
    let key;
    try {
      key = await crypto.subtle.importKey("jwk",
        { kty: "RSA", n: signingKey.n, e: signingKey.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    } catch (error) {
      console.error("Cloudflare Access public-key import failed", error?.name, error?.message);
      return failed("KEY_IMPORT");
    }
    let valid;
    try {
      valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]),
        new TextEncoder().encode(parts[0] + "." + parts[1]));
    } catch (error) {
      console.error("Cloudflare Access JWT signature verification threw", error?.name, error?.message);
      return failed("SIGNATURE_ERROR");
    }
    return valid ? { email: adminEmail } : failed("SIGNATURE");
  } catch (error) {
    console.error("Admin authentication verification failed", error?.message || "error");
    return failed("VERIFICATION_ERROR");
  }
}

function isAdminMutationAllowed(request) {
  return request.headers.get("Origin") === SITE_ORIGIN &&
    (!request.headers.get("Sec-Fetch-Site") ||
      request.headers.get("Sec-Fetch-Site") === "same-origin");
}

function adminId(value) {
  return idPattern.test(value || "");
}

// Permanent deletion: hide first, delete R2 objects, then cascade-delete D1 records.
// If an external storage operation fails, leave a hidden incident for safe retry.
async function permanentlyDeleteIncident(env, id, identity) {
  const current = await env.DB.prepare("SELECT id FROM incidents WHERE id=?").bind(id).first();
  if (!current) return json({ error: "Incident not found" }, 404);

  await env.DB.prepare("UPDATE incidents SET status='removed', updated_at=unixepoch() WHERE id=?").bind(id).run();
  const media = await env.DB.prepare(
    "SELECT storage_provider, storage_key FROM incident_media WHERE incident_id=?"
  ).bind(id).all();
  const rows = media.results || [];
  if (rows.some(row => row.storage_provider !== "r2")) {
    return json({ error: "Incident hidden but non-R2 media must be deleted manually before permanent deletion." }, 409);
  }
  const keys = [...new Set(rows.map(row => row.storage_key).filter(Boolean))];
  if (keys.length && !env.PHOTOS) {
    return json({ error: "Incident hidden. R2 is unavailable; retry when storage is connected." }, 503);
  }
  try {
    for (let start = 0; start < keys.length; start += 1000) {
      await env.PHOTOS.delete(keys.slice(start, start + 1000));
    }
  } catch (error) {
    console.error("R2 permanent deletion failed", id, error?.message || "error");
    return json({ error: "Photo deletion failed. Incident is hidden; retry permanent deletion." }, 503);
  }
  // ON DELETE CASCADE removes associated media rows, votes and reports.
  await env.DB.prepare("DELETE FROM incidents WHERE id=?").bind(id).run();
  console.log("Admin permanently deleted incident", { email: identity.email, id, photo_count: keys.length });
  return json({ ok: true, deleted: true, photo_count: keys.length });
}

async function adminApi(request, env, path, identity) {
  // Cloudflare Access authentication occurs before this code path; emit
  // booleans only, never session encryption material or API key fragments.
  if (path === "/admin/api/account-readiness" && request.method === "GET") {
    const readiness=await authReadiness(env);
    return json({enabled:readiness.enabled,...readiness.checks});
  }
  if (path === "/admin/api/me" && request.method === "GET") {
    return json({ ok: true, email: identity.email,
      alerts_configured: Boolean(env.REPORT_ALERT_EMAIL && env.ADMIN_EMAIL),
      enhanced: await featureSchemaReady(env), funny_enabled:await humorSchemaReady(env),
      auto_hide_threshold: reportHideThreshold(env) });
  }
  if (path === "/admin/api/reports" && request.method === "GET") {
    const enhanced = await featureSchemaReady(env);
    const rows = await env.DB.prepare(enhanced ? `
      SELECT r.id, r.incident_id, r.reason, r.details, r.contact_email,
        r.status, r.created_at, r.resolved_at,
        i.title AS incident_title, i.status AS incident_status,
        i.category AS incident_category, i.auto_hidden_at,
        (SELECT COUNT(DISTINCT rr.reporter_key_hash) FROM reports rr
          WHERE rr.incident_id=r.incident_id AND rr.created_at >= unixepoch()-604800
          AND rr.created_at > COALESCE(i.reviewed_at,0)) AS unique_reporters
      FROM reports r LEFT JOIN incidents i ON i.id=r.incident_id
      ORDER BY CASE WHEN i.status='hidden' AND i.auto_hidden_at IS NOT NULL
        AND r.status IN ('open','reviewing') THEN 0
        WHEN r.status='open' THEN 1 WHEN r.status='reviewing' THEN 2 ELSE 3 END,
        r.created_at DESC LIMIT 200
    ` : `
      SELECT r.id, r.incident_id, r.reason, r.details, r.contact_email,
        r.status, r.created_at, r.resolved_at,
        i.title AS incident_title, i.status AS incident_status
      FROM reports r LEFT JOIN incidents i ON i.id=r.incident_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        r.created_at DESC LIMIT 200
    `).all();
    const reports=rows.results||[];
    const associated=[...new Set(reports.map(row=>row.incident_id).filter(Boolean))]
      .map(id=>({id}));
    const imageRows=await attachImages(associated,env,"/admin/media/");
    const imageById=new Map(imageRows.map(row=>[row.id,row.photos]));
    return json({reports:reports.map(row=>({
      ...row,photos:imageById.get(row.incident_id)||[]
    })),enhanced});
  }
  if (path === "/admin/api/incidents" && request.method === "GET") {
    const enhanced = await featureSchemaReady(env);
    const owned=await ownershipSchemaReady(env);
    const vt=await activeVoteTable(env);
    const rows = await env.DB.prepare(`
      SELECT i.id, i.state_code, i.location_label, i.title, i.status,
        i.created_at, i.updated_at,
        ${owned ? "(SELECT COUNT(*) FROM incident_author_edits ae WHERE ae.incident_id=i.id) AS author_edits," : "0 AS author_edits,"}
        ${enhanced ? "i.category, i.auto_hidden_at," : ""}
        (SELECT COUNT(*) FROM ${vt} v WHERE v.incident_id = i.id AND v.choice = 'off') AS off_votes,
        (SELECT COUNT(*) FROM ${vt} v WHERE v.incident_id = i.id AND v.choice = 'pass') AS pass_votes,
        (SELECT COUNT(*) FROM ${vt} v WHERE v.incident_id = i.id AND v.choice = 'funny') AS funny_votes,
        (SELECT COUNT(*) FROM reports r WHERE r.incident_id = i.id AND r.status IN ('open', 'reviewing')) AS pending_reports
      FROM incidents i
      ORDER BY ${enhanced ? "CASE WHEN i.status='hidden' AND i.auto_hidden_at IS NOT NULL THEN 0 ELSE 1 END," : ""}
        i.created_at DESC LIMIT 200
    `).all();
    return json({incidents:await attachImages(rows.results||[],env,
      "/admin/media/"),enhanced});
  }
  const editHistoryRoute=/^\/admin\/api\/incidents\/([A-Za-z0-9_-]{6,80})\/edits$/.exec(path);
  if(editHistoryRoute && request.method==="GET"){
    if(!(await ownershipSchemaReady(env)))return json({edits:[],ready:false});
    const id=editHistoryRoute[1];
    const edits=await env.DB.prepare(
      "SELECT actor_type,previous_title,previous_description,previous_category,"+
      "previous_location_label,previous_status,created_at "+
      "FROM incident_author_edits WHERE incident_id=? ORDER BY created_at DESC LIMIT 25"
    ).bind(id).all();
    return json({ready:true,edits:edits.results||[]});
  }
  if (path === "/admin/api/analytics" && request.method === "GET") {
    const enhanced = await featureSchemaReady(env);
    const [reasons, categories] = await Promise.all([
      env.DB.prepare("SELECT reason,COUNT(*) AS count FROM reports GROUP BY reason ORDER BY count DESC").all(),
      enhanced ? env.DB.prepare(
        "SELECT category,COUNT(*) AS count FROM incidents GROUP BY category ORDER BY count DESC"
      ).all() : Promise.resolve({ results: [] })
    ]);
    return json({ enhanced, reasons: reasons.results || [], categories: categories.results || [],
      category_labels: behaviorCategories });
  }
  if (request.method !== "PATCH" && request.method !== "DELETE") return json({ error: "Not found" }, 404);
  if (!isAdminMutationAllowed(request)) return json({ error: "Invalid request origin" }, 403);
  const body = await parseBody(request);
  if (body.error) return json({ error: body.error }, body.status);
  const incidentMatch = /^\/admin\/api\/incidents\/([A-Za-z0-9_-]{6,80})$/.exec(path);
  if (incidentMatch) {
    const id = incidentMatch[1];
    if (request.method === "DELETE") {
      if (body.value.confirm !== "DELETE " + id)
        return json({ error: "Explicit deletion confirmation is required" }, 400);
      return permanentlyDeleteIncident(env, id, identity);
    }
    if (typeof body.value.category === "string" && body.value.status === undefined) {
      if (!(await featureSchemaReady(env))) return json({error:"Category editing requires migration 0002"},503);
      const category=body.value.category;
      if (!Object.hasOwn(behaviorCategories,category))
        return json({error:"Invalid category"},400);
      const updated=await env.DB.prepare(
        "UPDATE incidents SET category=?, updated_at=unixepoch() WHERE id=?"
      ).bind(category,id).run();
      if (!updated.meta?.changes)return json({error:"Incident not found"},404);
      console.log("Admin updated incident category",{email:identity.email,id,category});
      return json({ok:true,id,category});
    }
    const state = body.value.status;
    if (!["published", "hidden", "removed"].includes(state)) {
      return json({ error: "Invalid incident status" }, 400);
    }
    const existing = await env.DB.prepare("SELECT id FROM incidents WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Incident not found" }, 404);
    const enhanced = await featureSchemaReady(env);
    await env.DB.prepare(enhanced && state === "published" ?
      "UPDATE incidents SET status=?, updated_at=unixepoch(), reviewed_at=unixepoch(), auto_hidden_at=NULL WHERE id=?" :
      "UPDATE incidents SET status=?, updated_at=unixepoch() WHERE id=?"
    ).bind(state, id).run();
    console.log("Admin incident update", { email: identity.email, id, status: state });
    return json({ ok: true, id, status: state });
  }
  const reportMatch = /^\/admin\/api\/reports\/([A-Za-z0-9_-]{6,80})$/.exec(path);
  if (reportMatch) {
    if (request.method !== "PATCH") return json({ error: "Not found" }, 404);
    const id = reportMatch[1];
    const action = body.value.action;
    if (!["reviewing", "resolve", "dismiss", "reopen", "hide_and_resolve"].includes(action)) {
      return json({ error: "Invalid report action" }, 400);
    }
    const existing = await env.DB.prepare(
      "SELECT incident_id FROM reports WHERE id = ?"
    ).bind(id).first();
    if (!existing) return json({ error: "Report not found" }, 404);
    if (action === "hide_and_resolve") {
      // D1 batches execute statements in order as a transaction.
      await env.DB.batch([
        env.DB.prepare("UPDATE incidents SET status='hidden', updated_at=unixepoch() WHERE id=?")
          .bind(existing.incident_id),
        env.DB.prepare("UPDATE reports SET status='resolved', resolved_at=unixepoch() WHERE id=?").bind(id)
      ]);
    } else {
      const status = action === "resolve" ? "resolved" :
        action === "dismiss" ? "dismissed" :
        action === "reopen" ? "open" : "reviewing";
      await env.DB.prepare(
        "UPDATE reports SET status=?, resolved_at=? WHERE id=?"
      ).bind(status, status === "resolved" || status === "dismissed" ? Math.floor(Date.now()/1000) : null, id).run();
    }
    console.log("Admin report update", { email: identity.email, id, action });
    return json({ ok: true, id, action });
  }
  return json({ error: "Not found" }, 404);
}

async function adminRequest(request, env, pathname) {
  const configured = Boolean(env.ADMIN_ACCESS_TEAM && env.ADMIN_ACCESS_AUD && env.ADMIN_EMAIL);
  if (!configured) {
    return new Response("Admin dashboard is not configured yet.", {
      status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
    });
  }
  const identity = await authorizeAdmin(request, env);
  if (!identity?.email) {
    const code = identity?.error || "ACCESS_DENIED";
    // Codes explain the category of failure without revealing tokens, email, or keys.
    console.warn("Admin Access verification rejected request", code);
    return new Response("Admin access denied (" + code + "). Check Cloudflare Access and your application settings.", {
      status: 403, headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store", "X-Robots-Tag": "noindex"
      }
    });
  }
  if (pathname.startsWith("/admin/media/")) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
    try {
      const image=await serveImage(pathname.slice("/admin/media/".length),env,true);
      return request.method==="HEAD"?
        new Response(null,{status:image.status,headers:image.headers}):image;
    } catch(error) {
      console.error("Admin image fetch failed",error?.name||"unknown");
      return new Response("Temporarily unavailable",{status:503});
    }
  }
  if (pathname.startsWith("/admin/api/")) {
    try { return await adminApi(request, env, pathname, identity); }
    catch (error) {
      console.error("Admin API failed", error);
      return json({ error: "Admin request failed" }, 503);
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (pathname !== "/admin/" && pathname !== "/admin/index.html") {
    return new Response("Not found", {
      status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
    });
  }
  return new Response(request.method === "HEAD" ? null : ADMIN_DASHBOARD_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async scheduled(controller, env) {
    await snapshotPreviousWeek(env, controller.scheduledTime);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/admin") return Response.redirect(SITE_ORIGIN + "/admin/", 302);
    if (pathname === "/nh/account/" &&
        (url.searchParams.has("code") || url.searchParams.has("error"))) {
      return authCallback(request,env);
    }
    if (pathname.startsWith("/admin/")) return adminRequest(request, env, pathname);
    // Initialize the anonymous jury cookie on the HTML response, BEFORE
    // the page starts its parallel feed, XP, streak and game requests.
    // Avoids competing Set-Cookie values on a visitor's very first visit.
    if (pathname === "/nh/" && request.method === "GET") {
      const page=url.searchParams.has("incident")
        ? await serveSharedIncidentPage(request,env,url)
        : await env.ASSETS.fetch(request);
      return withVoterCookie(request,page);
    }
    const ownerMedia=/^\/api\/owner\/media\/([A-Za-z0-9_-]{6,80})$/.exec(pathname);
    if(ownerMedia) {
      if (request.method!=="GET" && request.method!=="HEAD")
        return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
      try {
        const media=await env.DB.prepare(
          "SELECT incident_id FROM incident_media WHERE id=? AND media_type='image'"
        ).bind(ownerMedia[1]).first();
        if (!media) return new Response("Not found",{status:404});
        const owner=await ownerForIncident(request,env,media.incident_id);
        if (owner.error) return owner.error;
        const image=await serveImage(ownerMedia[1],env,true);
        return request.method==="HEAD"?
          new Response(null,{status:image.status,headers:image.headers}):image;
      } catch(error) {
        console.error("Owner image fetch failed",error?.name||"unknown");
        return new Response("Temporarily unavailable",{status:503});
      }
    }
    if (pathname.startsWith("/media/")) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      try {
        const image = await serveImage(pathname.slice("/media/".length), env);
        return request.method === "HEAD" ? new Response(null, { status: image.status, headers: image.headers }) : image;
      } catch (error) {
        console.error("Photo fetch failed", error);
        return new Response("Temporarily unavailable", { status: 503 });
      }
    }
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (pathname === "/api/config" && request.method === "GET") {
        const enabled = writesReady(env);
        const enhanced = await featureSchemaReady(env);
        return withVoterCookie(request, json({ submissions_enabled: enabled,
          reports_enabled: enabled, photos_enabled: photosReady(env),
          voting_enabled: Boolean(env.DB && env.VOTE_RATE_LIMITER), max_photos: maxPhotos,
          community_features_enabled: enhanced, funny_enabled:await humorSchemaReady(env),
          auto_hide_report_threshold: reportHideThreshold(env),
          category_labels: behaviorCategories,
          turnstile_site_key: enabled ? env.TURNSTILE_SITE_KEY : null }));
      }
      if (pathname === "/api/auth/start")return authStart(request,env);
      if (pathname === "/api/auth/session")return authSession(request,env);
      if (pathname === "/api/auth/logout")return authLogout(request,env);
      if (pathname === "/api/account/config" && request.method === "GET"){
        const enabled=await authConfigReady(env);
        return json({enabled,ownership_enabled:await ownershipSchemaReady(env),
          provider:enabled?"workos":null,
          client_id:enabled?env.WORKOS_CLIENT_ID:null});
      }
      if(pathname==="/api/account/me" && request.method==="GET")
        return accountMe(request,env);
      if(pathname==="/api/account/xp" && request.method==="GET")
        return accountXP(request,env);
      if(pathname==="/api/account/incidents" && request.method==="GET")
        return accountMyIncidents(request,env);
      if(pathname==="/api/account/link-browser" && request.method==="POST")
        return linkAccountBrowser(request,env);
      const ownerClaim=/^\/api\/owner\/incidents\/([a-zA-Z0-9_-]{6,80})\/claim$/.exec(pathname);
      if(ownerClaim){
        if(request.method==="POST")return claimGuestIncident(request,env,ownerClaim[1]);
        return json({error:"Method not allowed"},405,{Allow:"POST"});
      }
      const ownerCase=/^\/api\/owner\/incidents\/([a-zA-Z0-9_-]{6,80})$/.exec(pathname);
      if(ownerCase){
        if(request.method==="GET")return getOwnedIncident(request,env,ownerCase[1]);
        if(request.method==="PATCH")return updateOwnedIncident(request,env,ownerCase[1]);
        if(request.method==="DELETE")return removeOwnedIncident(request,env,ownerCase[1]);
        return json({error:"Method not allowed"},405,{Allow:"GET, PATCH, DELETE"});
      }
      if (pathname === "/api/featured-case" && request.method === "GET")
        return withVoterCookie(request,await featuredCase(request,env));
      if (pathname === "/api/weekly-funniest" && request.method === "GET") {
        const offset=Number(url.searchParams.get("offset") || "0");
        if (!Number.isSafeInteger(offset) || offset<0 || offset>12)
          return json({error:"Invalid week offset"},400);
        const category=url.searchParams.get("category")||"";
        return funniestWeekBoard(env,offset,category);
      }
      if (pathname === "/api/weekly-board" && request.method === "GET") {
        const offset=Number(url.searchParams.get("offset") || "0");
        if (!Number.isSafeInteger(offset) || offset<0 || offset>12)
          return json({error:"Invalid week offset"},400);
        return weeklyBoard(env,offset);
      }
      if (pathname === "/api/my-stats" && request.method === "GET") return withVoterCookie(request, await myParticipation(request, env));
      if (pathname === "/api/jury/xp" && request.method === "GET")
        return withVoterCookie(request,await juryXPOverview(request,env));
      if (pathname === "/api/jury/verdict-guess" && request.method === "GET")
        return withVoterCookie(request,await getVerdictGuess(request,env));
      if (pathname === "/api/jury/verdict-guess" && request.method === "POST")
        return castVerdictGuess(request,env);
      if (pathname === "/api/jury/checkin" && request.method === "POST")
        return juryCheckin(request,env);
      if (pathname === "/api/jury/streak-save" && request.method === "POST")
        return juryStreakSave(request,env);
      if (pathname === "/api/jury/battle" && request.method === "GET")
        return withVoterCookie(request,await getBattle(request,env));
      if (pathname === "/api/jury/battle" && request.method === "POST")
        return castBattleVote(request,env);
      if (pathname === "/api/jury/prediction" && request.method === "GET")
        return withVoterCookie(request,await juryPrediction(request,env));
      if (pathname === "/api/jury/prediction" && request.method === "POST")
        return saveJuryPrediction(request,env);
      if (pathname === "/api/health" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT 1 AS healthy").first();
        if (result?.healthy !== 1) throw new Error("D1 probe failed");
        return json({ ok: true, database: "connected" });
      }
      if (pathname === "/api/incidents") {
        if (request.method === "GET") return withVoterCookie(request, await listIncidents(url, env, request));
        if (request.method === "POST") return await createIncident(request, env);
        return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
      }
      const voteMatch = /^\/api\/incidents\/([a-zA-Z0-9_-]{6,80})\/vote$/.exec(pathname);
      if (voteMatch) {
        if (request.method === "POST") return await voteIncident(voteMatch[1], request, env);
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      const reportMatch = /^\/api\/incidents\/([a-zA-Z0-9_-]{6,80})\/reports$/.exec(pathname);
      if (reportMatch) {
        if (request.method === "POST") return await createReport(reportMatch[1], request, env, ctx);
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      if (pathname.startsWith("/api/incidents/")) {
        if (request.method === "GET") return withVoterCookie(request,
          await getIncident(pathname.slice("/api/incidents/".length), env, request));
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if(error instanceof JuryAuthError)
        return json({error:error.message},401);
      console.error("API request failed", error);
      return json({ error: "Service temporarily unavailable" }, 503);
    }
  },
};
