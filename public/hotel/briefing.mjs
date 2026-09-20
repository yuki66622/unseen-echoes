const envelope = document.getElementById('case-envelope');
const stage = document.getElementById('case-envelope-stage');
const letter = document.getElementById('case-letter');
const intro = document.getElementById('intro');
envelope.addEventListener('click', () => {
  stage.hidden = true; letter.hidden = false; intro.dataset.letterOpen = 'true';
  envelope.setAttribute('aria-expanded','true');
  letter.focus({preventScroll:true}); window.scrollTo({top:0});
});
document.getElementById('case-close').addEventListener('click', () => {
  letter.hidden = true; stage.hidden = false; intro.dataset.letterOpen = 'false';
  envelope.setAttribute('aria-expanded','false');
  envelope.focus({preventScroll:true}); window.scrollTo({top:0});
});
envelope.disabled = false;
