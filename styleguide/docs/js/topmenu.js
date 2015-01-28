jQuery(function($) {
    $(window).resize(function() {
        if($(window).innerWidth() > 750) {
            $('.search-form').css('display', 'block');
            $('.block-login').css('display', 'none');
            $('.nav-mini a').removeClass('active');

        } else {
            $('.search-form').css('display', 'none');
        }
    });

    if($(window).innerWidth() > 750) {
        // Prepend 'Fade Panel' for when menu is hovered over.
        $('.page').append('<div class="menu-fade-panel"></div>');

        // If the nav item has a dropdown, class to display arrow
        $('.main-nav-item').hover(function() {
            if($(this).find(".main-nav-dd").length) {
                $(this).find(".main-nav-tab").addClass("has-sub");
                $('.menu-fade-panel').show();
            }
        }, function() {
            $(".main-nav-tab").removeClass("has-sub");
            $('.menu-fade-panel').hide();
        });
    }

    $('.nav-mob .toggle').on('click', function(e) {
        var container = $(this).attr("data-menu-toggle");
        e.preventDefault();
        $('.toggle').not($(this)).removeClass('active');

        $(this).toggleClass('active');
        $('.mini-menu-toggle').hide();

        if($(this).hasClass('active')) {
            $("#" + container).show();
        } else {
            $("#" + container).hide();
            $(this).removeClass('active');
        }
    });


    // Main Navigation Functionality
    $('#nav').children('.main-nav-item').hover(function(ev) {

        if($(this).find('.main-nav-dd').length > 0) {
            $(this).find('.main-nav-tab').addClass('has-sub');
        }

        // show the dropdown
        $(this).addClass('main-nav-item-active');

    }, function(ev) {

        // hide the dropdown
        $(this).removeClass('main-nav-item-active');
        $(this).find('.main-nav-tab').removeClass('has-sub');
    });
});