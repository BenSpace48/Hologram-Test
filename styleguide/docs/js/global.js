jQuery(function($) {
    // Global Promotion Fade

    var promoList = $('.global-promos'),
        promoItems = promoList.children('li'),
        promoLen = promoItems.length,
        i = 0,
        changeItems = function() {
            promoItems.eq(i).fadeOut(600, function() {
                i +=1;
                if(i === promoLen) {
                    i = 0;
                }
                promoItems.eq(i).fadeIn(600);
            });
        };

        promoItems.not(':first').hide();
        setInterval(changeItems, 6000);


    //Hide all panels
      var allPanels = $('.accordion > dd').hide();
      //Handle click function
      jQuery('.accordion > dt').on('click', function() {
          //this clicked panel
          $this = $(this);
          //the target panel content
          $target = $this.next();

          //Only toggle non-displayed
          if(!$this.hasClass('accordion-active')){
              //slide up any open panels and remove active class
              $this.parent().children('dd').slideUp();

              //remove any active class
              $this.parent().children('dt').removeClass('accordion-active');
              //add active class
              $this.addClass('accordion-active');
              //slide down target panel
              $target.addClass('active').slideDown();

          }

        return false;
      });

      //$("#checkout-review-table, #shopping-cart-table, .my-account .data-table").addClass("large-only");
      //$("#checkout-review-table, #shopping-cart-table, .my-account .data-table").stacktable({myClass:"stacktable small-only"});

      $('select').not('.county, .my-account .limiter select').selectric();

});