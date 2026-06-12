(function(){
  var links = document.querySelectorAll('a.ngstrim-nav-menu-l2');
  for (var i = 0; i < links.length; i++) {
    var t = links[i].innerText.trim();
    if (t === '管理账户状况' || t === 'Manage Account Health') {
      links[i].click();
      return 'navigating';
    }
  }
  return 'not_found';
})()
