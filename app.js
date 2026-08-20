const b=document.getElementById('theme');b.addEventListener('click',()=>{document.body.classList.toggle('dark');b.textContent=document.body.classList.contains('dark')?'Light Mode':'Dark Mode'});
