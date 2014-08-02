/*
 * In Apache, have

 * <VirtualHost *:80>
 *	ServerName tabbit.org
 *	DocumentRoot "/srv/http/tabbit.org/public
 * 	FallbackResource /index.html
 * </VirtualHost>

 * Terminology:
 * Entry: An entry in the database. Can have pastes
 * Paste:  a tab with a corresponding text. Can be multiples
 * Text:  the text content of the paste
 * Tab: Title tab

*/

var r = require('rethinkdb')
	, http = require('http')
	, connect = require('connect')
	, swig = require('swig')
	, async = require('async')
	, escape = require('escape-html')
	, path = require('path')
	, corser = require('corser')
	, body_parser = require('body-parser')
	, serve_static = require('serve-static')
	, connect_route = require('connect-route')
	, app = connect()
	, config
	, connection
	;


// require('daemon')()

/******************************************************************
 * Variable settings
 ******************************************************************/
config = {
	tpl_dir: path.resolve('../templates/'),
	public_dir: path.resolve('../public/')
}




/******************************************************************
 * Swig settings
 ******************************************************************/
swig.setDefaults({
	cache: false
});


/******************************************************************
 * Connect settings
 ******************************************************************/

// Serving public files
app.use(serve_static(config.public_dir));

// CORS
app.use(corser.create());

// Form data
app.use(body_parser.urlencoded({extended: true}))


/******************************************************************
 * RethinkDB settings
 ******************************************************************/
 databaseSettings = {
	host: 'localhost',
	port: 28015,
	db: 'tabbit' /*default db*/
}

//Create the database, and table(s), if they do not exist.
r.connect(databaseSettings, function(err, conn) {

	if (err) throw err

	connection = conn;





	


	
	// Get a list of the databases
	r.dbList().run(conn, function(err, list) {
		if (err) throw err

		// if 'tabbit' isn't in the list, create it. then create entries table.
		if (list.indexOf('tabbit') == -1) {
			r.dbCreate('tabbit').run(conn, function(err, result) {
				if (err) throw err

				createEntriesTable()
			})
		}
	})
})



/******************************************************************
 * Routings
 ******************************************************************/
app.use(connect_route(function(router) {


	router.get('/', function(req, res, next) {
		swig.renderFile(config.tpl_dir + '/new.html', {id: req.params.id}, function(e, output) {
			res.end(output)
		})
	})


	router.get('/recent', function(req, res, next) {
		r.db('tabbit').table('entries').orderBy({index: r.desc('date')}).run(connection, function(e, cursor) {
			if (e) throw e

			var ids = []

			cursor.each(function(err, row) {

				ids.push(row.id)

			},function finished() {

				swig.renderFile(config.tpl_dir + '/recent.html', {id: 'recent', links: ids}, function(e, output) {
					res.end(output)
				})
			})

		})

	})


	// puny little server may not handle such intense request. May the force be with us
	router.get('/:id', function(req, res, next) {
		r.table('entries').get(req.params.id).run(connection, function(err, results) {
			if (err) res.end("database issues")


			if (results) {
				
				// our array of line numbers have just the total line numbers. ie, [4, 5, 23]. We have to update those
				// so each element has all numbers up to the total. ie, [ [1,2,3], [1,2,3,4,5], etc]
				var lines = []
				results.lines.forEach(function(item) {
					var tmp = [];
					for (var i = 1; i <= item; i++) {
						tmp.push(i)
					}
					lines.push(tmp)
				})
				
				results.lines = lines

				swig.renderFile(config.tpl_dir + '/view.html', {id: req.params.id, result: results}, function(e, output) {
					res.end(output)
				})

			} else {
				res.end("Paste not found - either ID is wrong, or it's been deleted.")
				return false;
			}
		})

		
	})




	/*
	 * Sanitize entries. This is long and boring, probably because
	 * of my shitty logic. Here's how it goes:
	 * (first, let's see what entries might look like):

	 * First make sure the entry has a `tab` and `text` key.
	 * Then, `tab` and `text` must not be falsy (ie, no content)
	 * We first check the `text` value. If it's true (has content)
	 *
	 * pastes = [
	 *     {
	 *         tab: 'untitled-1'
	 *         text: 'some text'
	 *     },
	 *     {
	 *         tab: 'untitled-2'
	 *         text: 'more text'
	 *     }
	 * ]
	 *
	 * So we loop through pastes, where each element is a paste.
	 * If the paste has no `tab` or `text`, remove it from the entry.
	 * If the entry has a text, but no tab title, then the user probably
	 * went to give the tab a title and forgot. give it a default value of 'untitled'
	 *
	 * In short, we can have a blank tab title, but no blank text.
	 *
	 * ps: it was a lot shorter than i thought it was going to be.
	 *
	 * Note: We store the data in the database with a different structure
	 * than above. In the database, it will be stored as something
	 * like this:
	 * {
	 *		id: "xyz",
	 *		tabs: ['title-a', 'title-b'],
	 *		texts: ['content a', 'content a'],
	 *		lines: [1, 34],
	 *		parents: [],
	 *		children: [],
	 *		date: 1234567890,
	 *		ip: 123.12.12.123
	 * }
	 *
	 */
	router.post('/', function(req, res, next) {
		
		// Must have a parameter. It must be an array. it must not me empty.		
		if (!req.body.entry && Object.prototype.toString.call(req.body.entry) !== '[object Array]') {
			res.end()
			return false
		}

		var paste = req.body.entry

		
		var parent_id = req.body.parent_id || null
		
		
		var entriesCopy = paste

		var db_entry = {

			// A unique id
			id: null,

			// A list of tab names (index.html, foo.css)
			tabs: [],

			// Pastes texts (<b>hi</b>, body {display:none})
			texts: [],

			// Line numbers for each paste (3, 56)
			lines: [],

			// List of this entry's parents. can be empty. ([foo, bar, baz])
			parents: [],

			// Empty list since brand new entry has no child yet.
			children: [],

			// Obvious
			date: null,

			// Obvious
			ip: null
		}

		paste.forEach(function(paste, i) {

			var error = false

			// Someone tried to break it.
			if (typeof paste != 'object') {
				res.end()
				return false
			}

			// There's a text but no tab title. Give default title
			if (paste.text.trim() && !paste.tab.trim()) {
				paste[i].tab = 'untitled'
			}

			// No text. Delete this paste from entry
			if (!paste.text.trim()) {
				error = true
			}

			// If there's no error, semi-populate db_entry.
			// Then finish populating it in waterfall
			if (!error) {
				db_entry.tabs.push(escape(paste.tab))
				db_entry.texts.push(escape(paste.text))
				db_entry.date = Date.now()
				db_entry.ip = req.headers['x-forwarded-for']
			 		|| req.connection.remoteAddress
			 		|| req.socket.remoteAddress
			 		|| req.connection.socket.remoteAddress
			 		;
				
			} else {
				res.end()
				return false
			}

		})


		// We have now cleaned up entry. Does it still have anything in it?
		/*if (!db_entry.texts.length) {
			res.end()
			return false
		}
		*/

		/*
		 * We passed the validation. From here on we just populate
		 * db_entry's values as we waterfall down
		 */
		async.waterfall([

			// Generate a unique id for this entry
			function(callback) {
				uniqueId(0, callback)
				
			},

			// Populate the parents[].
			function(id, callback) {
				db_entry.id = id
				
				get_parents(parent_id, callback)				
			},

			// Generate line numbers
			function(parents, callback) {
				db_entry.parents = parents
				
			 	// Create a parrallel array for no. of lines in each paste.
			 	var lines = [];
				db_entry.texts.forEach(function(paste, i) {
					db_entry.lines.push( paste.split("\n").length )
				})

				
				callback(null)
			},


			// Finally, db_entry into the db
			function(callback) {
				
				insertEntry(res, db_entry, callback)
			}



		], function(err, data) {
			/*
			 * If any of the waterfall functions returned an error, waterfall
			 * will stop and execute this function with and pass the error (`err`)
			 * If there were no errors, this function is executed after the last
			 * waterfall function, and passes the result of the last callback (`data`)
			 */
			if (err)  {
				//res.end'One of the waterfall functions returned an error)
				
			} else {
				res.end(data.id)
				/*
				 * Now that entry is inserted, go through all of its parents and
				 * append this entry's id to their children[] list
				 */
				update_children(data.id, data.parents)
			}
		})


	})





})) // end app.use route






/**************************************************************
 * Helper Functions
 **************************************************************/

/*
 * We loop through this new entry's parents list.
 * For each parent, we append this new entry'd id
 * to their children[] list. This should be run async
 */
function update_children(current_id, parents) {
	if (!parents) return false

	
	parents.forEach(function(item) {
		

		
		r.table('entries')
			.get(item)
			.update({ 
				children: r.row('children').prepend(current_id)
			})
			.run(connection, function(e, s) {
				if (e) {}
			})

	})
}

/*
 * Given an entry id, we retrieve its parents[] array.
 * This function is called when inserting a new entry as a child of another.
 *
 * we have tree a -> b. When 'c' is being inserted, we call this function
 * with `id` being 'b'. We fetch b's parents, which would be [a]. We then append
 *'b' to that list, and that list becomes c's parents[] list
 *
 * @id: an entry id to get parents[] from
 */
function get_parents(id, async_callback) {
	if (id == 'undefined' || typeof id == 'undefined' || !id)
		return async_callback(null, [])

	r.table('entries').get(id).run(connection, function(e, result) {

		if (e) throw ("Couldn't get parents list")
		
		result.parents.push(id)

		async_callback(null, result.parents)
		
	})
}


/*
 * We insert a json in the database. It should look something
 * like this:
 * {
 *		id: "xyz",
 *		parents: [a, b],
 *		children: [],
 *		tabs: ['title-a', 'title-b'],
 *		texts: ['content a', 'content a'],
 *		lines: [1, 34],
 *		date: 1234567890,
 *		ip: 123.12.12.123
 * }
 */
 function insertEntry(res, db_entry, async_callback) {
 	r.table('entries').insert([
 		db_entry
		// {
		// 	id 		: db_entry.id,
		// 	tabs 	: db_entry.tabs,
		// 	texts 	: db_entry.texts,
		// 	lines 	: db_entry.lines,
		// 	parents : db_entry.parents,
		// 	children: db_entry.children,
		// 	date 	: Date.now(),
		// 	ip 		: db_entry.ip
		// }
	]).run(connection, function(err, result) {
		if (err) res.end('could not insert')

		
		/*
		 * Entry is inserted. As the final function of waterfall,
		 * we redirect the user to the new url id, and update children
		 */
		async_callback(null, {id: db_entry.id, parents: db_entry.parents} )
	})
 }



/*
 * Generates a unique url id
 */
function uniqueId(loop, async_callback) {

	loop = (typeof loop != 'undefined')  ? loop += 1 : 0

	// Our shuffled array
	var chars = shuffle('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!&~-+_.'.split(''))

	// A random number between 1 and 7
	var random =  Math.floor(Math.random() * 7) + 1

	// Cut off the array past the random number generated above
	var id = chars.slice(0, random).join('')

	// url cannot be site.com/.
	if (id === '.' || id === '..') uniqueId(loop, async_callback)

	r.table('entries').filter({'id':id}).count().run(connection, function(e, count) {

		if (!count) {
			async_callback(null, id)

		} else {
			// ID exists. run this fn again
			if (loop < 10) {
				uniqueId(loop, async_callback)
			} else {
				/*
				 * We've tried to create a unique id 10x,
				 * every time we generated an id, it existed in
				 * the database. Either a ghost haunts the machine,
				 * or the website is way too popular and I should be
				 * putting up ads.
				 */
				 async_callback('max loop reached.', false)
			}
		}
	})

}



/*
 * Creates 'entries' table if it doesn't exist
 */
function createEntriesTable() {
	var tableSettings = {
		primaryKey: 'id'
	}

	r.db('tabbit').tableCreate('entries', tableSettings).run(connection, function(err, result) {
		if (err) throw err

		r.table('entries').indexCreate('date').run(connection, function(e, r) {
			if (e) throw 'could not index date'



		})
		
	})
}


/*
 * Shuffles an array
 */
function shuffle(o) {
    for(var j, x, i = o.length; i; j = Math.floor(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
    return o;
}





http.createServer(app).listen(3001)
