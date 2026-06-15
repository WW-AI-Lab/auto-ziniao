(function(){
  var text = document.body.innerText;
  var data = {};
  var lines = text.split('\n').map(function(l){ return l.trim(); });
  function findNumAfter(label){
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === label && i + 1 < lines.length) {
        var n = parseInt(lines[i + 1]);
        if (!isNaN(n)) return n;
      }
    }
    return 0;
  }
  data.totalProducts = findNumAfter('所有商品');
  data.activeProducts = findNumAfter('启售商品');
  data.draftProducts = findNumAfter('补全草稿');
  data.needsImprovement = findNumAfter('改善商品信息');
  var products = [];
  var asinRegex = /ASIN\s*\n?\s*([A-Z0-9]{10})/g;
  var m;
  while ((m = asinRegex.exec(text)) !== null) {
    var chunk = text.substring(Math.max(0, m.index - 200), m.index + 300);
    var skuMatch = chunk.match(/SKU\s*\n?\s*([\w-]+)/);
    var status = chunk.includes('在售') ? '在售' : (chunk.includes('不可售') ? '不可售' : '暂停');
    var titleMatch = chunk.match(/([A-Za-z].{30,120})/);
    products.push({
      status: status,
      asin: m[1],
      sku: skuMatch ? skuMatch[1] : null,
      titleSnippet: titleMatch ? titleMatch[1].substring(0, 80) : null
    });
    if (products.length >= 50) break;
  }
  data.products = products;
  data.shownCount = products.length;
  var totalMatch = text.match(/1\s*-\s*(\d+)\s*共\s*(\d+)/);
  data.pageShown = totalMatch ? parseInt(totalMatch[1]) : 0;
  data.pageTotal = totalMatch ? parseInt(totalMatch[2]) : 0;
  data.url = location.href;
  data.extractedAt = new Date().toISOString();
  return JSON.stringify(data);
})()
