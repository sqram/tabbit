var gulp = require('gulp')
	, stylus = require('gulp-stylus')
	;

gulp.task('stylus', function() {
	gulp.src('./dev/*.styl')
		.pipe(stylus())
		.pipe(gulp.dest('./public/css/'))
})


gulp.task('watch', function() {
	gulp.watch('./dev/', ['stylus'])
})

gulp.task('default', ['watch', 'stylus'])