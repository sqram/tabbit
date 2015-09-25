  var $tabs = $('.tabs')
    , $textarea = $('textarea:eq(0)').clone()
    , $textareaContainer = $('.textareas')
    , $texts = $('#pastes table') || null
    , $lineNumbers = $('.line-numbers') || null
    , server = window.location.origin //+ ':3001/'
    ;


  // Populate author field if we have it stored
  var author = window.localStorage.getItem('author') || 'anonymous'
  $('#author').val(author)

  /**
   * Form to show when entering a new paste
   */
  $('form').submit(function(e) {
    e.preventDefault()


    var entry = {
      tabs: [],
      pastes: [],
      author: $('#author').val(),
      parentId: $('body').data('parentId') || null
    }

    window.localStorage.setItem('author', $('#author').val())

    for(var i = 0; i < $tabs.children(':not(#new-tab)').length; i++) {
      var tab = $tabs.children(':not(#new-tab)')[i].textContent.trim() || 'untitled'
      var paste = $textareaContainer.children()[i].value.trim()

      /*
       * There must be a paste connected to this tab - pastes cannot be blank.
       * However, we only check to see if text is set because if user leaves
       * tab name blank, we automatically make it 'untitled'
       */
      if (paste) {
        entry.tabs.push(tab)
        entry.pastes.push(paste)
      }
    }

    if (entry.pastes.length) {
      $.ajax({
        type: "POST",
        url: server,
        data: JSON.stringify(entry)
      }).done(function(data) {
        window.document.location.assign(window.location.origin + '/' + data.id)
      })
    }
  })




  /**
   * When the '+' tab is clicked, create a new tab (untitled)
   * and a new textarea.
   * Clone a tab. doesn't matter which one. Append it
   * to the $tabs lists. Remove 'active' class from all li's
   * and append 'active' to the $newTab. Same concept
   * for the textarea
   */

  $('#new-tab').click(function() {

    $tabs.find('.active').removeClass('active')
    $newTab = $tabs
      .find('li:eq(0)')
      .clone('WithDataAndEvents')
      .text('untitled')
      .addClass('active');

    $tabs.append($newTab);
    // Append the clicked li ('+') to end of list
    $tabs.append(this)
    $textareaContainer.children().hide()
    $textareaContainer.append($textarea.clone().css('display','block'))
  })

  /*
   * If we have an entry stored in localStorage,
   * prepopulate form. This means the user clicked the
   * reply button
   */
  if (localStorage.tabs && localStorage.pastes && localStorage.id) {
    var tabs = JSON.parse(localStorage.tabs)
    var pastes = JSON.parse(localStorage.pastes)

    // Before deleting localStorage, store the id of the entry
    // we are replying to(if any) in the body tag.
    // This will be sent as POST when we submit so the server
    // can know who this entry's parent is
    $('body').data('parentId', localStorage.id)

    // Detach the originals so we can clone them in the loop
    var $tab = $tabs.find('li:eq(0)').detach()
    var $t = $('.textareas').find('textarea:eq(0)').detach()
    var $new_tab = $('#new-tab').detach()
    for (var i = 0;  i < pastes.length; i++) {
      $tabs.append($tab.clone().html(tabs[i]))
      $('.textareas').append( $t.clone().text(pastes[i]) )
    }

    // Append the + tab to the end
    $tabs.append($new_tab)
    $tabs.find('.active').removeClass('active')
    $tabs.find('li:eq(0)').addClass('active')

    delete localStorage.tabs
    delete localStorage.pastes
    delete localStorage.id
  }


  /**
   * Clicking on a tab. If we are viewing a paste, we
   * replace the paste area with the paste's contents.
   * If we're creating a paste, just show the
   * corresponding textarea.
   */

  $(document.body).on('click', 'ul.tabs > li:not(#new-tab, .active)', function() {

    var index = $(this).index()
    $tabs.find('.active').removeClass('active')
    $(this).addClass('active')
    $texts.hide()
    $texts.eq(index).show()

    var $toShow = $($textareaContainer.children()[index])
    $textareaContainer.children().hide()
    $toShow.show()
  })



  $('#reply').click(function() {
    var original_entry = JSON.parse($('#original').text().trim())
    localStorage.id = original_entry.id
    localStorage.tabs = JSON.stringify(original_entry.tabs);
    localStorage.pastes = JSON.stringify(original_entry.pastes);
    window.document.location.assign('/');
  })