(function(){
  var btns = document.querySelectorAll('button[aria-label]');
  for (var i = 0; i < btns.length; i++) {
    var label = btns[i].getAttribute('aria-label') || '';
    if (label === '设置' || label === 'Settings') {
      btns[i].click();
      return 'clicked';
    }
  }
  return 'not_found';
})()
