/**
 * Since this project renders html in the server,
 * our broccoli only exists for moving js
 * and transpiled css. But to see results, you'll
 * have to broccoli build, not broccoli serve.
 * Perhaps I'll get rid of broccoli and use
 * sublime plugins (or another simpler build system)
 * to transpile styl and es6 files - one day. maybe.
 */

var funnel = require('broccoli-funnel')
  , mergeTrees = require('broccoli-merge-trees')
  , stylus = require('broccoli-stylus-single')
  ;


// img tree
var img = funnel('src/img', {
  srcDir: '/',
  destDir: 'img'
})

// js tree
var js = funnel('src/js', {
  srcDir: '/',
  destDir: 'js'
})


// css tree
var styles = funnel('src/css', {
  srcDir: '/',
  destDir: 'css'
})
styles = stylus([styles], './css/tabbit.styl', './css/tabbit.css')


module.exports = mergeTrees([styles, js, img])