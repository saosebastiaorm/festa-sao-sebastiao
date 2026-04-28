/* =====================================================
   FPSS MASTER
   ARQUIVO: /js/lightbox.js
   GALERIA PREMIUM
===================================================== */

(function(){

const imagens = document.querySelectorAll(".gallery img");
const lightbox = document.getElementById("lightbox");
const imgBox = document.getElementById("imgBox");
const btnClose = document.getElementById("closeBox");
const btnPrev = document.getElementById("prev");
const btnNext = document.getElementById("next");

if(!imagens.length || !lightbox || !imgBox) return;

let atual = 0;

/* =========================
   ABRIR
========================= */
function abrir(i){

atual = i;
imgBox.src = imagens[atual].src;
imgBox.alt = imagens[atual].alt || "Imagem FPSS";

lightbox.style.display = "flex";
document.body.style.overflow = "hidden";

}

/* =========================
   FECHAR
========================= */
function fechar(){

lightbox.style.display = "none";
document.body.style.overflow = "auto";

}

/* =========================
   PRÓXIMA
========================= */
function proxima(){

atual++;

if(atual >= imagens.length){
atual = 0;
}

imgBox.src = imagens[atual].src;
imgBox.alt = imagens[atual].alt || "Imagem FPSS";

}

/* =========================
   ANTERIOR
========================= */
function anterior(){

atual--;

if(atual < 0){
atual = imagens.length - 1;
}

imgBox.src = imagens[atual].src;
imgBox.alt = imagens[atual].alt || "Imagem FPSS";

}

/* =========================
   CLIQUE NAS IMAGENS
========================= */
imagens.forEach((img,index)=>{

img.addEventListener("click",function(){
abrir(index);
});

});

/* =========================
   BOTÕES
========================= */
if(btnClose){
btnClose.addEventListener("click",fechar);
}

if(btnNext){
btnNext.addEventListener("click",proxima);
}

if(btnPrev){
btnPrev.addEventListener("click",anterior);
}

/* =========================
   FECHAR FORA DA IMAGEM
========================= */
lightbox.addEventListener("click",function(e){

if(e.target === lightbox){
fechar();
}

});

/* =========================
   TECLADO
========================= */
document.addEventListener("keydown",function(e){

if(lightbox.style.display !== "flex") return;

if(e.key === "Escape"){
fechar();
}

if(e.key === "ArrowRight"){
proxima();
}

if(e.key === "ArrowLeft"){
anterior();
}

});

/* =========================
   TOUCH SWIPE MOBILE
========================= */
let inicioX = 0;

lightbox.addEventListener("touchstart",function(e){
inicioX = e.changedTouches[0].clientX;
});

lightbox.addEventListener("touchend",function(e){

let fimX = e.changedTouches[0].clientX;
let dist = fimX - inicioX;

if(dist > 50){
anterior();
}

if(dist < -50){
proxima();
}

});

})();
