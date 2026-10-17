/* ======================= script ======================= */
const MODEL={planner:"Nemotron-3-Super-120B",worker:"Nemotron-3-Nano-30B",verifier:"Nemotron-3-Ultra-550B"};
const SPECS=[["ChartPrep","Pre-visit summaries"],["PriorAuth","Evidence → payer → submit"],["Referral","Specialist, records, send"],["Denials","Read code, fix or appeal"]];
/* event types: a=sub-agent, d=decision, r=recovery loop, g=Verifier pass, b=Verifier block, o=closed, h=human */
const CASES=[
{id:"PA-1042",pt:"Maria Delgado",dob:"1961-03-14",type:"Prior auth",ag:"PriorAuth",detail:"Ozempic 0.5 mg · Blue Shield CA",mins:45,value:2940,vk:"auth",short:"Delgado · Ozempic",
ev:[["a","EvidenceGatherer","A1c 8.4% · metformin 14 mo"],
["d","Meets payer criteria?","Yes",{why:"T2DM diagnosis ✓ · first-line therapy ≥ 3 months ✓ · A1c ≥ 7.0% ✓",ghost:["No","request more evidence"]}],
["a","PortalSubmitter","504 Gateway Timeout","warn"],
["r","Retry 1/3","backoff 20 s → submitted"],
["g","Verifier","auth matches chart"],["o","Approved","auth BSC-77310"]]},
{id:"CP-2201",pt:"James Okafor",dob:"1978-09-02",type:"Chart prep",ag:"ChartPrep",detail:"Annual physical · 08:30",mins:15,value:0,short:"Okafor · physical",
ev:[["a","LabSummarizer","3 visits · 2 labs · 1 imaging"],["a","CareGapScanner","colorectal screening overdue","flag"],
["d","Urgent finding?","No",{why:"No critical labs, no red-flag symptoms in last 3 visits",ghost:["Yes","page on-call"]}],
["g","Verifier","summary matches chart"],["o","Summary ready","1 care gap flagged"]]},
{id:"DN-3307",pt:"Linda Chen",dob:"1955-11-20",type:"Claim denial",ag:"Denials",detail:"<span class=code>CO-97</span> bundling · Medicare",mins:40,value:186.40,vk:"claim",short:"Chen · CO-97",
ev:[["a","ERAReader","CARC CO-97 · bundled with ECG"],
["d","Separate problem documented?","Yes",{why:"Visit note documents a new problem worked up apart from the same-day ECG",ghost:["No","accept denial"]}],
["a","ClaimFixer","+ modifier 25 on 99214"],["g","Verifier","coding matches note"],["o","Resubmitted","$186.40"]]},
{id:"RF-4410",pt:"Robert Haines",dob:"1949-06-07",type:"Referral",ag:"Referral",detail:"Cardiology · Aetna HMO",mins:30,value:0,short:"Haines · cardiology",
ev:[["a","NPISearch","3 cardiologists ≤ 10 mi"],
["d","In network for Aetna HMO?","Yes",{why:"Bay Heart Associates is listed in-network; accepting new patients",ghost:["No","next option"]}],
["a","RecordPacker","ECG + 2 visit notes"],["g","Verifier","records match referral"],["o","Referral sent","Bay Heart Associates"]]},
{id:"PA-1043",pt:"Aisha Rahman",dob:"1990-01-30",type:"Prior auth",ag:"PriorAuth",detail:"Lumbar MRI · UnitedHealthcare",mins:45,value:0,short:"Rahman · MRI",
ev:[["a","EvidenceGatherer","6 wks PT · pain 7/10"],
["d","Can agents finish it?","No",{why:"UHC requires a signed physician attestation. Agents never sign for a physician.",ghost:["Yes","submit auth"]}],
["h","Needs Dr. Patel","signature on pre-filled packet"]],
esc:"UHC needs a signed physician attestation before the MRI auth can go in. The packet is pre-filled and ready to sign.",result:"Needs physician signature"},
{id:"CP-2202",pt:"Tom Becker",dob:"1983-04-18",type:"Chart prep",ag:"ChartPrep",detail:"Follow-up · 09:15",mins:15,value:0,short:"Becker · follow-up",
ev:[["a","LabSummarizer","empty result set","warn"],["r","Re-query by MRN","2 lab panels found"],
["a","MedReconciler","8 meds · 1 allergy"],["g","Verifier","summary matches chart"],["o","Summary ready","labs attached"]]},
{id:"DN-3308",pt:"Grace Liu",dob:"1972-08-25",type:"Claim denial",ag:"Denials",detail:"<span class=code>CO-16</span> missing info · Cigna",mins:35,value:142,vk:"claim",short:"Liu · CO-16",
ev:[["a","ERAReader","CARC CO-16 · referring NPI blank"],["a","NPISearch","'Dr. K. Lee' → NPI ••4471"],["a","ClaimFixer","NPI inserted"],
["b","Verifier","NPI ••4471 is dermatology",{why:"Referral in the chart is to cardiology. NPI ••4471 belongs to a dermatologist with the same name. Sent back to NPISearch.",back:1}],
["a","NPISearch","specialty + city → NPI ••8820"],["a","ClaimFixer","resubmitted to Cigna"],["g","Verifier","NPI matches referral"],["o","Resubmitted","$142.00"]]},
{id:"RF-4411",pt:"Daniel Morales",dob:"1966-12-03",type:"Referral",ag:"Referral",detail:"Dermatology · Kaiser",mins:30,value:0,short:"Morales · dermatology",
ev:[["a","NPISearch","Kaiser: internal referral only"],["a","EligibilityCheck","new plan since 09/01","err"],
["d","Coverage on file current?","No",{why:"Eligibility response shows a different plan effective 09/01. Routing on old coverage would be denied.",ghost:["Yes","send referral"]}],
["h","Confirm insurance","front desk to call patient"]],
esc:"Eligibility shows a new plan since 09/01. Front desk should confirm coverage with the patient before the referral is re-routed.",result:"Insurance on file outdated"},
{id:"PA-1044",pt:"Helen Park",dob:"1958-02-11",type:"Prior auth",ag:"PriorAuth",detail:"CPAP renewal · Medicare",mins:40,value:1250,vk:"auth",short:"Park · CPAP",
ev:[["a","EvidenceGatherer","82% of nights ≥ 4 h"],
["d","Meets 70% usage rule?","Yes",{why:"Compliance download: 82% of nights with ≥ 4 h use over 30 days",ghost:["No","coach patient"]}],
["a","PortalSubmitter","renewal submitted"],["g","Verifier","matches compliance data"],["o","Approved","auth MCR-55102"]]},
{id:"DN-3309",pt:"Victor Nguyen",dob:"1987-07-09",type:"Claim denial",ag:"Denials",detail:"<span class=code>CO-50</span> medical necessity · Anthem",mins:50,value:1410,vk:"claim",short:"Nguyen · CO-50",
ev:[["a","ERAReader","CARC CO-50 · necessity"],
["d","Appeal or write off?","Appeal",{why:"Imaging plus 3 documented failed treatments support medical necessity",ghost:["Write off","close claim"]}],
["a","AppealDrafter","letter + 4 attachments"],["g","Verifier","appeal matches chart"],["o","Appeal filed","$1,410.00"]]},
{id:"CP-2203",pt:"Sofia Rossi",dob:"1995-05-22",type:"Chart prep",ag:"ChartPrep",detail:"New patient · 10:00",mins:20,value:0,short:"Rossi · new patient",
ev:[["a","RecordImporter","2 outside PDFs"],["a","MedReconciler","1 duplicate removed"],["g","Verifier","med list matches records"],["o","Summary ready","meds reconciled"]]},
{id:"RF-4412",pt:"Frank Wilson",dob:"1952-10-15",type:"Referral",ag:"Referral",detail:"Orthopedics · Blue Shield PPO",mins:25,value:0,short:"Wilson · ortho",
ev:[["a","RecordPacker","X-ray + visit notes"],["a","FaxSender","line busy","warn"],["r","Switch channel","e-referral portal ✓"],
["g","Verifier","delivery confirmed"],["o","Referral sent","Peninsula Ortho"]]},
{id:"PA-1045",pt:"Priya Shah",dob:"1984-06-12",type:"Prior auth",ag:"PriorAuth",detail:"Dupixent 300 mg · Aetna PPO",mins:50,value:3180,vk:"auth",short:"Shah · Dupixent",
ev:[["a","EvidenceGatherer","BSA 15% · 2 topicals failed"],
["d","Meets step-therapy rule?","Yes",{why:"Moderate-to-severe atopic dermatitis ✓ · topical steroid failed ✓ · tacrolimus failed ✓",ghost:["No","request more evidence"]}],
["a","FormFiller","PA form · 600 mg q2w"],
["b","Verifier","dose doesn't match order",{why:"Order in the chart is 300 mg every 2 weeks after the loading dose. Form listed 600 mg maintenance. Sent back to FormFiller.",back:1,toast:"Verifier blocked PA-1045 before it went out: dose on the form didn't match the order. Sending it back."}],
["a","FormFiller","300 mg q2w corrected"],["a","PortalSubmitter","submitted to Aetna"],["g","Verifier","dose matches order"],["o","Approved","auth AET-20418"]]},
{id:"CP-2204",pt:"Evelyn Brooks",dob:"1947-01-08",type:"Chart prep",ag:"ChartPrep",detail:"Diabetes follow-up · 11:00",mins:20,value:0,short:"Brooks · diabetes",
ev:[["a","LabSummarizer","result flagged for physician review","err"],["a","CareGapScanner","retinal + foot exam due","flag"],
["d","Flagged for physician review?","Yes",{why:"The lab system flagged a result for physician review. Agents never assess clinical content.",ghost:["No","summary only"]}],
["h","Flag for Dr. Patel","lab result flagged for physician review"]],
esc:"Lab result flagged for physician review. Agents never assess clinical content.",result:"Lab result flagged for physician review"},
{id:"DN-3310",pt:"Marcus Johnson",dob:"1975-10-29",type:"Claim denial",ag:"Denials",detail:"<span class=code>CO-29</span> timely filing · Humana",mins:35,value:318.75,vk:"claim",short:"Johnson · CO-29",
ev:[["a","ERAReader","CARC CO-29 · filing limit passed"],["a","ClearinghouseSearch","original sent 03/02 · accepted"],
["d","Proof of timely filing?","Yes",{why:"Clearinghouse acceptance report dated 03/02 is inside Humana's 90-day window",ghost:["No","write off"]}],
["a","AppealDrafter","acceptance report attached"],["g","Verifier","dates match ledger"],["o","Appeal filed","$318.75"]]},
{id:"RF-4413",pt:"Kevin O'Brien",dob:"1958-04-03",type:"Referral",ag:"Referral",detail:"Gastroenterology · Medicare",mins:30,value:0,short:"O'Brien · GI",
ev:[["a","NPISearch","4 GI practices ≤ 15 mi"],["a","SchedulingCheck","first slot 11/28"],
["d","Seen within 30 days?","No",{why:"Positive FIT test: guideline is colonoscopy within 30 days. First slot is 46 days out.",ghost:["Yes","book first slot"]}],
["a","NPISearch","next practice · slot 10/22"],["a","RecordPacker","FIT result + 2 visit notes"],["g","Verifier","records match referral"],["o","Referral sent","Golden Gate GI"]]},
{id:"DN-3311",pt:"Rosa Martinez",dob:"1969-08-17",type:"Claim denial",ag:"Denials",detail:"<span class=code>CO-4</span> modifier · Medi-Cal",mins:30,value:96.20,vk:"claim",short:"Martinez · CO-4",
ev:[["a","ERAReader","CARC CO-4 · modifier 59 on 97110"],["a","CodingChecker","NCCI pair 97140 + 97110"],
["d","Separate session documented?","Yes",{why:"Therapy note shows manual therapy and exercise in separate time blocks",ghost:["No","accept denial"]}],
["a","ClaimFixer","59 → XS modifier"],["a","ClearinghouseSubmit","rejected: payer ID mismatch","warn"],["r","Retry with Medi-Cal ID","accepted"],
["g","Verifier","coding matches note"],["o","Resubmitted","$96.20"]]},
{id:"PA-1046",pt:"Nora Ahmed",dob:"1980-12-01",type:"Prior auth",ag:"PriorAuth",detail:"Adalimumab · Cigna",mins:45,value:2460,vk:"auth",short:"Ahmed · adalimumab",
ev:[["a","EvidenceGatherer","RA · methotrexate 6 mo"],
["d","Meets payer criteria?","Yes",{why:"Rheumatoid arthritis diagnosis ✓ · methotrexate ≥ 3 months ✓ · active disease score ✓",ghost:["No","request more evidence"]}],
["a","FormularyCheck","switch to preferred biosimilar"],["a","PortalSubmitter","submitted to Cigna"],["g","Verifier","drug matches formulary"],["o","Approved","auth CIG-88124"]]},
{id:"CP-2205",pt:"Peter Schmidt",dob:"1950-03-27",type:"Chart prep",ag:"ChartPrep",detail:"Pre-op clearance · 13:30",mins:25,value:0,short:"Schmidt · pre-op",
ev:[["a","RecordImporter","surgeon request + ECG"],["a","LabSummarizer","CBC, BMP still pending","warn"],["r","Poll lab interface","results posted 23:41"],
["g","Verifier","checklist matches chart"],["o","Summary ready","pre-op checklist complete"]]},
{id:"RF-4414",pt:"Yuki Tanaka",dob:"1992-09-14",type:"Referral",ag:"Referral",detail:"Physical therapy · Anthem",mins:20,value:0,short:"Tanaka · PT",
ev:[["a","EligibilityCheck","PT visits: 12 of 20 used"],
["d","Visits left on plan?","Yes",{why:"8 visits remain this plan year; the PT order asks for 6",ghost:["No","ask for exception"]}],
["a","RecordPacker","PT order + knee MRI"],["a","FaxSender","sent to Bayview PT"],["g","Verifier","delivery confirmed"],["o","Referral sent","Bayview PT"]]},
];
const BASE=1000, PAR=4, ROW=40, COL=168;
const TOTAL=CASES.reduce((a,c)=>a+c.ev.length+1,0);
const TYPE={goal:"Goal",planner:"Planner",spec:"Specialist agent",case:"Case",a:"Sub-agent",d:"Decision",r:"Recovery loop",g:"Verifier check",b:"Verifier block",o:"Closed",h:"Needs a human"};
/* ======================= state ======================= */
const $=s=>document.getElementById(s);
const RM=matchMedia("(prefers-reduced-motion: reduce)"), motion=()=>!RM.matches;
const store={get(k,d){try{const v=localStorage.getItem("emr."+k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem("emr."+k,JSON.stringify(v))}catch(e){}}};
function vt(fn){if(!document.startViewTransition||!motion()){fn();return}document.startViewTransition(fn)}
let speed=1, runId=0, running=false, follow=true, filter=null, selected=null, focusId=null, kpiOpen=null;
let state={}, handled={}, n, moneyShown=0, moneyRAF=null, ids=0, groups={};
let rootData, nodesById={}, backs=[], visible=new Set();
const FOLD=new Set(["planner","spec","case","d"]);
const canFold=d=>FOLD.has(d.type)&&d.children.length>0;
function countDesc(d){return d.children.reduce((a,c)=>a+1+countDesc(c),0)}
function isShown(d){let p=nodesById[d.parentId];while(p){if(p.collapsed)return false;p=nodesById[p.parentId]}return true}
function subtree(id){const s=new Set(),walk=d=>{s.add(d.id);d.children.forEach(walk)};if(nodesById[id])walk(nodesById[id]);return s}
function ancestors(id){const s=new Set();let d=nodesById[id];while(d&&d.parentId){d=nodesById[d.parentId];s.add(d.id)}return s}
function setAll(c){Object.values(nodesById).forEach(d=>{if(canFold(d)&&d.type!=="planner")d.collapsed=c});render()}
const caseNode={}, specNode={};
const modelFor=d=>d.model||(d.type==="planner"?MODEL.planner:(d.type==="g"||d.type==="b")?MODEL.verifier:["a","d","r","spec"].includes(d.type)?MODEL.worker:"—");
function statePill(d){const [t,k]={active:["Running","s-working"],done:["Finished","s-done"],warn:["Failed, recovering","s-retry"],err:["Blocked by data","s-esc"],human:["Waiting for staff","s-esc"]}[d.status]||[d.status,"s-queued"];return `<span class="pill ${k}">${t}</span>`}
/* ======================= graph setup ======================= */
const svg=d3.select("#graph");
const defs=svg.append("defs");
const f=defs.append("filter").attr("id","glow").attr("x","-200%").attr("y","-200%").attr("width","500%").attr("height","500%");
f.append("feGaussianBlur").attr("stdDeviation","3").attr("result","b");
const fm=f.append("feMerge");fm.append("feMergeNode").attr("in","b");fm.append("feMergeNode").attr("in","SourceGraphic");
const view=svg.append("g");
const gLinks=view.append("g"), gBacks=view.append("g"), gElab=view.append("g"), gNodes=view.append("g"), gPackets=view.append("g");
const zoom=d3.zoom().scaleExtent([.2,3]).on("zoom",e=>{view.attr("transform",e.transform);if(e.sourceEvent){setFollow(false)}});
svg.call(zoom).on("dblclick.zoom",null);
const linkGen=d3.linkHorizontal().x(d=>d.y).y(d=>d.x);
const tree=d3.tree().nodeSize([ROW,COL]).separation((a,b)=>a.parent===b.parent?1:1.25);
const css=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
function mk(type,name,sub,parent,extra={}){
const d={id:"n"+(++ids),type,name,sub,children:[],status:"active",...extra};
nodesById[d.id]=d;if(parent){d.parentId=parent.id;parent.children.push(d)}return d;
}
function styleFor(d){
const s=d.status;
const map={
goal:[css("--panel-2"),css("--line-2")],planner:[css("--panel-2"),css("--ink")],spec:[css("--agent-soft"),css("--agent")],
case:[css("--panel-2"),css("--line-2")],a:[css("--agent-soft"),css("--agent")],d:[css("--dec-soft"),css("--dec")],
r:[css("--warn-soft"),css("--warn")],g:[css("--verify-soft"),css("--verify")],b:[css("--bad-soft"),css("--bad")],
o:[css("--ok-soft"),css("--ok")],h:[css("--bad-soft"),css("--bad")]};
let [fill,stroke]=map[d.type]||map.a;
if(d.type==="case"){if(s==="done"){stroke=css("--ok")}else if(s==="human"){stroke=css("--bad")}else if(s==="active"){stroke=css("--run")}}
if(d.type==="a"&&s==="warn"){fill=css("--warn-soft");stroke=css("--warn")}
if(d.type==="a"&&s==="err"){fill=css("--bad-soft");stroke=css("--bad")}
if(d.type==="o"&&d.money){stroke=css("--money");fill=css("--money-soft")}
return {fill,stroke};
}
function shapePath(t){
switch(t){
case"planner":return"M-15,0L-7.5,-13L7.5,-13L15,0L7.5,13L-7.5,13Z";
case"d":return"M0,-11L11,0L0,11L-11,0Z";
case"g":case"b":return"M-4.5,-11L4.5,-11L11,-4.5L11,4.5L4.5,11L-4.5,11L-11,4.5L-11,-4.5Z";
case"h":return"M-9,-9H9V9H-9Z";
default:return null;
}
}
function radius(d){return d.type==="goal"?0:d.type==="planner"?15:d.type==="spec"?0:d.type==="case"?0:d.type==="a"||d.type==="o"?9:d.type==="r"?8:11}
function labelX(d){return d.type==="goal"?70:d.type==="spec"?50:d.type==="case"?36:radius(d)+7}
let scheduled=false;
function render(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;draw()})}
function draw(){
const T=motion()?550/speed:0;
const root=d3.hierarchy(rootData,d=>d.collapsed?null:d.children);tree(root);
const all=root.descendants();
visible=new Set(all.map(h=>h.data.id));
const F=focusId?subtree(focusId):null, A=focusId?ancestors(focusId):null;
const dim=id=>!F||F.has(id)?"":A.has(id)?" fade":" dim";
const anc=id=>{let d=nodesById[id];while(d&&!visible.has(d.id))d=nodesById[d.parentId];return d||rootData};
all.forEach(h=>{h.data.x=h.x;h.data.y=h.y});
const pos=id=>{const d=nodesById[id];return d?{x:d.x,y:d.y}:{x:0,y:0}};
const startOf=h=>{const p=h.parent?h.parent.data:h.data;return {x:p.x0??p.x??0,y:p.y0??p.y??0}};
/* links */
const links=root.links();
const ls=gLinks.selectAll("path.link").data(links,l=>l.target.data.id);
ls.enter().append("path").attr("class",l=>linkClass(l))
.attr("d",l=>{const s=startOf(l.target);return linkGen({source:s,target:s})})
.merge(ls).attr("class",l=>linkClass(l)+dim(l.target.data.id)).transition().duration(T).attr("d",l=>linkGen({source:l.source,target:l.target}));
ls.exit().transition().duration(T).attr("d",l=>{const a=anc(l.target.data.id);const q={x:a.x,y:a.y};return linkGen({source:q,target:q})}).style("opacity",0).remove();
/* edge labels on decision branches */
const el=links.filter(l=>l.target.data.edge);
const es=gElab.selectAll("text").data(el,l=>l.target.data.id);
es.enter().append("text").attr("text-anchor","middle").attr("opacity",0)
.text(l=>l.target.data.edge)
.attr("x",l=>(l.source.y+l.target.y)/2+6).attr("y",l=>(l.source.x+l.target.x)/2-5)
.merge(es).attr("class",l=>"elabel"+(l.target.data.ghost?" ghost":"")+dim(l.target.data.id)).transition().duration(T).attr("opacity",1)
.attr("x",l=>(l.source.y+l.target.y)/2+6).attr("y",l=>(l.source.x+l.target.x)/2-5);
es.exit().transition().duration(T/2).attr("opacity",0).remove();
/* nodes */
const ns=gNodes.selectAll("g.node").data(all,h=>h.data.id);
const ne=ns.enter().append("g").attr("class","node")
.attr("transform",h=>{const s=startOf(h);return `translate(${s.y},${s.x}) scale(.2)`})
.on("click",(e,h)=>{e.stopPropagation();const d=h.data;if(canFold(d))d.collapsed=!d.collapsed;select(d.id)})
.on("dblclick",(e,h)=>{e.stopPropagation();if(h.data.caseId)focusCase(h.data.caseId)})
.on("pointerenter",(e,h)=>{if(e.pointerType==="mouse")showHover(h.data,e)})
.on("pointermove",e=>{if(e.pointerType==="mouse")moveHover(e)})
.on("pointerleave",hideHover);
ne.each(function(h){
const g=d3.select(this),d=h.data,p=shapePath(d.type);
if(d.type==="goal"){g.append("rect").attr("class","shape").attr("x",-64).attr("y",-17).attr("width",128).attr("height",34).attr("rx",17)}
else if(d.type==="spec"){g.append("rect").attr("class","shape").attr("x",-44).attr("y",-14).attr("width",88).attr("height",28).attr("rx",8)}
else if(d.type==="case"){g.append("rect").attr("class","shape").attr("x",-31).attr("y",-11).attr("width",62).attr("height",22).attr("rx",5)}
else if(p){g.append("path").attr("class","shape").attr("d",p)}
else{g.append("circle").attr("class","shape").attr("r",radius(d))}
if(d.type==="r"){g.append("path").attr("d","M-5,-3 A6,6 0 1,1 -1,6").attr("fill","none").attr("stroke",css("--warn")).attr("stroke-width",1.6);
g.append("path").attr("d","M-8,-4 L-4.5,-3.4 L-5.5,0").attr("fill","none").attr("stroke",css("--warn")).attr("stroke-width",1.6)}
if(d.type==="o"&&!d.ghost){g.append("path").attr("d","M-4,0 L-1,3.2 L4.5,-3.5").attr("fill","none").attr("stroke",d.money?css("--money"):css("--ok")).attr("stroke-width",2)}
if(d.type==="h"){g.append("text").attr("class","inner").attr("text-anchor","middle").attr("dy","3.6").text("!").style("fill",css("--bad"))}
if(d.type==="b"){g.append("text").attr("class","inner").attr("text-anchor","middle").attr("dy","3.6").text("✕").style("fill",css("--bad"))}
if(d.type==="g"){g.append("path").attr("d","M-4,0 L-1,3 L4,-3").attr("fill","none").attr("stroke",css("--verify")).attr("stroke-width",1.8)}
if(d.type==="goal"){g.append("text").attr("class","inner").attr("text-anchor","middle").attr("dy","4").style("font-family","var(--sans)").style("font-size","12px").text(d.name)}
else if(d.type==="spec"){g.append("text").attr("class","inner").attr("text-anchor","middle").attr("dy","4").style("font-family","var(--sans)").style("font-size","12px").style("fill",css("--agent")).text(d.name)}
else if(d.type==="case"){g.append("text").attr("class","inner").attr("text-anchor","middle").attr("dy","3.8").text(d.name)}
g.append("circle").attr("class","ring").attr("r",Math.max(10,radius(d)+2));
const lx=labelX(d);
if(d.type==="goal"){g.append("text").attr("class","sb").attr("x",0).attr("y",30).attr("text-anchor","middle").text(d.sub)}
else if(d.type==="spec"||d.type==="case"){g.append("text").attr("class","sb").attr("x",lx).attr("y",4).text(d.sub)}
else{g.append("text").attr("class","nm").attr("x",lx).attr("y",-1).text(d.name);g.append("text").attr("class","sb").attr("x",lx).attr("y",12).text(d.sub)}
});
const nm=ne.merge(ns);
nm.attr("class",h=>{const d=h.data;return "node"+(d.ghost?" ghost":"")+(d.status==="active"?" active":"")+(selected===d.id?" sel":"")+(canFold(d)?" haskids":"")+(d.collapsed?" collapsed":"")+dim(d.id)})
.each(function(h){const d=h.data,g=d3.select(this);let t=g.select("g.tog");
if(!canFold(d)){t.remove();return}
if(t.empty()){t=g.append("g").attr("class","tog");t.append("circle").attr("r",7.5);t.append("text").attr("text-anchor","middle").attr("dy","3.3")}
const bx=d.type==="spec"?44:d.type==="case"?31:d.type==="planner"?15:radius(d);
t.attr("transform",`translate(${bx},${-radius(d)-(d.type==="spec"?14:d.type==="case"?11:0)})`);
t.select("text").text(d.collapsed?"+"+countDesc(d):"−")})
.each(function(h){const st=styleFor(h.data);d3.select(this).select(".shape").attr("fill",st.fill).attr("stroke",st.stroke);d3.select(this).select(".ring").attr("stroke",st.stroke)});
nm.transition().duration(T).attr("transform",h=>`translate(${h.y},${h.x}) scale(1)`);
ns.exit().transition().duration(T).attr("transform",h=>{const a=anc(h.data.id);return `translate(${a.y},${a.x}) scale(.2)`}).style("opacity",0).remove();
/* back-edges (recovery loops, Verifier send-backs) */
const bs=gBacks.selectAll("g.bk").data(backs.filter(b=>visible.has(b.from)&&visible.has(b.to)),b=>b.key);
const be=bs.enter().append("g").attr("opacity",0);
be.append("path").attr("class",b=>"back "+b.cls).attr("marker-end",b=>`url(#arr-${b.cls})`);
be.append("text").attr("class","blabel").attr("text-anchor","middle").attr("fill",b=>b.cls==="bad"?css("--bad"):css("--warn")).text(b=>b.label);
const bm=be.merge(bs).attr("class",b=>"bk"+dim(b.from));
bm.transition().duration(T).attr("opacity",1);
bm.select("path").transition().duration(T).attr("d",b=>backPath(b));
bm.select("text").transition().duration(T).attr("x",b=>{const a=pos(b.from),c=pos(b.to);return (a.y+c.y)/2}).attr("y",b=>{const a=pos(b.from),c=pos(b.to);return Math.min(a.x,c.x)-arcH(b)+4});
bs.exit().transition().duration(T/2).attr("opacity",0).remove();
all.forEach(h=>{h.data.x0=h.x;h.data.y0=h.y});
if(follow)fit(T);
}
function linkClass(l){const t=l.target.data;return "link"+(t.ghost?" ghost":t.edge?" taken":(t.status==="active"?" live":""))}
function arcH(b){const a=nodesById[b.from],c=nodesById[b.to];return 26+Math.min(40,Math.abs((a?.y||0)-(c?.y||0))*.12)}
function backPath(b){const a=nodesById[b.from],c=nodesById[b.to];if(!a||!c)return"";const h=arcH(b);
const x1=a.y,y1=a.x-10,x2=c.y,y2=c.x-11;return `M${x1},${y1} C${x1},${y1-h} ${x2},${y2-h} ${x2},${y2}`}
["warn","bad"].forEach(k=>defs.append("marker").attr("id","arr-"+k).attr("viewBox","0 0 10 10").attr("refX",8).attr("refY",5).attr("markerWidth",7).attr("markerHeight",7).attr("orient","auto-start-reverse")
.append("path").attr("d","M0,0 L10,5 L0,10 z").attr("fill",css(k==="warn"?"--warn":"--bad")));
function fit(T=600){
let ds=Object.values(nodesById).filter(d=>visible.has(d.id)&&d.x!==undefined);
if(focusId){const F=subtree(focusId);ds=ds.filter(d=>F.has(d.id))}
if(!ds.length)return;
const el=svg.node(),W=el.clientWidth,H=el.clientHeight;if(!W||!H)return;
const minX=d3.min(ds,d=>d.x)-(focusId?50:70),maxX=d3.max(ds,d=>d.x)+40,minY=d3.min(ds,d=>d.y)-80,maxY=d3.max(ds,d=>d.y)+190;
const padTop=document.querySelector(".hud.top").offsetHeight+18,padBot=document.querySelector(".hud.bot").offsetHeight+18;
const k=Math.max(.2,Math.min(focusId?1.6:1.25,W/(maxY-minY),(H-padTop-padBot)/(maxX-minX)));
const tx=(W-(maxY-minY)*k)/2-minY*k, ty=padTop+((H-padTop-padBot)-(maxX-minX)*k)/2-minX*k;
const t=d3.zoomIdentity.translate(tx,ty).scale(k);
if(T>0)svg.transition().duration(T).call(zoom.transform,t);else{svg.interrupt();svg.call(zoom.transform,t)}
}
function packet(from,to,color){
if(!from||!to||!motion())return;
if(!isShown(to))return;
if(focusId&&!subtree(focusId).has(to.id))return;
const delay=520/speed,dur=650/speed;
setTimeout(()=>{
const p=gPackets.append("path").attr("d",linkGen({source:{x:from.x,y:from.y},target:{x:to.x,y:to.y}})).attr("fill","none").attr("stroke","none");
const node=p.node(),L=node.getTotalLength();
const c=gPackets.append("circle").attr("class","packet").attr("r",4.2).attr("fill",color);
c.transition().duration(dur).ease(d3.easeCubicInOut).attrTween("transform",()=>t=>{const pt=node.getPointAtLength(t*L);return `translate(${pt.x},${pt.y})`})
.on("end",()=>{c.remove();p.remove()});
},delay);
}
/* ======================= hover preview ======================= */
function showHover(d,e){
if(d.type==="goal")return;
const h=$("hov");
h.innerHTML=`<div class="row"><span class="tag">${TYPE[d.type]}</span>${d.status&&!d.ghost?statePill(d):""}</div>
<b>${esc(d.type==="case"?d.name+" · "+(CASES.find(c=>c.id===d.caseId)?.pt||""):d.name)}</b>
<div class="mono">${esc(d.type==="d"?d.name+" → "+d.answer:d.sub)}</div>
${modelFor(d)!=="—"?`<div class="hint">${modelFor(d)}</div>`:""}
${d.why?`<div class="why${d.type==="g"?" v":d.type==="b"?" b":d.type==="r"?" w":""}">${esc(d.why.length>140?d.why.slice(0,138)+"…":d.why)}</div>`:""}
<div class="hint">Click to inspect${canFold(d)?" · fold":""}${d.caseId?" · double-click to focus":""}</div>`;
h.hidden=false;moveHover(e);
}
function moveHover(e){
const h=$("hov");if(h.hidden)return;const r=$("stage").getBoundingClientRect();
let x=e.clientX-r.left+16,y=e.clientY-r.top+16;
if(x+h.offsetWidth>r.width-8)x=e.clientX-r.left-h.offsetWidth-16;
if(y+h.offsetHeight>r.height-8)y=Math.max(8,r.height-h.offsetHeight-8);
h.style.transform=`translate(${Math.max(8,x)}px,${y}px)`;
}
function hideHover(){$("hov").hidden=true}
/* ======================= inspector + focus ======================= */
function select(id){
selected=id;const d=nodesById[id];render();hideHover();
if(!d){$("insp").hidden=true;return}
const c=d.caseId?CASES.find(x=>x.id===d.caseId):null;
const whyCls=d.type==="g"?"why v":d.type==="b"?"why b":d.type==="r"?"why w":"why";
$("insp").innerHTML=`<h3><span>${esc(d.type==="case"?d.name+" · "+c.pt:d.name)}</span><button class="ghost" id="inspX" aria-label="Close">×</button></h3>
<dl><dt>Type</dt><dd><span class="tag">${TYPE[d.type]}</span></dd>
${c?`<dt>Case</dt><dd class="mono">${c.id} · ${esc(c.type)}</dd>`:""}
<dt>Model</dt><dd class="mono">${modelFor(d)}</dd>
<dt>${d.type==="d"?"Answer":"Output"}</dt><dd>${esc(d.type==="d"?d.answer:d.sub)}</dd>
${d.type==="case"?`<dt>Task</dt><dd>${c.detail}</dd>`:""}
${d.status?`<dt>State</dt><dd>${statePill(d)}</dd>`:""}</dl>
${d.why?`<div class="${whyCls}">${esc(d.why)}</div>`:""}
${c&&["case","a","g","b","h","o"].includes(d.type)?liveChecklist(c.id):""}
${canFold(d)?`<div class="why">${d.collapsed?`Branch folded: ${countDesc(d)} nodes hidden. Click the node again to expand.`:"Click the node again to fold this branch."}</div>`:""}
${d.ghost?`<div class="why">Branch not taken. Shown so you can see the alternative the agent ruled out.</div>`:""}
${c?`<div class="act">${focusId===caseNode[c.id]?.id?`<button class="ghost sm" data-unfocus>Exit focus</button>`:`<button class="sm" data-focus="${c.id}">Focus case</button>`}<button class="ghost sm" data-open="${c.id}">Open in backlog</button></div>`:""}`;
$("insp").hidden=false;$("inspX").onclick=()=>{selected=null;$("insp").hidden=true;render()};
if(c){const g=groups[c.id];if(g){setGroup(g,true);flash(g.el)}}
}
svg.on("click",()=>{if(selected){selected=null;$("insp").hidden=true;render()}});
function focusCase(cid){
const cn=caseNode[cid];if(!cn){toast(`${cid} hasn't started yet. It will appear in the graph once the Planner delegates it.`);return}
let p=cn;while(p){p.collapsed=false;p=nodesById[p.parentId]}
focusId=cn.id;filter=cid;
$("focusChip").hidden=false;$("focusChip").querySelector("b").textContent=cid;
setFollow(true);applyFilter();render();
if(selected&&nodesById[selected]?.caseId===cid)select(selected);
}
function exitFocus(){
if(!focusId)return;focusId=null;filter=null;$("focusChip").hidden=true;
setFollow(true);applyFilter();render();if(selected)select(selected);
}
/* ======================= UI helpers ======================= */
function esc(s){return String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function money(v){return "$"+v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function pill(s){const m={queued:["Queued","s-queued"],working:["Working","s-working"],retry:["Recovering","s-retry"],fix:["Fixing after review","s-fix"],done:["Resolved","s-done"],esc:["Needs a human","s-esc"]}[s];return `<span class="pill ${m[1]}">${m[0]}</span>`}
function flash(el){el.classList.remove("hit");void el.offsetWidth;el.classList.add("hit")}
/* case queue: built once, updated in place so open rows keep their state */
function buildRows(){
$("rows").innerHTML=CASES.map(c=>`<div class="qrow" data-id="${c.id}">
<button class="plain qh" aria-expanded="false" aria-controls="tl-${c.id}"><span class="chev"></span><span class="q-id">${c.id}</span>
<span class="q-pt">${esc(c.pt)}<small>DOB ${c.dob}</small></span><span class="q-task">${c.type}<small>${c.detail}</small></span>
<span class="q-st"></span><span class="q-amt"></span></button>
<div class="acc" id="tl-${c.id}"><div class="in"><div class="tl"></div></div></div></div>`).join("");
}
const rowEl=id=>$("rows").querySelector(`.qrow[data-id="${id}"]`);
function updateRow(c){
const r=rowEl(c.id);if(!r)return;const st=state[c.id]||"queued",got=st==="done"&&c.value>0;
r.querySelector(".q-st").innerHTML=pill(st);
const a=r.querySelector(".q-amt");a.classList.toggle("got",got);a.innerHTML=c.value?money(c.value)+`<small class="res" style="display:block">${c.vk}</small>`:'<span class="res">—</span>';
r.classList.toggle("sel",filter===c.id);
if(r.classList.contains("open"))r.querySelector(".tl").innerHTML=timeline(c);
const g=groups[c.id];if(g)g.el.querySelector(".gst").innerHTML=pill(st);
}
function renderRows(){CASES.forEach(updateRow)}
function timeline(c){
const ns=Object.values(nodesById).filter(d=>d.caseId===c.id&&d.type!=="case"&&!d.ghost).sort((a,b)=>a.id.slice(1)-b.id.slice(1));
const st=state[c.id]||"queued";
const act=`<div class="insp-act" style="display:flex;gap:.4rem;flex-wrap:wrap">${caseNode[c.id]?`<button class="sm" data-focus="${c.id}">Focus in graph</button>`:""}${c.esc&&st==="esc"?`<span class="res">Waiting in the staff tray.</span>`:""}</div>`;
if(!ns.length)return `<p class="empty">${st==="working"?"Delegated. First sub-agent is starting.":running?"Queued: waits for a free lane.":"Not run yet. Press Run overnight."}</p>`;
return `<ol class="steps">${ns.map(d=>`<li class="st t-${d.type} s-${d.status}"><span class="gl"></span><div>
<div class="sn"><b>${esc(d.type==="d"?d.name:d.name)}</b> <span class="mono">${esc(d.type==="d"?"→ "+d.answer:d.sub)}</span></div>
<div class="smeta">${TYPE[d.type]}${modelFor(d)!=="—"?` · <span class="mono">${modelFor(d)}</span>`:""}</div>
${d.why&&d.type!=="o"?`<div class="why${d.type==="g"?" v":d.type==="b"?" b":d.type==="r"?" w":""}">${esc(d.why)}</div>`:""}</div></li>`).join("")}
${st==="working"||st==="retry"||st==="fix"?`<li class="st wait"><span class="gl"></span><div><div class="sn">Working…</div></div></li>`:""}</ol>${act}`;
}
function toggleRow(id,open){
const r=rowEl(id);if(!r)return;open=open??!r.classList.contains("open");
if(open)r.querySelector(".tl").innerHTML=timeline(CASES.find(c=>c.id===id));
r.classList.toggle("open",open);r.querySelector(".qh").setAttribute("aria-expanded",open);
}
function renderStats(){
$("kDone").textContent=n.done;$("kEsc").textContent=n.esc;$("kKids").textContent=n.kids;$("kDec").textContent=n.dec;$("kRetry").textContent=n.retry;$("kBlock").textContent=n.block;
$("escCount").textContent=n.esc;$("escCount").hidden=!n.esc;
const pct=Math.min(100,n.steps/TOTAL*100);$("track").style.width=pct+"%";
const m=22*60+Math.round(pct/100*440);$("clock").textContent=String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
$("moneyBrk").textContent=`${n.claims} claim${n.claims===1?"":"s"} fixed · ${n.auths} auth${n.auths===1?"":"s"} secured · ${(n.hrs/60).toFixed(1)} staff hours saved`;
renderDrawer();
}
function tweenMoney(){
cancelAnimationFrame(moneyRAF);const from=moneyShown,to=n.money,t0=performance.now(),dur=motion()?1000/speed:1;
const card=$("moneyCard");card.classList.remove("bump");void card.offsetWidth;card.classList.add("bump");
const step=t=>{const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);moneyShown=from+(to-from)*e;setMoney(moneyShown);if(k<1)moneyRAF=requestAnimationFrame(step)};
moneyRAF=requestAnimationFrame(step);
}
function setMoney(v){const s=money(v),i=s.lastIndexOf(".");$("money").innerHTML=`${s.slice(0,i)}<span class="c">${s.slice(i)}</span>`}
/* ======================= KPI drawer ======================= */
const KPI={money:"Revenue recovered",done:"Resolved cases",esc:"Needs a human",kids:"Sub-agents run",dec:"Decisions",retry:"Recoveries",block:"Verifier blocks"};
function kpiItems(k){
const byType=t=>Object.values(nodesById).filter(d=>d.type===t&&!d.ghost&&d.caseId);
switch(k){
case"money":return CASES.filter(c=>state[c.id]==="done"&&c.value>0).map(c=>({cid:c.id,text:`${money(c.value)} · ${c.short}`,extra:c.vk==="auth"?"auth secured":"claim recovered"}));
case"done":return CASES.filter(c=>state[c.id]==="done").map(c=>{const o=Object.values(nodesById).filter(d=>d.caseId===c.id&&d.type==="o"&&!d.ghost).pop();return {cid:c.id,text:c.short,extra:o?`${o.name} · ${o.sub}`:"handled by staff"}});
case"esc":return CASES.filter(c=>state[c.id]==="esc").map(c=>({cid:c.id,text:c.result||c.short,extra:c.esc}));
case"kids":return byType("a").map(d=>({cid:d.caseId,text:d.name,extra:d.sub}));
case"dec":return byType("d").map(d=>({cid:d.caseId,text:`${d.name} → ${d.answer}`,extra:d.why}));
case"retry":return byType("r").map(d=>({cid:d.caseId,text:d.name,extra:d.sub}));
case"block":return byType("b").map(d=>({cid:d.caseId,text:d.sub,extra:d.why}));
}
return [];
}
function renderDrawer(){
if(!kpiOpen)return;
const items=kpiItems(kpiOpen),old=$("drawerBody").querySelector(".dl"),top=old?old.scrollTop:0;
$("drawerBody").innerHTML=`<div class="dh"><b>${KPI[kpiOpen]}</b><span class="lbl">${items.length} item${items.length===1?"":"s"} · click one to focus it</span><button class="ghost sm" data-kpi-close aria-label="Close">×</button></div>
${items.length?`<div class="dl">${items.map(it=>`<button class="di" data-focus="${it.cid}"><span class="mono">${it.cid}</span><span>${esc(it.text)}</span>${it.extra?`<small>${esc(it.extra)}</small>`:""}</button>`).join("")}</div>`
:`<p class="empty">Nothing here yet. ${running?"Still running.":"Press Run overnight."}</p>`}`;
const nw=$("drawerBody").querySelector(".dl");if(nw)nw.scrollTop=top;
}
function toggleKpi(k){
kpiOpen=kpiOpen===k?null:k;
document.querySelectorAll(".tile").forEach(t=>t.setAttribute("aria-expanded",t.dataset.k===kpiOpen));
renderDrawer();$("drawer").classList.toggle("open",!!kpiOpen);
}
/* ======================= grouped log ======================= */
function setGroup(g,open){g.el.classList.toggle("open",open);g.el.querySelector(".gh").setAttribute("aria-expanded",open)}
function groupFor(cid){
const key=cid||"_run";if(groups[key])return groups[key];
const c=cid?CASES.find(x=>x.id===cid):null;
const el=document.createElement("div");el.className="grp";el.dataset.case=cid||"";
el.innerHTML=`<button class="plain gh" aria-expanded="false"><span class="chev"></span><span class="gid">${cid||"RUN"}</span><span class="gnm">${c?esc(c.short):"Planner · whole run"}</span><span class="gst"></span><span class="gct">0</span></button><div class="acc"><div class="in"><div class="evs"></div></div></div>`;
const g={el,count:0,user:false,key};groups[key]=g;
const run=groups._run;
if(run&&run!==g)run.el.after(el);else $("log").prepend(el);
if(filter&&cid!==filter)el.hidden=true;
el.querySelector(".gh").onclick=()=>{g.user=true;setGroup(g,!el.classList.contains("open"))};
requestAnimationFrame(()=>setGroup(g,true));
return g;
}
function autoClose(cid){const g=groups[cid];if(g&&!g.user&&filter!==cid)setTimeout(()=>{if(!g.user&&groups[cid]===g)setGroup(g,false)},1600/speed)}
function log(actor,msg,cls,caseId,role){
if(!n.events)$("log").innerHTML="";n.events++;
const g=groupFor(caseId);
const model={pl:MODEL.planner,vf:MODEL.verifier,sp:MODEL.worker,ch:MODEL.worker,dc:MODEL.worker}[role]||"";
const d=document.createElement("div");d.className="ev";
d.innerHTML=`<span class="t">${$("clock").textContent}</span><span class="a ${role}" title="${esc(actor)}">${esc(actor)}</span><span class="m ${cls||""}">${msg}${model?`<small>${model}</small>`:""}</span>`;
g.el.querySelector(".evs").appendChild(d);g.count++;g.el.querySelector(".gct").textContent=g.count;
if(caseId)g.el.querySelector(".gst").innerHTML=pill(state[caseId]||"working");
$("logCount").textContent=n.events+" events";
$("ticker").innerHTML=`<b>${esc(actor)}</b> ${caseId?caseId+" · ":""}${msg.replace(/<[^>]+>/g,"")}`;
}
function applyFilter(){
Object.values(groups).forEach(g=>{g.el.hidden=!!filter&&g.key!==filter;if(filter&&g.key===filter)setGroup(g,true)});
$("filterTxt").textContent=filter?`Showing ${filter} only`:"";
$("logbar").hidden=!filter;renderRows();
}
function toast(msg){$("toast").textContent=msg;$("toast").hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").hidden=true,3600)}
const sleep=(ms,id)=>new Promise((res,rej)=>setTimeout(()=>runId===id?res():rej("stop"),ms/speed));
/* ======================= run ======================= */
function buildBase(){
ids=0;nodesById={};backs=[];
rootData=mk("goal","Overnight backlog",`${CASES.length} cases · clear by 08:00`,null,{status:"done"});
const planner=mk("planner","Planner","delegates · tracks progress",rootData,{status:"done"});
SPECS.forEach(([s,sub])=>{specNode[s]=mk("spec",s,sub,planner,{status:"done"})});
rootData._planner=planner;
}
async function runCase(c,id){
const spec=specNode[c.ag];spec.status="active";
const cn=mk("case",c.id,c.short,spec,{caseId:c.id});caseNode[c.id]=cn;
state[c.id]="working";updateRow(c);render();packet(spec,cn,css("--agent"));
log("Planner",`Delegated ${c.type.toLowerCase()} → ${c.ag}`,"",c.id,"pl");
n.steps++;renderStats();
let tail=cn, pendingEdge=null; const made=[];
for(const [t,name,sub,x] of c.ev){
await sleep(BASE,id);
if(tail.status==="active"&&tail.type!=="case")tail.status="done";
if(t==="a"){
const kind=x;const nd=mk("a",name,sub,tail,{caseId:c.id,edge:pendingEdge,status:kind==="warn"?"warn":kind==="err"?"err":"active"});pendingEdge=null;
n.kids++;made.push(nd);
if(kind==="warn"){state[c.id]="retry";n.retry++}
log(name,kind==="warn"?`failed: ${sub}`:sub,{warn:"w",err:"e",flag:"f"}[kind]||"",c.id,"ch");
packet(tail,nd,css("--agent"));tail=nd;
}else if(t==="d"){
const nd=mk("d",name,sub,tail,{caseId:c.id,edge:pendingEdge,answer:sub,why:x.why,status:"active"});
mk("o",x.ghost[1],"not taken",nd,{caseId:c.id,ghost:true,edge:x.ghost[0],status:"done",why:"Ruled out: "+x.why});
pendingEdge=sub;n.dec++;
log("Decision",`${name} → <b>${sub}</b>`,"",c.id,"dc");
packet(tail,nd,css("--dec"));tail=nd;
}else if(t==="r"){
const prev=tail;const nd=mk("r",name,sub,tail,{caseId:c.id,status:"active",why:"Recovered automatically: "+sub});
backs.push({key:nd.id,from:nd.id,to:prev.id,cls:"warn",label:"retry"});
prev.status="done";state[c.id]="working";
log(c.ag,`${name}: ${sub}`,"o",c.id,"sp");packet(tail,nd,css("--warn"));tail=nd;
}else if(t==="b"){
const nd=mk("b",name,sub,tail,{caseId:c.id,status:"active",why:x.why});
const target=made[x.back];if(target)backs.push({key:nd.id,from:nd.id,to:target.id,cls:"bad",label:"sent back"});
state[c.id]="fix";n.block++;
log("Verifier",`Blocked: ${sub}. Sent back to ${target?target.name:"agent"}.`,"vb",c.id,"vf");
toast(x.toast||`Verifier blocked ${c.id} before it went out: wrong doctor's NPI. Sending it back.`);
packet(tail,nd,css("--bad"));tail=nd;
}else if(t==="g"){
const nd=mk("g",name,sub,tail,{caseId:c.id,edge:pendingEdge,status:"active",why:"Checked against the chart before closing: "+sub});pendingEdge=null;
if(state[c.id]==="fix")state[c.id]="working";
log("Verifier",`✓ ${sub}`,"o",c.id,"vf");packet(tail,nd,css("--verify"));tail=nd;
}else if(t==="o"||t==="h"){
const nd=mk(t,name,sub,tail,{caseId:c.id,edge:pendingEdge,status:"done",money:t==="o"&&c.value>0});pendingEdge=null;
packet(tail,nd,t==="o"?css("--ok"):css("--bad"));tail=nd;
if(t==="o"){
state[c.id]="done";n.done++;n.hrs+=c.mins;cn.status="done";
if(c.value){n.money+=c.value;c.vk==="auth"?n.auths++:n.claims++;tweenMoney()}
log("Planner",`Closed: ${name} · ${sub}`,c.value?"f":"o",c.id,"pl");
}else{
state[c.id]="esc";n.esc++;cn.status="human";renderEsc();
log("Planner",`Routed to staff: ${name}`,"e",c.id,"pl");
}
autoClose(c.id);
}
n.steps++;updateRow(c);renderStats();render();
}
if(!Object.values(caseNode).some(x=>x.status==="active"&&nodesById[x.parentId]===spec))spec.status="done";
render();
}
async function run(){
if(running)return;
if(LIVE.on)return runLive();
hardReset();const id=++runId;running=true;
$("run").disabled=true;$("run").textContent="Running…";$("clockSub").textContent="unattended";setModeChip("scripted run");
await walkAway(id).catch(()=>{});if(runId!==id)return;
rootData._planner.status="active";render();
log("Planner",`Goal received: ${CASES.length} cases. Splitting across ${SPECS.length} specialists, ${PAR} cases in parallel.`,"","","pl");
const queue=[...CASES];
try{
await sleep(BASE*.8,id);
await Promise.all(Array.from({length:PAR},async()=>{while(queue.length){const c=queue.shift();await runCase(c,id)}}));
await sleep(BASE,id);finish(id);
}catch(e){}
}
function walkAway(id){
return new Promise(res=>{
const o=$("overlay");o.innerHTML=`<div class="veil" id="veil"><div class="inner"><span class="lbl">Sunrise Family Medicine</span><div class="big num">22:04</div><p>Staff gone home. The agents take it from here.</p></div></div>`;
setTimeout(()=>{const v=$("veil");if(v)v.classList.add("out");setTimeout(()=>{if($("veil"))o.innerHTML="";res()},450)},Math.max(900,2200/speed));
});
}
function finish(id){
if(runId!==id)return;running=false;n.steps=TOTAL;renderStats();
rootData._planner.status="done";Object.values(specNode).forEach(s=>s.status="done");render();
log("Planner",`Backlog cleared: ${n.done} resolved, ${n.esc} for staff, ${n.block} bad outputs stopped by the Verifier.`,"o","","pl");
$("run").disabled=false;$("run").textContent="Run again";$("clockSub").textContent="report ready";
$("overlay").innerHTML=`<div class="veil" role="dialog" aria-label="Morning report"><div class="report">
<span class="lbl">Morning report · ${$("clock").textContent} · Sunrise Family Medicine</span>
<div><span class="lbl" style="color:var(--money)">Revenue recovered overnight</span><div class="hero num">${money(n.money)}</div></div>
<h3>Backlog cleared while the clinic was closed. ${n.esc} cases need a human.</h3>
<div class="row">
<div><span class="lbl">Resolved</span><b class="num">${n.done} / ${CASES.length}</b></div>
<div><span class="lbl">Staff hours saved</span><b class="num">${(n.hrs/60).toFixed(1)}</b></div>
<div><span class="lbl">Sub-agents run</span><b class="num">${n.kids}</b></div>
<div><span class="lbl">Decisions</span><b class="num">${n.dec}</b></div>
<div><span class="lbl">Bad outputs stopped</span><b class="num">${n.block}</b></div>
</div>
<p>Every closed case passed the Verifier before it went out. ${LIVE.on?`${n.retry} tool failures were recovered without anyone touching them. Live run on ${esc(MODEL.worker)}.`:`${n.retry} failures (portal timeouts, empty or pending labs, a busy fax line, a clearinghouse rejection) were recovered without anyone touching them.`}</p>
<div class="act"><button id="closeReport">See the graph</button><button class="ghost" id="replay">Run again</button></div>
</div></div>`;
$("closeReport").onclick=()=>{$("overlay").innerHTML="";setFollow(true);fit()};
$("replay").onclick=()=>{$("overlay").innerHTML="";run()};
}
function hardReset(){
runId++;LIVE.ctrl?.abort();LIVE.cases={};running=false;$("overlay").innerHTML="";
state={};filter=null;selected=null;focusId=null;$("insp").hidden=true;$("focusChip").hidden=true;hideHover();
Object.keys(caseNode).forEach(k=>delete caseNode[k]);groups={};
n={done:0,esc:0,kids:0,dec:0,retry:0,block:0,hrs:0,money:0,claims:0,auths:0,steps:0,events:0};
cancelAnimationFrame(moneyRAF);moneyShown=0;setMoney(0);
gLinks.selectAll("*").remove();gNodes.selectAll("*").remove();gElab.selectAll("*").remove();gBacks.selectAll("*").remove();gPackets.selectAll("*").remove();
buildBase();
$("log").innerHTML=`<span class="idle">Waiting for the run to start. Events group by case; the newest case opens on top.</span>`;$("logCount").textContent="0 events";
$("ticker").innerHTML=`Idle. Press <b>Run overnight</b>: the Planner splits ${CASES.length} cases across 4 specialists, who spawn sub-agents per task.`;
$("run").disabled=false;$("run").textContent="Run overnight";$("clockSub").textContent="staff leaving";setModeChip();
$("caseCount").textContent=`${CASES.length} cases · synthetic`;
setFollow(true);renderRows();renderStats();renderEsc();applyFilter();render();
}
/* ======================= live mode: SSE from /api/run ======================= */
/* Scripted DEMO_MODE stays as the fallback: no key on the server, DEMO_MODE=1, or ?demo in the URL. */
const LIVE={on:false,cfg:null,ctrl:null,cases:{}};
const forceDemo=new URLSearchParams(location.search).has("demo");
function setModeChip(st){
const c=LIVE.cfg;$("modeChip").textContent=LIVE.on?`LIVE · ${st||"ready"}`:`DEMO_MODE · ${st||"scripted"}`;
const chip=document.querySelector(".chip.c");
if(chip&&c)chip.textContent=LIVE.on&&!/crusoe/i.test(c.provider)?`${c.models.worker} · stand-in for Nemotron`:"Nemotron on Crusoe";
const note=document.querySelector(".note");
if(note&&LIVE.on)note.textContent=`All patients, payers, IDs and NPIs are fictional. Live run: every checklist, tool call and verdict is a real model call (${c.models.worker} via ${c.provider}); tools are deterministic mocks.`;
}
fetch("/api/config").then(r=>r.ok?r.json():null).then(cfg=>{
if(!cfg)return;LIVE.cfg=cfg;LIVE.on=cfg.live&&!forceDemo;
if(LIVE.on)Object.assign(MODEL,cfg.models);
if(!running)setModeChip();
}).catch(()=>{});
function liveChecklist(cid){
const L=LIVE.cases[cid];if(!L||!L.checklist.length)return "";
const last=L.rounds[L.rounds.length-1]||[];
return `<div class="why v"><b>Done-checklist${L.rounds.length?` · Verifier round ${L.rounds.length}`:" · not verified yet"}</b><ol class="chk">${L.checklist.map((x,i)=>{const v=last[i];
return `<li class="${v?(v.pass?"ok":"no"):""}">${v?(v.pass?"✓":"✗"):"…"} ${esc(x.check)}${v?`<small>${esc(v.reason)}</small>`:""}</li>`}).join("")}</ol></div>`;
}
function toolSub(e){
const r=e.result||{};
if(e.status==="invalid")return "invalid args: "+r;
if(e.status==="error")return r.error||"failed";
switch(e.tool){
case"read_chart":return "chart read";
case"read_era":return `${r.carc||"ERA"} · ${r.amount!=null?money(r.amount):""}`;
case"check_npi":return (r.matches||[]).map(m=>m.npi+(m.specialty?" "+m.specialty:"")).join(", ")||"no match";
case"payer_criteria":return `${(r.requires||[]).length} criteria`;
case"submit_claim":case"submit_auth":case"fax_send":return `${r.reference} · held for Verifier`;
case"prepare_packet":return `${r.items} items saved`;
case"escalate_to_staff":return "routed to staff";
}
return JSON.stringify(r).slice(0,60);
}
function clip(o,n=420){const s=typeof o==="string"?o:JSON.stringify(o);return s.length>n?s.slice(0,n)+"…":s}
function blameNode(L,failed){
const txt=failed.map(f=>f.check+" "+f.reason).join(" ");
if(/NPI|specialt|provider/i.test(txt)){const npi=[...L.tools].reverse().find(d=>d.name==="check_npi");if(npi)return npi}
const named=[...L.tools].reverse().find(d=>txt.includes(d.name));if(named)return named;
return [...L.tools].reverse().find(d=>/^(submit_|fax_send|prepare_packet)/.test(d.name))||L.check;
}
function liveAdd(L,type,name,sub,extra,color){
if(L.tail.status==="active"&&L.tail.type!=="case")L.tail.status="done";
const nd=mk(type,name,sub,L.tail,{caseId:L.cid,edge:L.edge,status:"active",...extra});L.edge=null;
packet(L.tail,nd,css(color||"--agent"));L.tail=nd;return nd;
}
function onLive(e,id){
if(runId!==id||e.type==="ping")return;
const c=e.caseId?CASES.find(x=>x.id===e.caseId):null,L=c?LIVE.cases[c.id]:null;
if(e.caseId&&!c)return;
switch(e.type){
case"run_start":
log("Planner",`Goal received: ${esc(e.goal)} ${e.cases.length} cases, ${e.parallel} in parallel.`,"","","pl");break;
case"delegated":{
const spec=specNode[c.ag];spec.status="active";
const cn=mk("case",c.id,c.short,spec,{caseId:c.id});caseNode[c.id]=cn;
LIVE.cases[c.id]={cid:c.id,cn,tail:cn,edge:null,checklist:[],rounds:[],tools:[],check:null};
state[c.id]="working";packet(spec,cn,css("--agent"));
log("Planner",`Delegated ${c.type.toLowerCase()} → ${c.ag}`,"",c.id,"pl");break;}
case"checklist":{
L.checklist=e.items;
L.check=liveAdd(L,"a","Done-checklist",`${e.items.length} checks`,{model:MODEL.planner,why:e.items.map((x,i)=>`${i+1}. ${x.check}`).join("\n")});
log("Planner",`Done-checklist: ${e.items.map((x,i)=>`${i+1}. ${esc(x.check)}`).join(" ")}`,"",c.id,"pl");break;}
case"tool_call":{
const bad=e.status!=="ok",prev=L.tools[L.tools.length-1],sub=toolSub(e);
const why=`Args: ${clip(e.args)}\nResult: ${clip(e.result)}`;
let nd;
if(!bad&&prev&&prev.name===e.tool&&prev.status==="warn"){
nd=liveAdd(L,"r",e.tool,sub,{model:MODEL.worker,why:"Recovered automatically after: "+prev.sub+"\n"+why},"--warn");
backs.push({key:nd.id,from:nd.id,to:prev.id,cls:"warn",label:"retry"});prev.status="done";n.retry++;state[c.id]="working";
log(c.ag,`Recovered: ${e.tool} → ${esc(sub)}`,"o",c.id,"sp");
}else{
nd=liveAdd(L,"a",e.tool,sub,{model:MODEL.worker,why,status:bad?"warn":"active"},bad?"--warn":"--agent");n.kids++;
if(bad)state[c.id]="retry";else if(state[c.id]==="retry")state[c.id]="working";
log(e.tool,bad?`failed: ${esc(sub)}`:esc(sub),bad?"w":"",c.id,"ch");
}
L.tools.push(nd);break;}
case"check_result":{
L.rounds.push(e.verdicts);
const ok=e.verdicts.filter(v=>v.pass).length,why=e.verdicts.map(v=>`${v.pass?"✓":"✗"} ${v.check}: ${v.reason}`).join("\n");
if(e.pass){
liveAdd(L,"g","Verifier",`${ok}/${e.verdicts.length} checks pass`,{model:MODEL.verifier,why},"--verify");
if(state[c.id]==="fix")state[c.id]="working";
log("Verifier",`✓ ${ok}/${e.verdicts.length} checks pass`,"o",c.id,"vf");
}else{
const failed=e.verdicts.filter(v=>!v.pass),target=blameNode(L,failed);
const nd=liveAdd(L,"b","Verifier",`${failed.length} of ${e.verdicts.length} checks failed`,{model:MODEL.verifier,why},"--bad");
if(target)backs.push({key:nd.id,from:nd.id,to:target.id,cls:"bad",label:"sent back"});
state[c.id]="fix";n.block++;
log("Verifier",`Blocked: ${esc(failed[0].reason)}`,"vb",c.id,"vf");
toast(`Verifier blocked ${c.id} before it went out: ${failed[0].reason}`);
}
break;}
case"replan":{
const ans=`No → re-plan ${e.round}/2`;
liveAdd(L,"d","All checks pass?",ans,{answer:ans,model:MODEL.planner,why:e.failed.map(f=>`${f.check}: ${f.reason}`).join("\n")},"--dec");
L.edge="re-plan";n.dec++;
log("Planner",`Re-plan ${e.round}/2: fix ${e.failed.length} failed check${e.failed.length>1?"s":""}`,"",c.id,"pl");break;}
case"loop_detected":{
liveAdd(L,"d","Loop detected?","Yes → stop",{answer:"Yes → stop",why:e.reason},"--bad");
L.edge="stop";n.dec++;
log("Loop detector",esc(e.reason),"e",c.id,"dc");break;}
case"escalated":{
const label={rule:"Staff only",agent:"Needs staff",loop:"Loop stopped",verifier:"Checks still failing",error:"Agent error"}[e.by]||"Needs staff";
liveAdd(L,"h",label,e.reason.length>48?e.reason.slice(0,46)+"…":e.reason,{status:"done",why:e.reason},"--bad");
c.esc=esc(e.reason);c.result=label;
state[c.id]="esc";n.esc++;L.cn.status="human";renderEsc();
log("Planner",`Routed to staff: ${esc(e.reason)}`,"e",c.id,"pl");autoClose(c.id);break;}
case"closed":{
liveAdd(L,"o","Closed",e.released.join(", ")||"all checks passed",{status:"done",money:c.value>0,why:e.summary},"--ok");
state[c.id]="done";n.done++;n.hrs+=c.mins;L.cn.status="done";
if(c.value){n.money+=c.value;c.vk==="auth"?n.auths++:n.claims++;tweenMoney()}
log("Planner",`Closed: ${esc(e.summary)}`,c.value?"f":"o",c.id,"pl");autoClose(c.id);break;}
case"error":
log("System",esc(e.message),"e",e.caseId||"","pl");break;
case"run_end":
LIVE.ended=true;setModeChip("done");finish(id);return;
}
if(c){
n.steps=Math.round((n.done+n.esc)/CASES.length*TOTAL);
const spec=specNode[c.ag];if(!Object.values(caseNode).some(x=>x.status==="active"&&nodesById[x.parentId]===spec))spec.status="done";
updateRow(c);
}
renderStats();render();
}
/* One request per case, CASE_CONCURRENCY lanes in the browser: no single server request has to fit the whole
   backlog inside the host's function time limit (Vercel Hobby: 300 s). */
async function streamCase(cid,id,signal){
const res=await fetch(`/api/run?cases=${encodeURIComponent(cid)}&parallel=1`,{signal,headers:{Accept:"text/event-stream"}});
if(!res.ok||!res.body){const j=await res.json().catch(()=>({}));throw new Error(j.error||"HTTP "+res.status)}
const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();let buf="";
for(;;){
const {value,done}=await reader.read();if(done||runId!==id)break;
buf+=value;let i;
while((i=buf.indexOf("\n\n"))>=0){
const data=buf.slice(0,i).split("\n").filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trim()).join("\n");buf=buf.slice(i+2);
if(!data)continue;
try{const e=JSON.parse(data);if(e.type!=="run_start"&&e.type!=="run_end")onLive(e,id)}catch(err){console.error("live event",err)}
}
}
}
async function runLive(){
hardReset();const id=++runId;running=true;
$("run").disabled=true;$("run").textContent="Running…";$("clockSub").textContent="unattended";setModeChip("running");
await walkAway(id).catch(()=>{});if(runId!==id)return;
rootData._planner.status="active";render();
const ctrl=new AbortController();LIVE.ctrl=ctrl;
const lanes=Math.max(1,Math.min(8,LIVE.cfg?.concurrency||4)),queue=CASES.map(c=>c.id);
log("Planner",`Goal received: ${CASES.length} cases. Splitting across ${SPECS.length} specialists, ${lanes} cases in parallel.`,"","","pl");
let fatal=null;
await Promise.all(Array.from({length:lanes},async()=>{
while(queue.length&&runId===id&&!fatal){
const cid=queue.shift();
try{await streamCase(cid,id,ctrl.signal)}
catch(err){
if(runId!==id||err.name==="AbortError")return;
if(!caseNode[cid]){fatal=err;return} /* nothing started: endpoint itself is failing */
log("System",`${cid}: connection lost (${esc(err.message)})`,"e",cid,"pl");
}
}
}));
if(runId!==id)return;
if(fatal){
running=false;setModeChip("error");$("run").disabled=false;$("run").textContent="Run again";$("clockSub").textContent="run failed";
log("System",`Live run failed: ${esc(fatal.message)}. Scripted fallback: add ?demo to the URL.`,"e","","pl");toast("Live run failed: "+fatal.message);return;
}
const left=CASES.filter(c=>!["done","esc"].includes(state[c.id]));
if(left.length)log("System",`${left.length} case${left.length===1?"":"s"} cut off before finishing: ${left.map(c=>c.id).join(", ")}.`,"e","","pl");
LIVE.ended=true;setModeChip(left.length?`done · ${left.length} cut off`:"done");finish(id);
}
/* ======================= Playbook panel (Version N+1) ======================= */
/* Secondary on purpose: version, the Reviewer's one change, and before/after scores from /runs. */
function renderPlaybook(d){
const el=$("pb");if(!el||!d)return;$("pbVer").textContent="v"+d.current;
const L=d.latest;
if(!L){el.innerHTML=`<p class="empty">Playbook v${d.current}. No Version N+1 run yet: <span class="mono">npm run evolve</span>.</p>`;return}
const sc=(a,b)=>`<b class="num">${a}</b> → <b class="num ${b>a?"up":b<a?"down":""}">${b}</b>`;
el.innerHTML=`<p class="pbh">Live runs use <b>playbook v${d.current}</b>. Last step: Reviewer proposed v${L.candidate}, <b class="${L.kept?"up":"down"}">${L.kept?"kept":"discarded"}</b>.</p>
<div class="pbd">${L.diff.map(x=>`<div class="df ${x.op==="+"?"add":"del"}"><span class="lbl">${x.section}</span> ${x.op} ${esc(x.rule)}</div>`).join("")}</div>
<p class="pbr">${esc(L.change.rationale)}</p>
<dl class="pbs"><dt>Training (${L.split.training.length} cases)</dt><dd>v${L.original} ${sc(L.training.baseline,L.training.candidate)} v${L.candidate}</dd>
<dt>Held-out (${L.split.heldout.length} cases)</dt><dd>v${L.heldout_baseline||L.original} ${sc(L.heldout.before,L.heldout.after)} v${L.current}</dd></dl>
<p class="pbf mono">score = ${esc(L.formula)}${L.repeats>1?` · mean of ${L.repeats} runs`:""} · ${d.runs} runs saved in /runs · ${esc(L.models.worker)}</p>`;
}
fetch("/api/playbook").then(r=>r.ok?r.json():null).then(renderPlaybook).catch(()=>{});
/* ======================= staff tray ======================= */
function renderEsc(){
const list=CASES.filter(c=>state[c.id]==="esc"||handled[c.id]);
$("esc").innerHTML=list.length?list.map(c=>handled[c.id]
?`<div class="ecard ok"><b>${c.id} · ${esc(c.pt)}</b><p>${handled[c.id]}</p></div>`
:`<div class="ecard"><b>${c.id} · ${esc(c.pt)}</b><p>${c.esc}</p><div class="act">${LIVE.on?"":`<button data-id="${c.id}" data-a="fix">Fixed, send back to agents</button>`}<button class="ghost" data-id="${c.id}" data-a="done">Mark handled</button><button class="ghost" data-focus="${c.id}">Focus</button></div></div>`).join("")
:`<p class="empty">Nothing here yet. A case lands here only when an agent can't finish it on its own.</p>`;
}
$("esc").addEventListener("click",e=>{
const b=e.target.closest("button[data-a]");if(!b)return;const id=b.dataset.id,c=CASES.find(x=>x.id===id),cn=caseNode[id];
if(b.dataset.a==="done"){handled[id]="Handled by staff.";log("Staff","Marked handled","o",id,"sf")}
else{
handled[id]="Sent back after the staff fix. Re-run passed the Verifier.";
log("Staff","Fixed and sent back to agents","o",id,"sf");
if(cn){let tail=cn;while(tail.children.filter(x=>!x.ghost).length)tail=tail.children.filter(x=>!x.ghost).slice(-1)[0];
const re=mk("a",{PriorAuth:"PortalSubmitter",Referral:"Referral",Denials:"ClaimFixer",ChartPrep:"LabSummarizer"}[c.ag],"re-run with staff fix",tail,{caseId:id,edge:"staff fix",status:"done"});
const g=mk("g","Verifier","matches updated chart",re,{caseId:id,status:"done",why:"Re-checked after the staff fix."});
mk("o",{PriorAuth:"Submitted",Referral:"Referral sent",Denials:"Resubmitted",ChartPrep:"Summary ready"}[c.ag],"after staff fix",g,{caseId:id,status:"done"});
packet(tail,re,css("--ok"))}
log(c.ag,"Re-ran with the staff fix → submitted","o",id,"sp");log("Verifier","✓ matches updated chart","o",id,"vf");
n.hrs+=Math.round(c.mins*.7);
}
state[id]="done";n.esc--;n.done++;if(cn)cn.status="done";
renderRows();renderStats();renderEsc();render();
});
/* ======================= dock + splitter ======================= */
const main=$("main"),split=$("split");
const SIDE=matchMedia("(min-width: 1100px)"),PHONE=matchMedia("(max-width: 760px)");
let dockW=store.get("dockW",null),dockH=store.get("dockH",null),dockOpen=store.get("dockOpen",true);
const secOpen=Object.assign({log:true,queue:true,esc:true},store.get("sec",{}));
function limits(){const r=main.getBoundingClientRect();return SIDE.matches?[260,Math.max(300,r.width-380)]:[110,Math.max(150,r.height-180)]}
const clampDock=v=>{const [lo,hi]=limits();return Math.round(Math.min(hi,Math.max(lo,v)))};
function applyDock(){
main.classList.toggle("dock-off",!dockOpen);
dockW==null?main.style.removeProperty("--dockW"):main.style.setProperty("--dockW",dockW+"px");
dockH==null?main.style.removeProperty("--dockH"):main.style.setProperty("--dockH",dockH+"px");
$("dock").inert=!dockOpen;
$("dockBtn").classList.toggle("on",dockOpen);$("dockBtn").setAttribute("aria-pressed",dockOpen);
split.setAttribute("aria-orientation",SIDE.matches?"vertical":"horizontal");
const r=main.getBoundingClientRect(),d=$("dock").getBoundingClientRect();
split.setAttribute("aria-valuenow",dockOpen?Math.round(100*(SIDE.matches?d.width/r.width:d.height/r.height)):0);
}
function setDock(open){dockOpen=open;store.set("dockOpen",open);vt(applyDock)}
split.addEventListener("pointerdown",e=>{
if(PHONE.matches||e.button!==0)return;e.preventDefault();split.setPointerCapture(e.pointerId);
dockOpen=true;main.classList.add("dragging");
const move=ev=>{const r=main.getBoundingClientRect();if(SIDE.matches)dockW=clampDock(r.right-ev.clientX-split.offsetWidth/2);else dockH=clampDock(r.bottom-ev.clientY-split.offsetHeight/2);applyDock()};
const up=()=>{split.removeEventListener("pointermove",move);split.removeEventListener("pointerup",up);split.removeEventListener("pointercancel",up);
main.classList.remove("dragging");store.set("dockW",dockW);store.set("dockH",dockH);store.set("dockOpen",true)};
split.addEventListener("pointermove",move);split.addEventListener("pointerup",up);split.addEventListener("pointercancel",up);
});
split.addEventListener("dblclick",()=>{dockW=null;dockH=null;dockOpen=true;store.set("dockW",null);store.set("dockH",null);store.set("dockOpen",true);vt(applyDock)});
split.addEventListener("keydown",e=>{
const d=$("dock").getBoundingClientRect(),cur=SIDE.matches?d.width:d.height,[lo,hi]=limits(),step=e.shiftKey?80:24;
const grow=SIDE.matches?{ArrowLeft:1,ArrowRight:-1}:{ArrowUp:1,ArrowDown:-1};
let v=null;if(e.key in grow)v=cur+grow[e.key]*step;else if(e.key==="Home")v=lo;else if(e.key==="End")v=hi;
else if(e.key==="Enter"){e.preventDefault();setDock(!dockOpen);return}
if(v===null)return;e.preventDefault();dockOpen=true;if(SIDE.matches)dockW=clampDock(v);else dockH=clampDock(v);
applyDock();store.set("dockW",dockW);store.set("dockH",dockH);store.set("dockOpen",true);
});
SIDE.addEventListener("change",applyDock);PHONE.addEventListener("change",applyDock);
$("dockBtn").onclick=()=>setDock(!dockOpen);
function setSec(sec,open){const s=document.querySelector(`.sec[data-sec="${sec}"]`);s.classList.toggle("open",open);s.querySelector(".tgl").setAttribute("aria-expanded",open);secOpen[sec]=open;store.set("sec",secOpen)}
document.querySelectorAll(".sec").forEach(s=>{const k=s.dataset.sec;setSec(k,!!secOpen[k]);s.querySelector(".tgl").onclick=()=>setSec(k,!s.classList.contains("open"))});
/* graph follows its container */
let roRAF=0;
new ResizeObserver(()=>{cancelAnimationFrame(roRAF);roRAF=requestAnimationFrame(()=>{if(follow)fit(main.classList.contains("dragging")||!motion()?0:250)})}).observe($("graph"));
/* ======================= controls ======================= */
function setFollow(v){follow=v;$("follow").classList.toggle("on",v);$("follow").setAttribute("aria-pressed",v)}
$("run").onclick=run;
$("reset").onclick=()=>{Object.keys(handled).forEach(k=>delete handled[k]);hardReset()};
$("speed").onclick=()=>{speed=speed===1?3:speed===3?8:1;$("speed").textContent=`Speed ${speed}×`};
$("present").onclick=()=>vt(()=>{const on=document.documentElement.classList.toggle("present");$("present").classList.toggle("on",on);$("present").setAttribute("aria-pressed",on)});
$("follow").onclick=()=>{setFollow(!follow);if(follow)fit()};
$("fit").onclick=()=>{setFollow(true);fit()};
$("collapseAll").onclick=()=>setAll(true);
$("expandAll").onclick=()=>setAll(false);
$("focusChip").onclick=exitFocus;
$("clearFilter").onclick=exitFocus;
$("grpCollapse").onclick=()=>Object.values(groups).forEach(g=>{g.user=true;setGroup(g,false)});
$("grpExpand").onclick=()=>Object.values(groups).forEach(g=>{g.user=true;setGroup(g,true)});
$("rows").addEventListener("click",e=>{const h=e.target.closest(".qh");if(h)toggleRow(h.parentElement.dataset.id)});
document.querySelectorAll(".tile").forEach(t=>t.onclick=()=>toggleKpi(t.dataset.k));
document.addEventListener("click",e=>{
const f=e.target.closest("[data-focus]");if(f){focusCase(f.dataset.focus);return}
if(e.target.closest("[data-unfocus]")){exitFocus();return}
if(e.target.closest("[data-kpi-close]")){toggleKpi(kpiOpen);return}
const o=e.target.closest("[data-open]");if(o){if(!dockOpen)setDock(true);setSec("queue",true);toggleRow(o.dataset.open,true);rowEl(o.dataset.open)?.scrollIntoView({block:"nearest",behavior:motion()?"smooth":"auto"})}
});
document.addEventListener("keydown",e=>{
if(e.key!=="Escape"||document.querySelector(".veil"))return;
if(focusId)exitFocus();else if(!$("insp").hidden){selected=null;$("insp").hidden=true;render()}else if(kpiOpen)toggleKpi(kpiOpen);
});
buildRows();applyDock();
hardReset();
