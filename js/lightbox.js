/* ==================================================
ARQUIVO: js/lightbox.js
GALERIA PREMIUM FPSS
================================================== */

const imagens = document.querySelectorAll(".gallery img");
const lightbox = document.getElementById("lightbox");
const imgBox = document.getElementById("imgBox");

let atual = 0;

/* ABRIR */
function abrirImagem(i){

atual = i;

imgBox.src = imagens[atual].src;

lightbox.style.display = "flex";

document.body.style.overflow = "hidden";

}

/* FECHAR */
function fecharImagem(){

lightbox.style.display = "none";

document.body.style.overflow = "auto";

}

/* PRÓXIMA */
function proximaImagem(){

atual++;

if(atual >= imagens.length){
atual = 0;
}

imgBox.src = imagens[atual].src;

}

/* ANTERIOR */
function imagemAnterior(){

atual--;

if(atual < 0){
atual = imagens.length - 1;
}

imgBox.src = imagens[atual].src;

}

/* CLIQUE NAS FOTOS */
imagens.forEach((img, i) => {

img.addEventListener("click", function(){

abrirImagem(i);

});

});

/* BOTÕES */
document.getElementById("closeBox")
.addEventListener("click", fecharImagem);

document.getElementById("next")
.addEventListener("click", proximaImagem);

document.getElementById("prev")
.addEventListener("click", imagemAnterior);

/* FECHAR FUNDO */
lightbox.addEventListener("click", function(e){

if(e.target === lightbox){
fecharImagem();
}

});

/* TECLADO */
document.addEventListener("keydown", function(e){

if(lightbox.style.display === "flex"){

if(e.key === "Escape"){
fecharImagem();
}

if(e.key === "ArrowRight"){
proximaImagem();
}

if(e.key === "ArrowLeft"){
imagemAnterior();
}

}

});
