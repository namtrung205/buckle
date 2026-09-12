"use strict";
/* Hello Buckle — a zip-loaded sample plugin. Self-contained RPC client: it
 * never imports anything, posts the canonical envelope and uses the host's
 * closed method table (model.query / ui.notify). */
var V = 1, nextId = 0, pending = new Map();
self.onmessage = function (event) {
  var msg = event.data;
  if (msg && msg.v === V && msg.id && pending.has(msg.id)) {
    var entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.value);
    else entry.reject(new Error((msg.error && msg.error.message) || "rpc error"));
  }
};
function call(method, params) {
  return new Promise(function (resolve, reject) {
    var id = "hello-" + (++nextId);
    pending.set(id, { resolve: resolve, reject: reject });
    self.postMessage(params === undefined ? { v: V, id: id, method: method } : { v: V, id: id, method: method, params: params });
  });
}
call("model.query").then(function (snapshot) {
  var count = function (kind) { return Array.isArray(snapshot && snapshot[kind]) ? snapshot[kind].length : 0; };
  return call("ui.notify", {
    message: "Hello Buckle! " + count("nodes") + " nodes, " + count("members") + " members",
    kind: "success"
  });
}).catch(function (error) {
  return call("ui.notify", { message: "Hello Buckle error: " + (error && error.message), kind: "error" });
});