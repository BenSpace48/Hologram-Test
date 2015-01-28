jQuery(function($) {
    var $tab = $('.tab');
        $tab.on("click", function(e){
        e.preventDefault();
        var $this = $(this);
        $this.toggleClass('active');
        $this.next('.panel').toggleClass('active');
    });
});