import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, query, orderBy, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Preencha com as credenciais do projeto Firebase criado para a família.
const firebaseConfig = {
  apiKey: "COLOQUE_SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  appId: "COLOQUE_SEU_APP_ID"
};

const FAMILY_ORDER = ["Neias","Némerson","Nilton","Nélison","Izanete","Idelma","Ivandra","Ilizandra"];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let confirmation = null, currentMember = null, unsubscribeAppointments = null;
const $ = id => document.getElementById(id);
const show = (id, yes=true) => $(id).classList.toggle("hidden", !yes);
const toast = msg => { $("toast").textContent=msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2600); };

$("sendCodeBtn").onclick = async () => {
  try {
    const phone = $("phone").value.trim();
    if (!phone.startsWith("+") || phone.length < 10) throw new Error("Informe o telefone com código do país, por exemplo +55 11 99999-9999.");
    if (!window.recaptchaVerifier) window.recaptchaVerifier = new RecaptchaVerifier(auth,"recaptcha-container",{size:"invisible"});
    confirmation = await signInWithPhoneNumber(auth, phone, window.recaptchaVerifier);
    show("codeArea"); $("loginMessage").textContent="Código enviado. Verifique suas mensagens SMS.";
  } catch(e) { $("loginMessage").textContent=e.message; }
};
$("verifyCodeBtn").onclick = async () => {
  try { await confirmation.confirm($("smsCode").value.trim()); }
  catch(e) { $("loginMessage").textContent="Não foi possível confirmar o código. Confira os números e tente novamente."; }
};
$("logoutBtn").onclick = () => signOut(auth);
$("newAppointmentBtn").onclick = () => $("appointmentDialog").showModal();
$("closeDialog").onclick = () => $("appointmentDialog").close();
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".tabpage").forEach(x=>x.classList.add("hidden"));
  $("tab-"+b.dataset.tab).classList.remove("hidden");
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    show("loginView"); show("appView",false); show("logoutBtn",false);
    if(unsubscribeAppointments) unsubscribeAppointments();
    return;
  }
  try {
    const memberSnap = await getDoc(doc(db,"members",user.uid));
    if(!memberSnap.exists() || memberSnap.data().active !== true) {
      await signOut(auth);
      $("loginMessage").textContent="Seu número ainda não foi liberado pelo administrador.";
      return;
    }
    currentMember={uid:user.uid,...memberSnap.data()};
    show("loginView",false); show("appView"); show("logoutBtn");
    $("welcomeName").textContent=currentMember.name;
    $("roleDescription").textContent=currentMember.role==="admin"?"Você é o administrador principal.":"Você pode acompanhar a agenda e registrar compromissos.";
    show("adminArea",currentMember.role==="admin");
    renderRotation();
    listenAppointments();
    renderFamily();
  } catch(e) { toast("Erro ao carregar perfil. Verifique a configuração do Firebase."); }
});

function renderRotation(){
  const list=$("rotationList"); list.innerHTML="";
  FAMILY_ORDER.forEach(n=>{const li=document.createElement("li");li.textContent=n;list.append(li);});
}
function renderFamily(){
  $("familyList").innerHTML="";
  FAMILY_ORDER.forEach(n=>{const d=document.createElement("div");d.className="item";d.innerHTML=`<strong>${n}</strong><span class="tag">Participante</span>`;$("familyList").append(d);});
}
function listenAppointments(){
  if(unsubscribeAppointments) unsubscribeAppointments();
  const q=query(collection(db,"appointments"),orderBy("date","asc"));
  unsubscribeAppointments=onSnapshot(q,snap=>{
    const upcoming=[],history=[];
    snap.forEach(d=>{const a={id:d.id,...d.data()};(a.date?.toDate && a.date.toDate()<new Date()?history:upcoming).push(a);});
    renderAppointmentList("appointments",upcoming);
    renderAppointmentList("historyList",history.reverse());
  },()=>toast("Não foi possível sincronizar a agenda."));
}
function renderAppointmentList(target,items){
  const el=$(target);el.innerHTML="";
  if(!items.length){el.innerHTML='<p class="muted">Nenhum registro por enquanto.</p>';return;}
  items.forEach(a=>{
    const d=document.createElement("article");d.className="item";
    const when=a.date?.toDate?a.date.toDate().toLocaleString("pt-BR"):"Data a definir";
    const left=document.createElement("div");
    const h=document.createElement("h3");h.textContent=`${a.kind} — ${a.parent}`;
    const p=document.createElement("p");p.textContent=`${when} · Responsável: ${a.assignee||"A definir"}`;
    const p2=document.createElement("p");p2.textContent=[a.professional,a.notes].filter(Boolean).join(" · ");
    left.append(h,p,p2);const tag=document.createElement("span");tag.className="tag";tag.textContent=a.status||"Agendado";d.append(left,tag);el.append(d);
  });
}

$("appointmentForm").onsubmit=async ev=>{
  ev.preventDefault();
  try{
    const dateValue=$("date").value;
    if(!dateValue) throw new Error("Informe a data e o horário.");
    const date=new Date(dateValue);
    // A transação garante que dois cadastros simultâneos não recebam a mesma posição.
    await runTransaction(db,async tx=>{
      const stateRef=doc(db,"settings","rotation");
      const stateSnap=await tx.get(stateRef);
      const index=stateSnap.exists()?Number(stateSnap.data().nextIndex||0):0;
      const assignee=FAMILY_ORDER[index%FAMILY_ORDER.length];
      const appointmentRef=doc(collection(db,"appointments"));
      tx.set(appointmentRef,{
        parent:$("parent").value,kind:$("kind").value,date,
        professional:$("professional").value.trim(),notes:$("notes").value.trim(),
        assignee,createdBy:currentMember.uid,createdByName:currentMember.name,
        status:"Agendado",createdAt:serverTimestamp(),rotationIndex:index
      });
      tx.set(stateRef,{nextIndex:(index+1)%FAMILY_ORDER.length,lastAssigned:assignee,updatedAt:serverTimestamp()});
      const logRef=doc(collection(db,"auditLog"));
      tx.set(logRef,{action:"appointment_created",assignee,appointmentId:appointmentRef.id,by:currentMember.uid,at:serverTimestamp()});
    });
    $("appointmentDialog").close();$("appointmentForm").reset();toast("Compromisso cadastrado e responsável atribuído.");
  }catch(e){$("formMessage").textContent=e.message||"Erro ao salvar compromisso.";}
};

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));