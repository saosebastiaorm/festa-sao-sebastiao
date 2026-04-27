/* CONTADOR FPSS - CORRIGIDO */

const dataEvento = new Date(2027, 0, 24, 10, 0, 0).getTime();
/* Ano, mês(0=Janeiro), dia, hora */

function atualizarContador(){

const agora = new Date().getTime();
const distancia = dataEvento - agora;

if(distancia <= 0){
document.getElementById("countdown").innerHTML =
"🎉 HOJE É O EVENTO!";
return;
}

const dias = Math.floor(distancia / (1000*60*60*24));
const horas = Math.floor((distancia % (1000*60*60*24)) / (1000*60*60));
const minutos = Math.floor((distancia % (1000*60*60)) / (1000*60));
const segundos = Math.floor((distancia % (1000*60)) / 1000);

document.getElementById("dias").textContent = dias;
document.getElementById("horas").textContent = horas;
document.getElementById("minutos").textContent = minutos;
document.getElementById("segundos").textContent = segundos;

}

setInterval(atualizarContador,1000);
atualizarContador();
