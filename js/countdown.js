/* =====================================================
   FPSS MASTER
   ARQUIVO: /js/countdown.js
   CONTADOR OFICIAL
===================================================== */

(function(){

const alvo = new Date("2027-01-24T10:00:00").getTime();

const elDias = document.getElementById("dias");
const elHoras = document.getElementById("horas");
const elMin = document.getElementById("minutos");
const elSeg = document.getElementById("segundos");
const box = document.getElementById("countdown");

if(!box) return;

/* =========================
   FORMATAÇÃO
========================= */
function dois(n){
return String(n).padStart(2,"0");
}

/* =========================
   ATUALIZAR
========================= */
function atualizar(){

const agora = new Date().getTime();
const diff = alvo - agora;

if(diff <= 0){

box.innerHTML = `
<div class="time-box" style="min-width:260px">
<div class="time-number">🎉</div>
<div class="time-label">HOJE É O EVENTO</div>
</div>
`;

clearInterval(timer);
return;
}

const dias = Math.floor(diff / (1000 * 60 * 60 * 24));

const horas = Math.floor(
(diff % (1000 * 60 * 60 * 24)) /
(1000 * 60 * 60)
);

const minutos = Math.floor(
(diff % (1000 * 60 * 60)) /
(1000 * 60)
);

const segundos = Math.floor(
(diff % (1000 * 60)) / 1000
);

if(elDias) elDias.textContent = dias;
if(elHoras) elHoras.textContent = dois(horas);
if(elMin) elMin.textContent = dois(minutos);
if(elSeg) elSeg.textContent = dois(segundos);

}

/* =========================
   INICIAR
========================= */
atualizar();

const timer = setInterval(atualizar,1000);

})();
