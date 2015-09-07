/**
 * Back end for tabbit.org pastebin.
 * Note that soon mongodb-promisified will be merged
 * into the official node mongodb client. When that
 * happens I should probably come in here and update.
 */

var koa = require('koa')()
  , cors = require('kcors')
  , router = require('koa-router')()
  , cobody = require('co-body')
  , serve = require('koa-static')
  , path = require('path')
  , favicon = require('koa-favicon')
  , nunjucks = require('nunjucks')
  , dateformat = require('date-format')
  , MongoClient = require('mongodb-promisified')().MongoClient;
  ;


/**
 * Fetch a single entry.
 */

function* getOne () {

  if (this.path === '/favicon.ico') return;



  var doc = yield this.db.entries.findOne({id: this.params.id})
  if (!doc) {
    this.body = nunjucks.render('./views/404.html')
    return
  }

  /*
   * doc.lines is an array where each element is a number - the total
   * number of lines for that paste. ie, [34, 12, 3]. Here we
   * convert it to [ [1,2..57], [1,2..9], [1,2,3] ]. The reason
   * we want want it in this multidimensional array format is so
   * we can run a for loop in our templating engine.
   * TODO list comprehension
   */

  doc.lines =  doc.lines.map(n => {
    var tmp = []
    for (var i = 1; i <= n; i++) tmp.push(i)
    return tmp
  })

  // We don't need to render these. don't send.
  delete doc._id
  delete doc.ip

  doc.date = dateformat.asString('MM/dd/yy @ hh:mm', new Date(doc.date))
  this.body = nunjucks.render('./views/entry.html', {
    doc: doc,
    jsonDoc: JSON.stringify(doc)
  })

}


/**
 * Fetch all entries.
 * Possibly bad if it gets a lot of requests.
 * Not sure if puny little server can handle such intense
 * requests. May the force be with us
 */

function* getAll () {
  var cursor =  yield this.db.entries.find().sort({date:-1}).toArray()
  var ids = cursor.map((doc) => doc.id)
  this.body = nunjucks.render('./views/all.html', {ids: ids})
}


/**
 * Adds an entry into mongo.
 */

function* add () {

  var body = yield cobody.json(this)

  // Basic security check
  if (!Array.isArray(body.pastes) || !body.pastes.length) return
  if (!Array.isArray(body.tabs)) return


  var entry = {

    // A unique id
    id: yield uniqueId(this),

    // A list of tab titles (untitled, helloworld.c)
    tabs: [],

    // Pastes contents
    pastes: [],

    // Total line number for each paste
    lines: [],

    // List of this entry's parent(s)
    parents: [],

    // Empty list since brand new entry has no child yet.
    children: [],

    date: Date.now(),

    ip: this.ip
  }


  /*
   * In this loop, we:
   * 1. filter empty pastes  & tabs
   * 2. name empty tabs
   * 3. populate lines array
   * User can send empty tab names - it'll automatically be 'untitled'.
   * we determine total line number for each paste. If a paste
   * is empty, we discard it - along with the parallel tab.
   */

  body.pastes.forEach((paste, i) => {
    if (paste.trim()) {
      entry.tabs[i] = body.tabs[i].trim() ? body.tabs[i] : 'untitled'
      entry.lines[i] = paste.split("\n").length
      entry.pastes[i] = paste
    }
  })

  entry.parents.push(body.parentId)

  yield this.db.entries.insertOne(entry)

  // For each parent in parents[], insert this id in their children[]
  if (body.parentId) {
    for (parent of entry.parents) {
     yield this.db.entries.updateOne({id: parent}, {
        $push: { children: { $position: 0, $each: [entry.id] } }
      })
    }
  }

  this.body = {result: 'success', id: entry.id}


}


/**
 * index route
 */

function* home () {
  this.body = nunjucks.render('./views/new.html')
}

/**
 * /about route
 */

function* about () {
  this.body = nunjucks.render('./views/about.html')
}



/**
 * Generates a short string to be used as a paste's ID.
 * ie, tabbit.org/ksdb
 * before returning, checks in database to make sure it doesn't exist.
 * @param {object} koathis 'this' object sent from the middleware
 * @return {string} A string to be used as the id
 */

function* uniqueId (koathis) {

    // Allowed characters in our ids
    var chars = '☉♩☹☀☍☡☮☿♎♡♥♬♯⚋⚉abcdefghijklmnopqrst'
    chars += 'uvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!&~-+_.'

    // Don't need true randomness, this will do.
    var shuffled = chars.split('').sort( () =>  0.5-Math.random()).join('')

    // Cut off the array past a random number between 1 - 7
    var id = shuffled.slice(0, Math.floor(Math.random() * 7) + 1)

    // Generated id cannot be in `reserved` array or in database
    if ((['about', 'all'].indexOf(id) !== -1) || (id.charAt(0) == '.')) yield uniqueId()

    var exists = yield koathis.db.entries.findOne({uid: id})
    if (exists) yield uniqueId()

    return id
}


router
  .get('/', home)
  .get('/about', about)
  .get('/all', getAll).use(db())
  .get('/:id', getOne).use(db())
  .post('/', add).use(db())

koa
  .use(cors())
  .use(router.routes())
  .use(router.allowedMethods())
  .use(serve(path.resolve('../public')))
  .use(favicon(path.resolve('../public/img/favicon.ico')))
  .listen(3001)


/**
 * Middleware for handling Mongo connection &
 * collections. Since our app is small, it simply
 * returns one collection (entries) for now.
 */

function db() {
  var db = new Promise(function(resolve, reject) {
    return MongoClient.connect('mongodb://localhost/tabbit').then(function(client) {
      client.entries = client.collection('entries')
      client.entries.createIndex({id: 1}, {unique: true})
      return resolve(client)
    })
  })

  return function* (next) {
    this.db = yield db
    yield next
  }
}

/**
 * We loop through this new entry's parents list.
 * For each parent, we append this new entry'd id
 * to their children[] list. This should be run async
 */

function updateChildren(currentId, parents, koathis) {
  console.log(typeof koathis.db.entries.updateOne)
  console.log(koathis.db.entries)

  if (!parents) return false

  parents.forEach(parent => {
    koathis.db.entries.updateOne({id: parent}, {
      $push: { children: {$position: 0}, $each: [currentId]      }
    })
  })
}