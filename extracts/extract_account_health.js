(function(){
  var text = document.body.innerText;
  var data = {};
  var ratingMatch = text.match(/(\d{2,4})\s*\n\s*0\s*\n\s*100/);
  if (!ratingMatch) ratingMatch = text.match(/账户状况评级[^\d]*(\d{2,4})/);
  data.accountHealthRating = ratingMatch ? parseInt(ratingMatch[1]) : null;
  data.policyCompliance = text.includes('良好') ? '良好' : (text.includes('Good') ? 'Good' : '异常');
  var issues = {};
  var issuePatterns = [
    ['涉嫌侵犯知识产权', /涉嫌侵犯知识产权\s*\n?\s*(\d+)/],
    ['知识产权投诉', /知识产权投诉\s*\n?\s*(\d+)/],
    ['商品真实性买家投诉', /商品真实性买家投诉\s*\n?\s*(\d+)/],
    ['商品状况买家投诉', /商品状况买家投诉\s*\n?\s*(\d+)/],
    ['食品和商品安全问题', /食品和商品安全问题\s*\n?\s*(\d+)/],
    ['上架政策违规', /上架政策违规\s*\n?\s*(\d+)/],
    ['违反受限商品政策', /违反受限商品政策\s*\n?\s*(\d+)/],
    ['违反买家商品评论政策', /违反买家商品评论政策\s*\n?\s*(\d+)/],
    ['其他违反政策', /其他违反政策\s*\n?\s*(\d+)/],
    ['监管合规性', /监管合规性\s*\n?\s*(\d+)/]
  ];
  for (var i = 0; i < issuePatterns.length; i++) {
    var m = text.match(issuePatterns[i][1]);
    issues[issuePatterns[i][0]] = m ? parseInt(m[1]) : null;
  }
  data.policyIssues = issues;
  data.totalIssues = Object.values(issues).reduce(function(s, v){ return s + (v || 0); }, 0);
  var odrMatch = text.match(/订单缺陷率[^%]*(\d+)%/);
  data.orderDefectRate = odrMatch ? odrMatch[1] + '%' : 'N/A';
  data.lateShipmentRate = 'N/A';
  var lateMatch = text.match(/迟发率[^%]*(\d+)%/);
  if (lateMatch) data.lateShipmentRate = lateMatch[1] + '%';
  data.url = location.href;
  data.title = document.title;
  return JSON.stringify(data);
})()
