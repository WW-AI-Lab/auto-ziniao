(function(){
  var text = document.body.innerText;
  var data = {};
  function num(re){ var m = text.match(re); return m ? parseInt(m[1]) : 0; }
  data.pendingOrders = num(/(\d+)\s*等待中/);
  data.unshippedOrders = num(/(\d+)\s*未发货/);
  data.todayShipments = num(/(\d+)\s*今天配送/);
  data.priorityPending = num(/(\d+)\s*未发货的优先配送订单/);
  data.b2bPending = num(/(\d+)\s*未发货企业买家订单/);
  data.nearLateShipment = num(/(\d+)\s*濒临延迟发货/);
  data.nearCancellation = num(/(\d+)\s*濒临取消/);
  data.totalOrdersInPeriod = num(/(\d+)\s*个订单/);
  data.noOrdersFound = text.includes('未找到与指定搜索条件相匹配的订单') || text.includes('No orders found');
  data.alerts = [];
  if (data.nearCancellation > 0) data.alerts.push('有订单濒临取消: ' + data.nearCancellation);
  if (data.nearLateShipment > 0) data.alerts.push('有订单濒临延迟发货: ' + data.nearLateShipment);
  if (data.pendingOrders > 5) data.alerts.push('待发货订单较多: ' + data.pendingOrders);
  data.url = location.href;
  data.extractedAt = new Date().toISOString();
  return JSON.stringify(data);
})()
