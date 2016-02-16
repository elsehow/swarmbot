var swarmlog = require('swarmlog')
var sub = require('subleveldown')
var hindex = require('hyperlog-index')
var multiplex = require('multiplex')
var duplexify = require('duplexify')
var through = require('through2')
var once = require('once')
var defined = require('defined')
var xtend = require('xtend')
var has = require('has')

var MIRROR_DATA = 'md', MIRROR_INDEX = 'mi', LOG = 'l!'

module.exports = Swarmbot

function Swarmbot (opts) {
  var self = this
  if (!(self instanceof Swarmbot)) return new Swarmbot(opts)
  var keys = opts.keys || {}
  self.id = defined(
    opts.publicKey, opts.public, opts.pub, opts.identity, opts.id,
    keys.publicKey, keys.public, keys.pub, keys.identity, keys.id
  )
  self.logdb = opts.logdb
  self._swopts = {
    wrtc: opts.wrtc,
    hubs: opts.hubs,
    keys: opts.keys,
    sodium: opts.sodium,
    valueEncoding: 'json'
  }
  self.log = swarmlog(xtend(self._swopts, {
    db: sub(self.logdb, LOG + self.id)
  }))
  self.logs = {}
  self._mdb = {
    data: sub(opts.idb, MIRROR_DATA),
    index: sub(opts.idb, MIRROR_INDEX),
  }
  self.indexes = {
    mirror: hindex({
      log: self.log,
      db: self._mdb.index,
      map: function (row, next) {
        if (row.value && row.value.type === 'bot.mirror'
        && row.value.id) {
          self._mdb.data.put(row.value.id, row.key, next)
        } else if (row.value && row.value.type === 'bot.unmirror'
        && row.value.id) {
          self._mdb.data.del(row.value.id, next)
        } else next()
      }
    })
  }
  self._resume()
}

Swarmbot.prototype._resume = function () {
  var self = this
  var r = self.mirroring()
  r.pipe(through.obj(function (m, enc, next) {
    if (!has(self.logs, m.id)) {
      self.logs[m.id] = swarmlog(xtend(self._swopts, {
        db: sub(self.logdb, LOG + m.id)
      }))
    }
    next()
  }))
}

Swarmbot.prototype.mirroring = function (cb) {
  var self = this
  if (cb) cb = once(cb)
  var d = duplexify.obj()
  var results = cb ? [] : null
  d.setWritable(null)
  self.indexes.mirror.ready(function () {
    d.setReadable(pump(
      self._mdb.createReadStream(),
      through.obj(write, end)
    ))
  })
  if (cb) d.once('error', cb)
  return d

  function write (row, enc, next) {
    var doc = { id: row.key, key: row.value }
    if (results) results.push(doc)
    this.push(doc)
    next()
  }
  function end (next) {
    if (cb) cb(null, results)
    next()
  }
}

Swarmbot.prototype.mirror = function (id, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  var doc = { type: 'bot.mirror', id: id }
  if (opts.links) this.log.add(opts.links, doc, opts, onadd)
  else this.log.append(doc, opts, onadd)
}

Swarmbot.prototype.unmirror = function (ids, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  var doc = { type: 'bot.unmirror', id: id }
  if (opts.links) this.log.add(opts.links, doc, opts, onadd)
  else this.log.append(doc, opts, onadd)
}

Swarmbot.prototype.open = function (id, opts) {
  var self = this
  if (id && typeof id === 'object' && !opts)
    opts = id
    id = opts.id
  }
  if (has(self.logs, id)) return self.logs[id]
  self.logs[id] = swarmlog(xtend(self._swopts, {
    db: sub(self.logdb, LOG + id)
  }))
}

Swarmbot.prototype.close = function (id) {
  if (this.logs[id]) {
    this.logs[id].peers.forEach(function (peer) {
      peer.close()
    })
    this.logs[id].close()
    delete this.logs[id]
  }
}

Swarmbot.prototype.destroy = function () {
  var self = this
  Object.keys(self.logs).forEach(function (id) {
    self.close(id)
  })
}
