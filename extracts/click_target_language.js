(function(){
  // ${params.target_lang} 由流程引擎在执行前替换
  var targetLang = '${params.target_lang}';
  var langMap = {
    'zh-CN': '中文(简体)',
    'en-US': 'English',
    'ja': '日本語',
    'ko': '한국어'
  };
  var target = langMap[targetLang] || targetLang;
  var links = document.querySelectorAll('.ngstrim-dropdown-container a');
  for (var i = 0; i < links.length; i++) {
    if (links[i].innerText.trim() === target) {
      links[i].click();
      return JSON.stringify({clicked: true, target: target});
    }
  }
  return JSON.stringify({clicked: false, error: 'target language link not found', target: target});
})()
