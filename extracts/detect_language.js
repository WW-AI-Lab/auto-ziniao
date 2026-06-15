(function(){
  return JSON.stringify({
    lang: document.documentElement.lang || 'unknown',
    title: document.title
  });
})()
